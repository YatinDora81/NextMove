/**
 * lib/vault.ts — apps/web's seam onto @repo/vault (JF-001 SEC 7.4 / 8.3).
 *
 * The codec itself lives in `packages/vault` because the extension's service worker has to produce
 * and consume byte-identical envelopes. What belongs *here* is everything that is specific to being
 * a web page: where the key is kept, how the envelope is fetched and pushed, and how a user gets a
 * copy of the key they can put in a password manager.
 *
 * ── The one rule ───────────────────────────────────────────────────────────────────────────────
 *
 * The vault key never leaves this browser except by the user's own hand: it goes to the extension
 * over `chrome.runtime.sendMessage` (a local IPC channel) and into a file the user downloads.
 * Nothing in this module puts it in a request body, a header, a query string, or a cookie. That is
 * the entire basis of the server-blind claim — the server stores ciphertext and cannot decrypt it.
 *
 * ── Why the key is per-browser ─────────────────────────────────────────────────────────────────
 *
 * `localStorage` is origin- and profile-scoped, so signing in on a second machine gets you an
 * account but not a key. That is not a bug to be papered over; it is the cost of end-to-end
 * encryption, and the honest answer to it is `downloadRecoveryKey()` — offered before the user
 * leaves onboarding, while the key still exists.
 */

import { buildSyncProfileVault } from "@repo/types/ProfileTypes"
import type { SharedProfile, SyncProfileVault } from "@repo/types/ProfileTypes"
import {
    generateVaultKey,
    isVaultKey,
    openProfileVault,
    rawKeyMaterial,
    sealProfileVault,
} from "@repo/vault"
import { SYNC_PROFILE } from "@/utils/url"

export { generateVaultKey, isVaultKey }

/** Where the E2E secret lives. Per-browser by design — see the module header. */
export const VAULT_KEY_STORAGE_KEY = "nextmove.vaultKey"

/** The `GET`/`PUT /api/sync/profile` body. Mirrors `profileBlobEnvelopeSchema`. */
export interface ProfileEnvelope {
    ciphertext: string
    nonce: string
    version: number
}

/* ------------------------------------------------------------------------------------------------
 * Key storage
 * ---------------------------------------------------------------------------------------------- */

/**
 * `window.localStorage` when it is both present and usable.
 *
 * Two separate failures hide behind one property access: server rendering (no `window` at all) and
 * a browser that throws on the getter — Chrome does exactly that when the user has blocked site
 * data, and Safari's private mode has historically thrown on `setItem` instead. Both must degrade
 * to "no persistence" rather than to an exception thrown out of a render.
 */
function keyStore(): Storage | null {
    if (typeof window === "undefined") return null
    try {
        return window.localStorage
    } catch {
        return null
    }
}

/**
 * The stored vault key, or null when this browser has none.
 *
 * A stored value that is not a well-formed 256-bit key is treated as *absent*, not as an error: a
 * truncated or hand-edited entry would otherwise seal a vault that nothing — including this
 * browser — could ever reopen.
 */
export function readVaultKey(): string | null {
    const store = keyStore()
    if (store === null) return null
    try {
        const raw = store.getItem(VAULT_KEY_STORAGE_KEY)
        return raw !== null && isVaultKey(raw) ? raw : null
    } catch {
        return null
    }
}

/** Persists a key. Returns false when the browser refused to store it — the caller must say so. */
export function writeVaultKey(keyB64: string): boolean {
    if (!isVaultKey(keyB64)) return false
    const store = keyStore()
    if (store === null) return false
    try {
        store.setItem(VAULT_KEY_STORAGE_KEY, keyB64)
        return true
    } catch {
        return false
    }
}

export function clearVaultKey(): void {
    const store = keyStore()
    if (store === null) return
    try {
        store.removeItem(VAULT_KEY_STORAGE_KEY)
    } catch {
        // Nothing to do: if the browser will not let us remove it, it will not let us read it either.
    }
}

/* ------------------------------------------------------------------------------------------------
 * Seal / open
 * ---------------------------------------------------------------------------------------------- */

/**
 * Builds the plaintext vault and seals it at `version`.
 *
 * `version` is the optimistic-concurrency counter the server checks: pass `lastKnownVersion + 1`.
 * Every call produces different bytes even for identical input, because the AES-GCM IV is fresh —
 * which is why a 409 can never be retried by resending the same envelope.
 */
export async function sealVault(
    profiles: readonly SharedProfile[],
    activeProfileId: string | null,
    keyB64: string,
    version: number,
): Promise<ProfileEnvelope> {
    const vault = buildSyncProfileVault(profiles, activeProfileId, Date.now())
    return sealProfileVault(vault, rawKeyMaterial(keyB64), version)
}

/** Decrypts an envelope. Throws `VaultError` — `isVaultError(err)` narrows it, `.code` explains it. */
export async function openVault(
    envelope: Pick<ProfileEnvelope, "ciphertext" | "nonce">,
    keyB64: string,
): Promise<SyncProfileVault> {
    return openProfileVault(envelope, rawKeyMaterial(keyB64))
}

/* ------------------------------------------------------------------------------------------------
 * Recovery key download
 * ---------------------------------------------------------------------------------------------- */

const RECOVERY_FILE_NAME = "nextmove-recovery-key.txt"

/**
 * The file contents. Written as prose rather than a bare key on purpose: this file will be found
 * months later in a Downloads folder by someone who has forgotten what it is, and it has to explain
 * itself with no context and no product around it.
 */
