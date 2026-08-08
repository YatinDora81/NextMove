import { config } from "dotenv"

/**
 * JF-001 SEC 15.4 — fail-fast environment reader.
 *
 * The vault's boot sequence must die loudly rather than start half-configured: a server that
 * boots without `KEY_VAULT_MASTER_KEY` would either seal keys under an empty master or crash on
 * the first user request, both of which are worse than refusing to start. Every error names the
 * offending variable so the operator does not have to guess.
 *
 * `dotenv` is loaded here for the same reason `config/redis.ts` and `config/gemini.ts` load it:
 * ES module bodies evaluate before `index.ts` calls `config()`, so any module that reads
 * `process.env` at import time must pull the `.env` file in itself. `config()` never overwrites
 * variables that are already present in the real environment, so this is safe to call repeatedly.
 */
config()

/** Thrown when a required environment variable is missing, blank, or malformed. */
export class MissingEnvError extends Error {
    readonly variable: string

    constructor(variable: string, detail: string) {
        super(`Missing or invalid environment variable ${variable}: ${detail}`)
        this.name = "MissingEnvError"
        this.variable = variable
        // Keeps `instanceof` correct once the build downlevels `extends Error`.
        Object.setPrototypeOf(this, MissingEnvError.prototype)
    }
}

/**
 * Read a required environment variable. Throws {@link MissingEnvError} naming the variable when it
 * is absent or empty (after trimming — a variable set to whitespace is a configuration mistake,
 * not a value).
 */
export const mustEnv = (name: string): string => {
    const raw = process.env[name]
    if (raw === undefined) {
        throw new MissingEnvError(name, "it is not set. Add it to the server environment / .env file.")
    }

    const value = raw.trim()
    if (value.length === 0) {
        throw new MissingEnvError(name, "it is set but empty.")
    }

    return value
}

/**
 * Read an optional environment variable, returning `fallback` when it is absent or empty.
 * Never throws — used for feature flags and tunables that have a safe default.
 */
export const optionalEnv = (name: string, fallback: string): string => {
    const raw = process.env[name]
    if (raw === undefined) return fallback

    const value = raw.trim()
    return value.length === 0 ? fallback : value
}

/**
 * Read a boolean feature flag. Only the explicit strings `true`/`1`/`yes`/`on` enable a flag
 * (case-insensitive); anything else — including a typo — resolves to `fallback`. Flags fail closed
 * towards their documented default rather than towards "whatever the string was truthy for".
 *
 * Used for `WEB_BYOK_REQUIRED` (SEC 15.7), whose default is `false` for the 30-day grandfather window.
 */
export const envFlag = (name: string, fallback: boolean): boolean => {
    const raw = process.env[name]
    if (raw === undefined) return fallback

    const value = raw.trim().toLowerCase()
    if (value.length === 0) return fallback
    if (value === "true" || value === "1" || value === "yes" || value === "on") return true
    if (value === "false" || value === "0" || value === "no" || value === "off") return false

    return fallback
}

/**
 * Read a required environment variable holding base64 bytes and assert its decoded length.
 *
 * `Buffer.from(x, 'base64')` silently discards characters it does not understand, so a truncated
 * or line-wrapped secret decodes to a short buffer instead of failing — exactly the failure mode
 * that would leave the vault sealing under a weak master key. The length assertion below is what
 * turns that silent corruption into a boot error (SEC 15.4).
 */
export const mustEnvBase64Bytes = (name: string, expectedBytes: number): Buffer => {
    const value = mustEnv(name)
    const decoded = Buffer.from(value, "base64")

    if (decoded.byteLength !== expectedBytes) {
        throw new MissingEnvError(
            name,
            `expected ${expectedBytes} base64-decoded bytes but got ${decoded.byteLength}. ` +
            `Generate one with: openssl rand -base64 ${expectedBytes}`
        )
    }

    return decoded
}
