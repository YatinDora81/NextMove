import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto"
import logger from "@/config/logger.js"
import { mustEnv, mustEnvBase64Bytes, optionalEnv } from "@/utils/mustEnv.js"
import { installRedaction, scrubSecrets } from "@/utils/redaction.js"

/**
 * ============================================================================================
 * JF-001 SEC 15.4 — THE ONLY FILE IN THIS REPOSITORY THAT TOUCHES A PLAINTEXT USER GEMINI KEY.
 * ============================================================================================
 *
 * Envelope encryption over `node:crypto`:
 *   AES-256-GCM · fresh 12-byte CSPRNG IV per encryption · AAD = userId · authTag stored apart ·
 *   `keyVersion` on every row so the master key can rotate without downtime.
 *
 * `sealKey` is called from the add-key controller; `openKey` is called on real user rows from
 * exactly one place — `services/keyLane.service.ts` — per request, held in memory for the duration
 * of one Google call, then dropped (SEC 15.8, "one decrypt site"). That property is grep-auditable:
 *
 *     grep -rn "openKey" apps/http-server/src
 *
 * The only other call site the grep turns up is the boot self-test at the bottom of THIS file,
 * which round-trips a synthetic literal under a synthetic owner id and never touches a stored row.
 *
 * ---------------------------------------------------------------------------------------------
 * HONEST LIMIT (SEC 15.2, stated here rather than buried in a doc)
 * ---------------------------------------------------------------------------------------------
 * A **fully compromised live server can read these keys at call time**. It has the master key in
 * memory and it has the ciphertext, so it has the plaintext — this is true of every server-side
 * BYOK product, and no amount of AES fixes it.
 *
 * What this file actually buys:
 *   · a stolen database dump or backup decrypts to nothing, because the master key never lives
 *     in the database;
 *   · a row lifted into another user's context fails authentication instead of silently
 *     succeeding, because the AAD binds ciphertext to its owner;
 *   · a master-key compromise is recoverable, because `keyVersion` lets a new master be added and
 *     old rows re-sealed lazily.
 *
 * Encryption **complements, never replaces, access control**. The zero-trust option for users who
 * will not accept the honest limit is the extension lane, where the key never leaves the device
 * (SEC 15.1 lane 1 / INV-5). Say so on the setup page; do not imply more than the above.
 * ---------------------------------------------------------------------------------------------
 */

/**
 * SEC 15.8 "no log line ever carries a plaintext key" is enforced, not promised: loading the vault
 * hardens the shared Winston logger with the redaction format before any secret can reach it.
 * Idempotent, so wiring it explicitly in `config/logger.ts` later remains a no-op.
 */
installRedaction(logger)

/** AES-256-GCM: 32-byte key, 12-byte nonce, 16-byte tag. */
export const KEY_VAULT_ALGORITHM = "aes-256-gcm"
const MASTER_KEY_BYTES = 32
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

/**
 * Master keys by version.
 *
 * ROTATION RECIPE (SEC 15.2, "master-key compromise"):
 *   1. generate a new master:  `openssl rand -base64 32`
 *   2. set `KEY_VAULT_MASTER_KEY_V2` in the environment
 *   3. uncomment the version-2 line below and bump `CURRENT` to 2
 *   4. deploy — new keys seal under v2, existing v1 rows keep opening, and each row re-seals
 *      lazily the next time it is used (see `needsReseal`). No downtime, no bulk migration.
 */
const MASTERS: Record<number, Buffer> = {
    // 32 bytes, base64 — asserted at module load, i.e. at boot, exactly like the JWT guard.
    // Deliberately a SEPARATE secret from JWT_SECRET and INTERNAL_API_SECRET (SEC 15.8):
    // rotating any one of the three must never touch the others.
    1: mustEnvBase64Bytes("KEY_VAULT_MASTER_KEY", MASTER_KEY_BYTES),

    // 2: mustEnvBase64Bytes("KEY_VAULT_MASTER_KEY_V2", MASTER_KEY_BYTES),  ← rotation slot
}

/** The version new ciphertext is sealed under. Bump together with a new `MASTERS` entry. */
export const CURRENT_KEY_VERSION = 1
const CURRENT = CURRENT_KEY_VERSION

/**
 * Boot assertion: the vault master must not be the JWT secret. Sharing them would mean a leaked
 * signing secret also unseals every stored key — the exact coupling SEC 15.8 forbids.
 */
