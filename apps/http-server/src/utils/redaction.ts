import winston, { format, type Logger } from "winston"

// `logform` is a transitive dependency of winston and is not directly resolvable from this
// workspace under pnpm's strict layout, so its types are reached through winston's re-export.
type Format = winston.Logform.Format
type TransformableInfo = winston.Logform.TransformableInfo

/**
 * JF-001 SEC 15.2 / 15.8 — log redaction.
 *
 * "Key exposure via logs" is a first-class threat in the SEC 15.2 table, and SEC 15.8 makes the
 * countermeasure testable rather than aspirational: **"Redaction is tested, not promised."**
 * {@link scrubSecrets} is exported standalone precisely so a CI test can push a fake key through it
 * and assert the key cannot survive serialization — no Winston instance required.
 *
 * Two layers, because either one alone leaks:
 *  1. **Pattern** — anything shaped like a Google API key (`AIza…`) is masked wherever it appears,
 *     including in the middle of a free-text message or an upstream error body.
 *  2. **Field name** — values of fields called `key`, `apiKey`, `ciphertext` (and the obvious
 *     neighbours) are dropped entirely, since a sealed blob or an unrecognised key format would
 *     sail straight past the pattern.
 *
 * This module never *stores* what it redacts and never returns the original value.
 */

/**
 * Google API keys are `AIza` + 35 URL-safe characters. The `{10,}` tail deliberately under-matches
 * the real length so that truncated, concatenated or future-format keys are still caught.
 *
 * Recreated per call site rather than shared: a `/g` regex carries mutable `lastIndex` state, and a
 * shared instance would skip matches on alternating calls.
 */
const geminiKeyPattern = (): RegExp => /AIza[0-9A-Za-z_-]{10,}/g

/** Exposed for the CI redaction test so it asserts against the exact production pattern. */
export const GEMINI_KEY_PATTERN_SOURCE = "AIza[0-9A-Za-z_-]{10,}"

/** What a redacted value is replaced with. Distinctive enough to grep for in production logs. */
export const REDACTED = "[REDACTED]"

/**
 * Field names whose *values* are dropped wholesale, compared case-insensitively with `_`/`-`
 * separators removed (so `api_key`, `apiKey` and `API-KEY` all match).
 *
 * `key`, `apiKey` and `ciphertext` are the SEC 15.8 minimum; the rest close the obvious side doors
 * (the sealed row's `iv`/`authTag`, the master key, JWTs and passwords that share these loggers).
 */
const SENSITIVE_FIELD_NAMES: ReadonlySet<string> = new Set([
    "key",
    "apikey",
    "geminikey",
    "geminiapikey",
    "ciphertext",
    "plaintext",
    "authtag",
    "iv",
    "masterkey",
    "keyvaultmasterkey",
    "secret",
    "password",
    "token",
    "accesstoken",
    "refreshtoken",
    "authorization",
    "jwtsecret",
])

/** How deep to walk a payload before giving up. Guards against pathological nesting. */
const MAX_DEPTH = 8

/** Cap on scrubbed string length, so a giant upstream error body cannot flood the log file. */
const MAX_STRING_LENGTH = 8_000

const normaliseFieldName = (name: string): string => name.toLowerCase().replace(/[_\-\s]/g, "")

/** `true` when a field with this name must have its value removed regardless of the value's shape. */
export const isSensitiveFieldName = (name: string): boolean =>
    SENSITIVE_FIELD_NAMES.has(normaliseFieldName(name))

/** Mask every `AIza…` occurrence inside a string. Returns the input unchanged when there is none. */
export const scrubString = (value: string): string => {
    const masked = value.replace(geminiKeyPattern(), REDACTED)
    return masked.length > MAX_STRING_LENGTH ? `${masked.slice(0, MAX_STRING_LENGTH)}…[truncated]` : masked
}

