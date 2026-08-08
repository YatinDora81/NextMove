/**
 * lib/extensionBridge.ts — the page half of the web → extension handshake (JF-001 SEC 8.2).
 *
 * `chrome.runtime.sendMessage(extensionId, msg, cb)` is the only channel a normal web page has to
 * an extension, and it is available to us only because the extension lists this origin in its
 * manifest's `externally_connectable`. Chrome enforces that; the extension re-checks `sender.origin`
 * and `frameId === 0` on top of it. Nothing on this side is a security boundary.
 *
 * ── Why this file exists at all ────────────────────────────────────────────────────────────────
 *
 * The raw API has two behaviours that will burn any caller that talks to it directly:
 *
 *   1. It is callback-based, and errors do not throw — they appear on `chrome.runtime.lastError`,
 *      which is only readable *inside* the callback and is cleared the moment it returns.
 *   2. When the extension is not installed the callback frequently never fires at all. There is no
 *      rejection, no error, no timeout: the promise you wrapped it in simply hangs, and the UI sits
 *      on a spinner forever.
 *
 * So every request here is a race between the callback and a timer, and every outcome — including
 * "not installed" — comes back as a value.
 */

/* ------------------------------------------------------------------------------------------------
 * The `chrome` global
 * ---------------------------------------------------------------------------------------------- */

/**
 * The three members this module touches, declared locally rather than by depending on
 * `@types/chrome` — that package pulls in the whole extension platform surface (tabs, cookies,
 * webRequest) into a web app that can call exactly one function of it.
 */
interface ChromeRuntimeLike {
    /** Present only inside a callback, and only when the call failed. */
    readonly lastError?: { readonly message?: string }
    /**
     * Optional because Chrome exposes `chrome.runtime` on ordinary pages but only defines
     * `sendMessage` when some installed extension has declared this origin externally connectable.
     */
    readonly sendMessage?: (
        extensionId: string,
        message: unknown,
        callback: (reply?: unknown) => void,
    ) => void
}

interface ChromeLike {
    readonly runtime?: ChromeRuntimeLike
}

declare global {
    interface Window {
        readonly chrome?: ChromeLike
    }
}

/* ------------------------------------------------------------------------------------------------
 * Protocol
 * ---------------------------------------------------------------------------------------------- */

export const HELLO = "NEXTMOVE_HELLO"
export const CONNECT = "NEXTMOVE_CONNECT"
export const STATUS = "NEXTMOVE_STATUS"

/** Every reply the extension can send. `installed: true` is its proof-of-life marker. */
export interface HandshakeReply {
    ok: boolean
    installed: true
    version: string
    paired: boolean
    /** HELLO only — the single-use token the following CONNECT must echo back. */
    nonce?: string
    deviceName?: string | null
    lastSyncAt?: number | null
    /** CONNECT only — how many profiles the extension pulled down and wrote locally. */
    profilesApplied?: number
    error?: { code: string; message: string }
}

export interface ConnectPayload {
    nonce: string
    pairCode: string
    vaultKey: string
    deviceName?: string
}

/**
 * A failure that happened on *this* side of the channel, or an error code the extension sent back
 * verbatim (`BAD_NONCE`, `NONCE_EXPIRED`, `BAD_VAULT_KEY`, `VAULT_KEY_STORE_FAILED`, …), so the UI
 * can show the extension's own wording rather than inventing its own.
 */
export interface BridgeError {
    code: string
    message: string
}

export type BridgeResult =
    | { ok: true; reply: HandshakeReply }
    | { ok: false; error: BridgeError }

/** The extension could not be reached: not installed, disabled, or blocked for this profile. */
export const NOT_INSTALLED = "NOT_INSTALLED"
/** Reached, but it did not answer in time. */
export const TIMEOUT = "TIMEOUT"
/** Answered with something that is not a handshake reply — a version mismatch, most likely. */
export const BAD_REPLY = "BAD_REPLY"
/** `NEXT_PUBLIC_EXTENSION_ID` is missing from this deployment's environment. */
export const NOT_CONFIGURED = "NOT_CONFIGURED"

