import logger from "@/config/logger.js"
import { scrubString } from "@/utils/redaction.js"
import type { Outcome } from "@repo/rotation"

/**
 * JF-001 SEC 2.3 / 15.5 / 15.7 — minimal Gemini REST caller, used for key **validation only**.
 *
 * Generation still goes through `@google/genai` in `config/gemini.ts`. What that SDK does not give
 * us is a cheap, side-effect-free "is this key real?" probe, which is exactly what the vault needs
 * before it seals anything: `GET /v1beta/models` is the cheapest authenticated call in the API and
 * it costs no tokens.
 *
 * Two hard requirements shape this file:
 *
 *  · **Google's error text is returned verbatim.** Since 2025 Google rejects legacy *unrestricted*
 *    API keys for the Gemini API, and the only thing that tells a user which of their several
 *    AI-Studio keys is the wrong kind is Google's own wording (SEC 5.2 / 15.7). Paraphrasing it
 *    into "invalid key" would strand users on a dead end. We prefix nothing and translate nothing.
 *
 *  · **The key travels in the `x-goog-api-key` header, never the query string** — query strings end
 *    up in proxy logs, browser history and error reports (SEC 2.3).
 */

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"

/** Validation must not hold a request open behind a slow upstream. */
const VALIDATION_TIMEOUT_MS = 10_000

/** The verdict `POST /api/ai-keys` and `POST /api/ai-keys/:id/test` render (SEC 15.5). */
export interface GeminiValidationResult {
    /** `true` only when Google answered 2xx for this key. */
    ok: boolean
    /** Google's message verbatim on failure; a short confirmation on success. */
    message: string
    /** HTTP status Google returned, or `null` when the request never completed (network/timeout). */
    status: number | null
    /** The rotation outcome this response maps to, so callers can feed `applyOutcome` directly. */
    outcome: Outcome
}

/** Google's error envelope: `{ error: { code, message, status } }`. */
interface GoogleErrorEnvelope {
    error?: {
        code?: number
        message?: string
        status?: string
    }
}

/**
 * Pull Google's own wording out of a response body, falling back to the raw text when the body is
 * not the documented envelope (HTML error pages from an edge proxy, for instance).
 */
export const extractGoogleErrorMessage = (body: string, status: number): string => {
    const trimmed = body.trim()

    if (trimmed.length > 0) {
        try {
            const parsed = JSON.parse(trimmed) as GoogleErrorEnvelope
            const message = parsed.error?.message
            if (typeof message === "string" && message.trim().length > 0) {
                const code = parsed.error?.status
                return code ? `${message.trim()} (${code})` : message.trim()
            }
        } catch {
            // Not JSON — fall through to the raw body.
        }

        // Raw bodies can be enormous; a rejection reason never is.
        return trimmed.length > 600 ? `${trimmed.slice(0, 600)}…` : trimmed
    }

    return `Google returned HTTP ${status} with an empty body.`
}

/**
 * The SEC 2.3 HTTP → rotation-outcome mapping, in one place so the validation path and the
 * generation path classify failures identically.
 *
 *   400 with `API_KEY_INVALID` / 401 / 403 → `key_invalid`  (DEAD — only the user can fix it)
 *   429                                    → `http_429`, or `quota_daily` when the message names
 *                                            a per-day quota (EXHAUSTED until Pacific midnight)
 *   5xx, network failure, timeout          → `net_or_5xx`   (not the key's fault; ledger refunded)
 *   anything else non-2xx                  → `net_or_5xx`   (fail soft rather than kill a good key)
 */
export const classifyGeminiHttp = (status: number, message: string): Outcome => {
    if (status >= 200 && status < 300) return { kind: "ok" }

    const haystack = message.toLowerCase()

    if (status === 429) {
        // Google distinguishes per-minute throttling from a spent daily allowance only in prose.
        const isDaily =
            haystack.includes("perday") ||
            haystack.includes("per day") ||
            haystack.includes("per-day") ||
            haystack.includes("daily") ||
            haystack.includes("generaterequestsperdayperproject")
        return isDaily ? { kind: "quota_daily" } : { kind: "http_429" }
    }

    if (status === 401 || status === 403) return { kind: "key_invalid" }

    if (status === 400) {
        const looksInvalid =
            haystack.includes("api_key_invalid") ||
            haystack.includes("api key not valid") ||
            haystack.includes("invalid api key") ||
            haystack.includes("api key expired") ||
            haystack.includes("unrestricted")
        return looksInvalid ? { kind: "key_invalid" } : { kind: "net_or_5xx" }
    }

    return { kind: "net_or_5xx" }
}