const scrubError = (error: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> => {
    const out: Record<string, unknown> = {
        name: error.name,
        message: scrubString(error.message),
    }
    if (typeof error.stack === "string") out.stack = scrubString(error.stack)

    // Error subclasses (Prisma, node:crypto, fetch) hang useful context off own enumerable props.
    for (const field of Object.keys(error)) {
        if (field === "name" || field === "message" || field === "stack") continue
        out[field] = isSensitiveFieldName(field)
            ? REDACTED
            : walk((error as unknown as Record<string, unknown>)[field], depth + 1, seen)
    }
    return out
}

const walk = (value: unknown, depth: number, seen: WeakSet<object>): unknown => {
    if (value === null || value === undefined) return value

    if (typeof value === "string") return scrubString(value)
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value
    if (typeof value === "symbol") return scrubString(value.toString())
    if (typeof value === "function") return "[Function]"

    if (depth > MAX_DEPTH) return "[MaxDepth]"

    // Raw bytes are never useful in a log line and are exactly how sealed key material travels.
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return REDACTED

    if (value instanceof Date) return value.toISOString()
    if (value instanceof RegExp) return value.toString()

    if (typeof value === "object") {
        const asObject = value as object
        if (seen.has(asObject)) return "[Circular]"
        seen.add(asObject)

        if (value instanceof Error) return scrubError(value, depth, seen)

        if (Array.isArray(value)) return value.map((entry) => walk(entry, depth + 1, seen))

        if (value instanceof Map) {
            const out: Record<string, unknown> = {}
            for (const [mapKey, mapValue] of value.entries()) {
                const name = String(mapKey)
                out[name] = isSensitiveFieldName(name) ? REDACTED : walk(mapValue, depth + 1, seen)
            }
            return out
        }

        if (value instanceof Set) return [...value].map((entry) => walk(entry, depth + 1, seen))

        const out: Record<string, unknown> = {}
        for (const field of Object.keys(asObject)) {
            out[field] = isSensitiveFieldName(field)
                ? REDACTED
                : walk((asObject as Record<string, unknown>)[field], depth + 1, seen)
        }
        return out
    }

    return scrubString(String(value))
}

/**
 * Remove every secret from an arbitrary log payload and return a **new** value — the argument is
 * never mutated, so a redacted log line can never corrupt the object the caller is still using.
 *
 * This is the function the SEC 15.8 CI test drives: feed it a fake `AIza…` key in any position
 * (bare string, nested object, `Error.message`, array element, `Map` value, `Buffer`) and assert
 * that `JSON.stringify` of the result contains neither the key nor its prefix.
 */
export const scrubSecrets = (value: unknown): unknown => walk(value, 0, new WeakSet<object>())

/** Convenience wrapper for log messages, which are strings far more often than not. */
export const scrubMessage = (value: unknown): unknown =>
    typeof value === "string" ? scrubString(value) : scrubSecrets(value)

/**
 * Winston format factory that scrubs `info.message` and every meta field before any transport sees
 * the record. Logger-level formats run *before* transport-level formats in Winston, so installing
 * this once on the logger covers the Console and File transports alike.
 *
 * Defensive by construction: if scrubbing itself ever throws, the record is dropped rather than
 * passed through un-redacted — losing a log line is strictly better than leaking a key.
 */
export const redactSecrets = format((info: TransformableInfo): TransformableInfo | boolean => {
    try {
        info.message = scrubMessage(info.message)

        for (const field of Object.keys(info)) {
            if (field === "message" || field === "level") continue
            info[field] = isSensitiveFieldName(field) ? REDACTED : scrubSecrets(info[field])
        }

        return info
    } catch {
        return false
    }
})

/** Ready-made instance for `format.combine(redactionFormat, …)`. */
export const redactionFormat: Format = redactSecrets()

const INSTALLED = Symbol.for("nextmove.redaction.installed")

/**
 * Prepend {@link redactionFormat} to an existing Winston logger's format chain, in place.
 *
 * The app logger (`config/logger.ts`) is shared by every track in this monorepo, so rather than
 * rewrite it we harden it from the one module that actually handles secrets — `utils/keyVault.ts`
 * calls this at import time, which means the redaction is live from the moment the vault is
 * reachable. Idempotent: a second call is a no-op, so wiring it explicitly in `logger.ts` later
 * costs nothing.
 */
export const installRedaction = (target: Logger): Logger => {
    const marker = target as unknown as Record<symbol, unknown>
    if (marker[INSTALLED] === true) return target

    target.format = target.format
        ? format.combine(redactionFormat, target.format)
        : redactionFormat
    marker[INSTALLED] = true

    return target
}