/**
 * The extension's stable id, pinned by the `key` field in its manifest so it survives reinstalls
 * and matches between the store build and a local unpacked one.
 */
export const EXTENSION_ID: string = process.env.NEXT_PUBLIC_EXTENSION_ID ?? ""

/** A HELLO or STATUS answers instantly — it is a storage read inside the service worker. */
const PING_TIMEOUT_MS = 3000
/**
 * CONNECT redeems a pairing code and then pulls and decrypts the profile, so it is two network
 * round trips inside the worker plus a cold start. Twenty seconds is generous on purpose: timing
 * out early here shows an error for work that actually succeeded.
 */
const CONNECT_TIMEOUT_MS = 20_000

/* ------------------------------------------------------------------------------------------------
 * Plumbing
 * ---------------------------------------------------------------------------------------------- */

function runtime(): ChromeRuntimeLike | null {
    if (typeof window === "undefined") return null
    const candidate = window.chrome?.runtime
    if (candidate === undefined || typeof candidate.sendMessage !== "function") return null
    return candidate
}

/**
 * Synchronous, cheap, and only ever a *negative* signal: false means no extension can possibly be
 * listening, true means one might be. Use it to skip the round trip, not to claim installation.
 */
export function hasExtensionApi(): boolean {
    return runtime() !== null
}

function toReply(raw: unknown): HandshakeReply | null {
    if (typeof raw !== "object" || raw === null) return null
    const row = raw as Record<string, unknown>
    if (typeof row.ok !== "boolean" || row.installed !== true) return null
    if (typeof row.version !== "string" || typeof row.paired !== "boolean") return null

    const reply: HandshakeReply = {
        ok: row.ok,
        installed: true,
        version: row.version,
        paired: row.paired,
    }
    if (typeof row.nonce === "string") reply.nonce = row.nonce
    if (typeof row.deviceName === "string" || row.deviceName === null) reply.deviceName = row.deviceName
    if (typeof row.lastSyncAt === "number" || row.lastSyncAt === null) reply.lastSyncAt = row.lastSyncAt
    if (typeof row.profilesApplied === "number") reply.profilesApplied = row.profilesApplied

    const error = row.error
    if (typeof error === "object" && error !== null) {
        const detail = error as Record<string, unknown>
        reply.error = {
            code: typeof detail.code === "string" ? detail.code : "UNKNOWN",
            message: typeof detail.message === "string" ? detail.message : "The extension reported an error.",
        }
    }
    return reply
}

const NOT_INSTALLED_MESSAGE =
    "NextMove Autofill isn't responding in this browser. Install it, or enable it at chrome://extensions, then reload this page."

function request(message: Record<string, unknown>, timeoutMs: number): Promise<BridgeResult> {
    return new Promise<BridgeResult>((resolve) => {
        if (EXTENSION_ID.length === 0) {
            resolve({
                ok: false,
                error: {
                    code: NOT_CONFIGURED,
                    message: "This build of NextMove has no extension id configured, so it cannot connect.",
                },
            })
            return
        }

        const api = runtime()
        if (api === null || api.sendMessage === undefined) {
            resolve({ ok: false, error: { code: NOT_INSTALLED, message: NOT_INSTALLED_MESSAGE } })
            return
        }

        let settled = false
        // Declared before `finish` closes over it: `sendMessage` is documented as async, but a
        // synchronous throw or callback would otherwise hit the temporal dead zone and turn a
        // handled failure into an unhandled ReferenceError.
        let timer = 0
        const finish = (result: BridgeResult): void => {
            if (settled) return
            settled = true
            window.clearTimeout(timer)
            resolve(result)
        }

        // The timer is not a nicety. A missing extension usually drops the callback entirely, and
        // without this the caller's await never returns.
        timer = window.setTimeout(() => {
            finish({
                ok: false,
                error: {
                    code: TIMEOUT,
                    message: "The extension didn't answer. Reload the page and try again.",
                },
            })
        }, timeoutMs)

        try {
            api.sendMessage(EXTENSION_ID, message, (raw) => {
                // Must be read here: Chrome clears `lastError` as soon as this callback returns,
                // and reading it late looks like success.
                const lastError = api.lastError
                if (lastError !== undefined) {
                    finish({
                        ok: false,
                        error: { code: NOT_INSTALLED, message: lastError.message ?? NOT_INSTALLED_MESSAGE },
                    })
                    return
                }
                const reply = toReply(raw)
                if (reply === null) {
                    finish({
                        ok: false,
                        error: {
                            code: BAD_REPLY,
                            message:
                                "The installed extension answered with something NextMove doesn't understand. Update it and try again.",
                        },
                    })
                    return
                }
                finish({ ok: true, reply })
            })
        } catch {
            // Older Chrome throws synchronously for an unknown extension id instead of setting
            // `lastError`, which is the same fact by a different route.
            finish({ ok: false, error: { code: NOT_INSTALLED, message: NOT_INSTALLED_MESSAGE } })
        }
    })
}