const assertSecretsAreDistinct = (): void => {
    const master = MASTERS[CURRENT]
    if (master === undefined) return

    const jwtSecret = optionalEnv("JWT_SECRET", "")
    if (jwtSecret.length === 0) return

    const jwtBytes = Buffer.from(jwtSecret, "utf8")
    const sameAsUtf8 = jwtBytes.length === master.length && timingSafeEqual(jwtBytes, master)

    const jwtAsBase64 = Buffer.from(jwtSecret, "base64")
    const sameAsBase64 = jwtAsBase64.length === master.length && timingSafeEqual(jwtAsBase64, master)

    if (sameAsUtf8 || sameAsBase64) {
        throw new Error(
            "KEY_VAULT_MASTER_KEY must not equal JWT_SECRET (JF-001 SEC 15.8: separate secrets — " +
            "rotating one must never touch the other). Generate a distinct value with: openssl rand -base64 32"
        )
    }
}

assertSecretsAreDistinct()

/**
 * The sealed material produced by {@link sealKey}. Field names line up 1:1 with the
 * `UserGeminiKey` columns (SEC 15.3) so the repository can spread it straight into Prisma.
 */
export interface SealedKey {
    ciphertext: Buffer
    iv: Buffer
    authTag: Buffer
    keyVersion: number
    /** Display-only tail — the entire surface the list UI is allowed to see (SEC 15.5). */
    last4: string
}

/**
 * The subset of a `UserGeminiKey` row {@link openKey} needs. Declared structurally rather than
 * importing Prisma's model type, so this file stays independent of the generated client and can be
 * unit-tested with plain objects. Prisma returns `Bytes` columns as `Uint8Array`.
 */
export interface UserGeminiKeyRow {
    ciphertext: Uint8Array
    iv: Uint8Array
    authTag: Uint8Array
    keyVersion: number
}

/** Thrown when a row will not open. Carries no key material — only the row's version. */
export class KeyVaultDecryptError extends Error {
    readonly keyVersion: number

    constructor(message: string, keyVersion: number) {
        super(message)
        this.name = "KeyVaultDecryptError"
        this.keyVersion = keyVersion
        Object.setPrototypeOf(this, KeyVaultDecryptError.prototype)
    }
}

/**
 * Decrypt-failure counter (SEC 15.4: "decrypt failures are alerted — Winston error + counter").
 * A non-zero value means tampering, corruption, a master-key mix-up, or a bug; none of those are
 * normal, so this is an alertable signal rather than a metric with an acceptable baseline.
 */
let decryptFailureCount = 0

/** Current decrypt-failure count. Read by health/metrics surfaces and by the CI vault test. */
export const getDecryptFailureCount = (): number => decryptFailureCount

/** Reset the counter. Test-only affordance; production never calls it. */
export const resetDecryptFailureCount = (): void => {
    decryptFailureCount = 0
}

/** Prisma hands back `Uint8Array`; `node:crypto` wants a `Buffer`. Views the same memory, no copy. */
const toBuffer = (bytes: Uint8Array): Buffer =>
    Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)

const masterFor = (version: number): Buffer => {
    const master = MASTERS[version]
    if (master === undefined) {
        throw new KeyVaultDecryptError(
            `No master key configured for keyVersion ${version}. ` +
            "A row sealed under a retired master cannot be opened — restore the master or have the user re-add the key.",
            version
        )
    }
    return master
}

/**
 * Seal a plaintext Gemini API key for one owner.
 *
 * The IV is a **fresh 12 random bytes from the CSPRNG on every call** — never derived from the
 * user id, never a counter, never reused. GCM's one catastrophic footgun is nonce reuse under the
 * same key (it leaks the authentication subkey and XORs the plaintexts), so this line is the most
 * safety-critical in the file (SEC 15.2, "nonce reuse").
 *
 * The AAD is the owner's user id: the ciphertext is cryptographically bound to whose key it is, so
 * a row copied into another user's context fails authentication instead of decrypting to garbage
 * that later gets sent to Google.
 *
 * `plaintext` is request-scoped. It is never logged, never cached, never echoed in a response.
 */