/** A network failure or timeout — never the key's fault, so the key must not be penalised. */
const networkResult = (detail: string): GeminiValidationResult => ({
    ok: false,
    message: `Could not reach the Gemini API: ${detail}. This is a network problem, not a problem with the key — try again.`,
    status: null,
    outcome: { kind: "net_or_5xx" },
})

/**
 * Validate an API key against Google with the cheapest possible authenticated call.
 *
 * The key is passed in, used for one request and dropped; it is never logged, never cached and
 * never stored by this module (SEC 15.8). The log line below records the *verdict*, not the key —
 * and the message is pushed through the redaction scrubber first, because Google occasionally
 * echoes a fragment of the offending key back in its error text.
 */
export const validateGeminiKey = async (apiKey: string): Promise<GeminiValidationResult> => {
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
        return {
            ok: false,
            message: "No API key was provided.",
            status: null,
            outcome: { kind: "key_invalid" },
        }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS)

    try {
        const response = await fetch(`${GEMINI_API_BASE}/models`, {
            method: "GET",
            headers: {
                // Header, never a query string (SEC 2.3).
                "x-goog-api-key": apiKey.trim(),
                accept: "application/json",
            },
            signal: controller.signal,
        })

        if (response.ok) {
            return {
                ok: true,
                message: "Key verified against the Gemini API.",
                status: response.status,
                outcome: { kind: "ok" },
            }
        }

        const body = await response.text().catch(() => "")
        // Verbatim: the user must see Google's own rejection, including the unrestricted-legacy-key
        // wording, or they cannot tell which of their AI Studio keys is the wrong kind (SEC 15.7).
        const message = extractGoogleErrorMessage(body, response.status)

        logger.warn(
            `[SERVICE: validateGeminiKey] Google rejected a key with HTTP ${response.status}: ${scrubString(message)}`
        )

        return {
            ok: false,
            message,
            status: response.status,
            outcome: classifyGeminiHttp(response.status, message),
        }
    } catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError"
        const detail = aborted
            ? `no response within ${VALIDATION_TIMEOUT_MS / 1000}s`
            : error instanceof Error
                ? scrubString(error.message)
                : "unknown error"

        logger.error(`[SERVICE: validateGeminiKey] Gemini validation request failed: ${detail}`)
        return networkResult(detail)
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Classify an error thrown by the generation path (`@google/genai`) into a rotation outcome, so a
 * failed generation feeds the same state machine a failed validation does.
 *
 * The SDK surfaces the upstream status either as a numeric `status`/`code` property or embedded in
 * the message text, so both are probed before falling back to the benign `net_or_5xx`.
 */
export const classifyGeminiError = (error: unknown): Outcome => {
    if (error === null || error === undefined) return { kind: "net_or_5xx" }

    const asRecord = error as { status?: unknown; code?: unknown; message?: unknown }
    const message = typeof asRecord.message === "string" ? asRecord.message : String(error)

    const numericStatus =
        typeof asRecord.status === "number"
            ? asRecord.status
            : typeof asRecord.code === "number"
                ? asRecord.code
                : null

    if (numericStatus !== null) return classifyGeminiHttp(numericStatus, message)

    const embedded = /\b(4\d{2}|5\d{2})\b/.exec(message)
    if (embedded && embedded[1] !== undefined) {
        return classifyGeminiHttp(Number.parseInt(embedded[1], 10), message)
    }

    const haystack = message.toLowerCase()
    if (haystack.includes("api_key_invalid") || haystack.includes("api key not valid")) {
        return { kind: "key_invalid" }
    }
    if (haystack.includes("resource_exhausted") || haystack.includes("quota")) {
        return haystack.includes("per day") || haystack.includes("perday")
            ? { kind: "quota_daily" }
            : { kind: "http_429" }
    }

    return { kind: "net_or_5xx" }
}
