interface ChromeRuntimeLike {
    readonly lastError?: { readonly message?: string }
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

export const HELLO = "NEXTMOVE_HELLO"
export const CONNECT = "NEXTMOVE_CONNECT"
export const STATUS = "NEXTMOVE_STATUS"

export interface HandshakeReply {
    ok: boolean
    installed: true
    version: string
    paired: boolean
    nonce?: string
    deviceName?: string | null
    lastSyncAt?: number | null
    profilesApplied?: number
    error?: { code: string; message: string }
}

export interface ConnectPayload {
    nonce: string
    pairCode: string
    vaultKey: string
    deviceName?: string
}

export interface BridgeError {
    code: string
    message: string
}

export type BridgeResult =
    | { ok: true; reply: HandshakeReply }
    | { ok: false; error: BridgeError }

export const NOT_INSTALLED = "NOT_INSTALLED"
export const TIMEOUT = "TIMEOUT"
export const BAD_REPLY = "BAD_REPLY"
export const NOT_CONFIGURED = "NOT_CONFIGURED"

export const EXTENSION_ID: string = process.env.NEXT_PUBLIC_EXTENSION_ID ?? ""

const PING_TIMEOUT_MS = 3000
const CONNECT_TIMEOUT_MS = 20_000

function runtime(): ChromeRuntimeLike | null {
    if (typeof window === "undefined") return null
    const candidate = window.chrome?.runtime
    if (candidate === undefined || typeof candidate.sendMessage !== "function") return null
    return candidate
}

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
        let timer = 0
        const finish = (result: BridgeResult): void => {
            if (settled) return
            settled = true
            window.clearTimeout(timer)
            resolve(result)
        }

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
            finish({ ok: false, error: { code: NOT_INSTALLED, message: NOT_INSTALLED_MESSAGE } })
        }
    })
}

export function sendHello(timeoutMs: number = PING_TIMEOUT_MS): Promise<BridgeResult> {
    return request({ type: HELLO }, timeoutMs)
}

export function sendStatus(timeoutMs: number = PING_TIMEOUT_MS): Promise<BridgeResult> {
    return request({ type: STATUS }, timeoutMs)
}

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

export async function isExtensionInstalled(timeoutMs: number = PING_TIMEOUT_MS): Promise<boolean> {
    if (!hasExtensionApi()) return false
    const result = await sendStatus(timeoutMs)
    return result.ok
}

export function deviceNameFromUserAgent(userAgent?: string): string {
    const ua =
        userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent)
    if (ua.length === 0) return "This browser"

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