export const sealKey = (plaintext: string, userId: string): SealedKey => {
    if (typeof plaintext !== "string" || plaintext.length === 0) {
        throw new TypeError("sealKey: plaintext must be a non-empty string")
    }
    if (typeof userId !== "string" || userId.length === 0) {
        throw new TypeError("sealKey: userId must be a non-empty string — it is the AAD binding")
    }

    const iv = randomBytes(IV_BYTES) // fresh CSPRNG nonce — never derived, never reused
    const cipher = createCipheriv(KEY_VAULT_ALGORITHM, masterFor(CURRENT), iv)
    cipher.setAAD(Buffer.from(userId, "utf8")) // binds ciphertext to its owner

    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])

    return {
        ciphertext,
        iv,
        authTag: cipher.getAuthTag(),
        keyVersion: CURRENT,
        last4: plaintext.slice(-4),
    }
}

/**
 * Open a sealed row back into a plaintext key, for one owner, for the duration of one request.
 *
 * Called from `services/keyLane.service.ts` and nowhere else (SEC 15.8). A wrong owner context, a
 * flipped byte, or a truncated tag all throw here rather than returning silent garbage, because
 * GCM authenticates the ciphertext and the AAD together.
 *
 * Every failure increments {@link getDecryptFailureCount} and logs a Winston error carrying the
 * row's identity and *nothing else* — no ciphertext, no IV, no partial plaintext.
 */
export const openKey = (row: UserGeminiKeyRow, userId: string, keyId?: string): string => {
    if (typeof userId !== "string" || userId.length === 0) {
        throw new TypeError("openKey: userId must be a non-empty string — it is the AAD binding")
    }

    const iv = toBuffer(row.iv)
    const authTag = toBuffer(row.authTag)
    const ciphertext = toBuffer(row.ciphertext)

    try {
        if (iv.byteLength !== IV_BYTES) {
            throw new KeyVaultDecryptError(
                `Stored IV is ${iv.byteLength} bytes, expected ${IV_BYTES}`,
                row.keyVersion
            )
        }
        if (authTag.byteLength !== AUTH_TAG_BYTES) {
            throw new KeyVaultDecryptError(
                `Stored authTag is ${authTag.byteLength} bytes, expected ${AUTH_TAG_BYTES}`,
                row.keyVersion
            )
        }

        const decipher = createDecipheriv(KEY_VAULT_ALGORITHM, masterFor(row.keyVersion), iv)
        decipher.setAAD(Buffer.from(userId, "utf8")) // wrong owner context ⇒ throws, never silent garbage
        decipher.setAuthTag(authTag)

        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
    } catch (error) {
        // Alertable: tampering, corruption, a master-key mix-up, or a bug — never routine.
        decryptFailureCount += 1
        logger.error(
            `[VAULT: openKey] Decrypt failed (keyId=${keyId ?? "unknown"} userId=${userId} ` +
            `keyVersion=${row.keyVersion} failures=${decryptFailureCount}) — tampering, corruption, or a bug`,
            scrubSecrets(error)
        )

        if (error instanceof KeyVaultDecryptError) throw error
        throw new KeyVaultDecryptError(
            "Stored key could not be decrypted; it may have been tampered with or sealed under a different master key.",
            row.keyVersion
        )
    }
}

/**
 * `true` when a row was sealed under a superseded master and should be re-sealed on next use —
 * the lazy half of the rotation recipe at the top of this file.
 */
export const needsReseal = (row: Pick<UserGeminiKeyRow, "keyVersion">): boolean =>
    row.keyVersion !== CURRENT

/**
 * Re-seal an already-open plaintext under the current master. Kept next to `openKey` so the
 * rotation path never has to reach for `sealKey` from outside this file.
 */
export const resealKey = (plaintext: string, userId: string): SealedKey => sealKey(plaintext, userId)

/**
 * Boot self-test: seal and open a throwaway value so a misconfigured master fails at startup
 * rather than on a user's first request. Uses a synthetic owner id and a synthetic secret; nothing
 * derived from a real key ever reaches this path.
 */
const selfTest = (): void => {
    const probeOwner = "keyvault-selftest"
    const probeSecret = "AIza-self-test-not-a-real-key"
    const sealed = sealKey(probeSecret, probeOwner)
    const opened = openKey(sealed, probeOwner, "selftest")
    if (opened !== probeSecret) {
        throw new Error("keyVault self-test failed: sealed value did not round-trip")
    }
    // The self-test must not leave a phantom failure on the alertable counter.
    resetDecryptFailureCount()
}

selfTest()

// `mustEnv` is re-exported so callers that need another required secret do not import a second
// module just to fail fast; it also keeps the SEC 15.4 sketch's `mustEnv(...)` call site honest.
export { mustEnv }