/* ------------------------------------------------------------------------------------------------
 * Public API
 * ---------------------------------------------------------------------------------------------- */

/** Asks for a fresh single-use nonce. Used when the user arrived without one in the URL. */
export function sendHello(timeoutMs: number = PING_TIMEOUT_MS): Promise<BridgeResult> {
    return request({ type: HELLO }, timeoutMs)
}

/** Read-only probe. Burns nothing, so it is safe to call on mount and after a failure. */
export function sendStatus(timeoutMs: number = PING_TIMEOUT_MS): Promise<BridgeResult> {
    return request({ type: STATUS }, timeoutMs)
}

/** Hands over the pairing code and the vault key. The nonce is consumed whether or not this works. */
export function sendConnect(
    payload: ConnectPayload,
    timeoutMs: number = CONNECT_TIMEOUT_MS,
): Promise<BridgeResult> {
    const message: Record<string, unknown> = {
        type: CONNECT,
        nonce: payload.nonce,
        pairCode: payload.pairCode,
        vaultKey: payload.vaultKey,
    }
    if (payload.deviceName !== undefined) message.deviceName = payload.deviceName
    return request(message, timeoutMs)
}

/** True only when an extension actually answered a STATUS. Cheap enough to run on mount. */
export async function isExtensionInstalled(timeoutMs: number = PING_TIMEOUT_MS): Promise<boolean> {
    if (!hasExtensionApi()) return false
    const result = await sendStatus(timeoutMs)
    return result.ok
}

/* ------------------------------------------------------------------------------------------------
 * Device naming
 * ---------------------------------------------------------------------------------------------- */

/**
 * A name the user will recognise in Settings → Connected devices, e.g. "Chrome · macOS".
 *
 * Deliberately coarse. The point is to tell two of your own machines apart, and a full UA string
 * both fails at that and is a fingerprinting-grade detail to store server-side for no benefit.
 */
export function deviceNameFromUserAgent(userAgent?: string): string {
    const ua =
        userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent)
    if (ua.length === 0) return "This browser"

    // Order matters: every Chromium fork also says "Chrome", so the specific tokens go first.
    const browser =
        /\bEdg\//.test(ua) ? "Edge"
        : /\bOPR\//.test(ua) ? "Opera"
        : /\bVivaldi\//.test(ua) ? "Vivaldi"
        : /\bArc\//.test(ua) ? "Arc"
        : /\bChrome\//.test(ua) ? "Chrome"
        : /\bFirefox\//.test(ua) ? "Firefox"
        : /\bSafari\//.test(ua) ? "Safari"
        : "Browser"

    const os =
        /\bWindows\b/.test(ua) ? "Windows"
        : /\bCrOS\b/.test(ua) ? "ChromeOS"
        : /\bAndroid\b/.test(ua) ? "Android"
        : /\b(Macintosh|Mac OS X)\b/.test(ua) ? "macOS"
        : /\b(iPhone|iPad|iPod)\b/.test(ua) ? "iOS"
        : /\bLinux\b/.test(ua) ? "Linux"
        : ""

    return os.length > 0 ? `${browser} · ${os}` : browser
}