function recoveryKeyDocument(keyB64: string): string {
    return [
        "NextMove — profile vault recovery key",
        `Generated ${new Date().toISOString()}`,
        "",
        keyB64,
        "",
        "WHAT THIS IS",
        "The line above is the encryption key for your NextMove profile — your contact details,",
        "work history, education, saved answers and application preferences. It was generated in",
        "your browser and has never been sent to NextMove. We do not have a copy and cannot look",
        "it up, reset it, or recover it for you.",
        "",
        "WHEN YOU WILL NEED IT",
        "Paste it back into NextMove when you sign in on a different computer or browser, after",
        "you clear this browser's site data, or when you reinstall the extension on a new machine.",
        "Without it, that device can pair with your account but cannot read your profile.",
        "",
        "IF YOU LOSE IT",
        "The copy of your profile stored on our servers stays encrypted forever and you will have",
        "to enter your profile again from scratch. Your account, templates and application tracker",
        "are not affected — only the profile vault.",
        "",
        "WHERE TO KEEP IT",
        "A password manager entry is ideal. Anyone who has both this key and access to your",
        "NextMove account can read your profile, so treat it like a password.",
        "",
    ].join("\n")
}

/** Triggers a `.txt` download of the key. No-ops during SSR. */
export function downloadRecoveryKey(keyB64: string): void {
    if (typeof window === "undefined") return

    const blob = new Blob([recoveryKeyDocument(keyB64)], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = RECOVERY_FILE_NAME
    anchor.rel = "noopener"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()

    // Released on the next task, not this one: revoking synchronously after click has historically
    // cancelled the download in WebKit.
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/* ------------------------------------------------------------------------------------------------
 * Transport
 * ---------------------------------------------------------------------------------------------- */

interface ApiEnvelope {
    success: boolean
    data: unknown
    message: string
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

/** A non-JSON body (a proxy error page, a 502 from the edge) must still read as a failed response. */
async function readEnvelope(res: Response): Promise<ApiEnvelope> {
    try {
        const parsed: unknown = await res.json()
        const body = asRecord(parsed)
        return {
            success: body.success === true,
            data: body.data ?? null,
            message: typeof body.message === "string" ? body.message : "",
        }
    } catch {
        return { success: false, data: null, message: `The sync service replied with ${res.status}.` }
    }
}

function toProfileEnvelope(raw: unknown): ProfileEnvelope | null {
    const row = asRecord(raw)
    if (typeof row.ciphertext !== "string" || row.ciphertext.length === 0) return null
    if (typeof row.nonce !== "string" || row.nonce.length === 0) return null
    if (typeof row.version !== "number" || !Number.isInteger(row.version)) return null
    return { ciphertext: row.ciphertext, nonce: row.nonce, version: row.version }
}

function bearer(token: string): Record<string, string> {
    // Bearer, never `credentials: "include"` — the API is a separate origin and auth is a JWT the
    // server action hands us, not a cookie the browser can attach.
    return { Authorization: `Bearer ${token}` }
}

/**
 * `GET /api/sync/profile`.
 *
 * Returns null when the account has never pushed a vault. That is a normal state for a new account,
 * not an error, and the server says so with a 200 and `data: null`.
 */
export async function fetchProfileEnvelope(token: string): Promise<ProfileEnvelope | null> {
    const res = await fetch(SYNC_PROFILE, { method: "GET", headers: bearer(token) })
    const body = await readEnvelope(res)
    if (!res.ok || !body.success) {
        throw new Error(body.message || "Could not reach your profile vault.")
    }
    return toProfileEnvelope(body.data)
}

/**
 * The three outcomes of a push, as data rather than as thrown strings.
 *
 * `conflict` is the interesting one and is deliberately not merged into `rejected`: it is the only
 * failure the caller can resolve on its own, and it carries the number needed to do so.
 */
export type PutEnvelopeResult =
    | { ok: true; version: number }
    | { ok: false; reason: "conflict"; currentVersion: number; message: string }
    | { ok: false; reason: "rejected"; message: string }

/**
 * `PUT /api/sync/profile` under optimistic locking.
 *
 * A 409 means another device advanced the vault while we were editing. Resending this same envelope
 * at `currentVersion + 1` would push *our* content over theirs; resending it unchanged would 409
 * again. Neither is correct — the caller must re-GET, merge, re-seal, and push once more.
 */
export async function putProfileEnvelope(
    token: string,
    envelope: ProfileEnvelope,
): Promise<PutEnvelopeResult> {
    const res = await fetch(SYNC_PROFILE, {
        method: "PUT",
        headers: { ...bearer(token), "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
    })
    const body = await readEnvelope(res)

    if (res.status === 409) {
        const data = asRecord(body.data)
        // Falling back to `envelope.version - 1` keeps the caller's arithmetic sane if the server
        // ever omits the field; the caller re-GETs anyway and prefers the version it reads there.
        const currentVersion =
            typeof data.currentVersion === "number" ? data.currentVersion : Math.max(0, envelope.version - 1)
        return {
            ok: false,
            reason: "conflict",
            currentVersion,
            message:
                body.message ||
                "This profile was updated on another device. NextMove will merge and try again.",
        }
    }

    if (!res.ok || !body.success) {
        return {
            ok: false,
            reason: "rejected",
            message:
                body.message ||
                (res.status === 429
                    ? "Too many sync requests — wait a minute and save again."
                    : `Could not save your profile (${res.status}).`),
        }
    }

    const data = asRecord(body.data)
    return { ok: true, version: typeof data.version === "number" ? data.version : envelope.version }
}
