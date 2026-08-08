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

export const VAULT_KEY_STORAGE_KEY = "nextmove.vaultKey"

export interface ProfileEnvelope {
    ciphertext: string
    nonce: string
    version: number
}

function keyStore(): Storage | null {
    if (typeof window === "undefined") return null
    try {
        return window.localStorage
    } catch {
        return null
    }
}

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

export async function sealVault(
    profiles: readonly SharedProfile[],
    activeProfileId: string | null,
    keyB64: string,
    version: number,
): Promise<ProfileEnvelope> {
    const vault = buildSyncProfileVault(profiles, activeProfileId, Date.now())
    return sealProfileVault(vault, rawKeyMaterial(keyB64), version)
}

export async function openVault(
    envelope: Pick<ProfileEnvelope, "ciphertext" | "nonce">,
    keyB64: string,
): Promise<SyncProfileVault> {
    return openProfileVault(envelope, rawKeyMaterial(keyB64))
}

const RECOVERY_FILE_NAME = "nextmove-recovery-key.txt"

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

    window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

interface ApiEnvelope {
    success: boolean
    data: unknown
    message: string
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

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
    return { Authorization: `Bearer ${token}` }
}

export async function fetchProfileEnvelope(token: string): Promise<ProfileEnvelope | null> {
    const res = await fetch(SYNC_PROFILE, { method: "GET", headers: bearer(token) })
    const body = await readEnvelope(res)
    if (!res.ok || !body.success) {
        throw new Error(body.message || "Could not reach your profile vault.")
    }
    return toProfileEnvelope(body.data)
}

export type PutEnvelopeResult =
    | { ok: true; version: number }
    | { ok: false; reason: "conflict"; currentVersion: number; message: string }
    | { ok: false; reason: "rejected"; message: string }

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
