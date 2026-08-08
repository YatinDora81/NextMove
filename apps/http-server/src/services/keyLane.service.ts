import gemini, { DEFAULT_WEB_MODEL } from "@/config/gemini.js"
import logger from "@/config/logger.js"
import aiKeyRepo from "@/repository/aiKeyRepo.js"
import { NoVaultKeysError, forgetKey, leaseKey, reportOutcome } from "@/services/rotationStore.service.js"
import { KeyVaultDecryptError, openKey } from "@/utils/keyVault.js"
import { envFlag } from "@/utils/mustEnv.js"
import { getRedis, setRedis } from "@/utils/redisCommon.js"
import userRepo from "@/repository/userRepo.js"
import { MAX_KEYS_PER_REQUEST, type Outcome } from "@repo/rotation"

/**
 * JF-001 SEC 15.5 — **the key lane**. Generation changes in exactly one place: key selection.
 *
 *   lane 3 · managed  premium web users      → the server's own `GEMINI_API_KEY` pool (unchanged)
 *   lane 2 · vault    free-tier web users    → their own sealed key + `@repo/rotation` (SEC 15.6)
 *
 * (Lane 1, the extension's on-device vault, never touches this server at all — INV-5 / INV-6.)
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THIS FILE IS THE ONE DECRYPT SITE (SEC 15.8).
 * `openKey` is imported here and nowhere else in the repository — no controller, no repository, no
 * route ever holds a plaintext user key that it did not receive as a `LeasedKey`. Verify it:
 *
 *     grep -rn "openKey" apps/http-server/src
 *
 * (The grep also matches `utils/keyVault.ts`, which declares it and round-trips a synthetic literal
 * in its boot self-test. No other module calls it, and no stored row is opened anywhere else.)
 *
 * Plaintext is created per request, handed to the caller for the duration of one Google call, and
 * never written to a log, a cache, a JWT claim, a Redis value or a response body.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** Which pool a request's key came from. */
export type Lane = "managed" | "vault"

/**
 * One key checked out for one request.
 *
 * `userId` is an additive extension to the SEC 15.5 sketch: `reportLaneOutcome` has to know whose
 * ledgers to update, and every vault query is tenant-scoped by design, so the lease has to carry
 * its owner. `keyLane()` is the only producer, and it always populates it.
 */
export interface LeasedKey {
    /** Plaintext API key. Request-scoped: use it, then drop it. Never log this field. */
    apiKey: string
    lane: Lane
    /** The `UserGeminiKey` row id for the vault lane; `null` for the managed lane. */
    keyId: string | null
    /** The model this lease was accounted against — the rotation math may have degraded it. */
    model: string
    /** Owner of the lease. Required by `reportLaneOutcome`. */
    userId: string
}

/** Why the caller must be sent to Settings → AI Keys. Drives the copy on the 402 card (SEC 15.7). */
export type AiSetupReason = "no-keys" | "dead-keys"

/**
 * A free-tier user needs to bring a key before AI features work.
 *
 * Controllers translate this into `402 { success:false, data:{ code:'AI_SETUP_REQUIRED' }, … }`,
 * which the frontend renders as an inline card deep-linking to Settings → AI Keys (SEC 15.5/15.7).
 */
export class AiSetupRequiredError extends Error {
    readonly code = "AI_SETUP_REQUIRED"
    readonly reason: AiSetupReason

    constructor(reason: AiSetupReason = "no-keys") {
        super(
            reason === "dead-keys"
                ? "Your saved Gemini key is no longer accepted by Google. Add a working key in Settings → AI Keys."
                : "Add your own free Google Gemini key in Settings → AI Keys to use AI features."
        )
        this.name = "AiSetupRequiredError"
        this.reason = reason
        Object.setPrototypeOf(this, AiSetupRequiredError.prototype)
    }
}

/**
 * SEC 15.7 rollout flag. Default `false` — the 30-day grandfather window, during which a free user
 * with no vault key silently falls back to the managed key instead of being blocked. Flip it to
 * `true` on flip day and those requests start returning 402 instead. Premium is untouched either way.
 */
export const WEB_BYOK_REQUIRED: boolean = envFlag("WEB_BYOK_REQUIRED", false)

/** Mirrors `middleware/isPremium.ts`: same Redis key, same payload, same 24h TTL. */
const PREMIUM_CACHE_TTL_SECONDS = 86400
const premiumCacheKey = (userId: string): string => `premium:${userId}`

interface PremiumRecord {
    isPaid: boolean
}

/**
 * The Redis-backed premium check the SEC 15.5 sketch calls `isPremiumCached`.
 *
 * `middleware/isPremium.ts` does this inline as a *guard* — it answers a request with 401 when the
 * user is not premium. The lane needs the same fact as a *value*, so rather than copy the middleware
 * (and risk the two drifting on cache key, payload shape or TTL) this reuses all three verbatim:
 * key `premium:{userId}`, payload `{ isPaid }`, TTL 24h. A cache entry written by either one is
 * read correctly by the other, and `userRepo.getPremium` remains the single source of truth.
 *
 * Redis being down is not an error here — `getRedis`/`setRedis` degrade to `null`/`false` and the
 * check simply falls through to Postgres.
 */
export const isPremiumCached = async (userId: string): Promise<boolean> => {
    const cached = await getRedis(premiumCacheKey(userId))
    if (cached !== null) {
        try {
            const parsed = JSON.parse(cached) as PremiumRecord
            if (typeof parsed?.isPaid === "boolean") return parsed.isPaid
        } catch {
            // Corrupt entry — fall through and refresh it from Postgres.
        }
    }

    const record = await userRepo.getPremium(userId)
    await setRedis(premiumCacheKey(userId), JSON.stringify(record), PREMIUM_CACHE_TTL_SECONDS)
    return record.isPaid
}

/**
 * Lane 3 — the owner-paid managed key. `asFallback` distinguishes the two ways we get here:
 * a premium user (a missing managed key is a server misconfiguration → 500) versus a free user
 * riding the grandfather window (a missing managed key means they genuinely have to set one up
 * themselves → 402).
 */
const managedLease = (userId: string, model: string | undefined, asFallback: boolean): LeasedKey => {
    if (!gemini.hasManagedKey()) {
        if (asFallback) throw new AiSetupRequiredError("no-keys")
        throw new Error(
            "No managed Gemini API key is configured on this server. Set GEMINI_API_KEY, or GEMINI_API_KEY_NAMES to a JSON array of env var names."
        )
    }

    return {
        apiKey: gemini.nextManagedKey(),
        lane: "managed",
        keyId: null,
        model: model ?? DEFAULT_WEB_MODEL,
        userId,
    }
}

/**
 * Pick the key this request will spend.
 *
 * Premium → the managed pool, exactly the path that existed before JF-001. Free → an LRU-selected
 * key from the user's own vault, opened for this request only. A free user with nothing usable hits
 * the `WEB_BYOK_REQUIRED` fork: fall back to the managed key during the grandfather window, or get
 * an {@link AiSetupRequiredError} once the flag is flipped.
 *
 * @throws {AiSetupRequiredError}  free user, no usable vault key, flag on → controller answers 402.
 * @throws {AllKeysBusyError}      vault keys exist but all are cooling/exhausted; `retryAt` says when.
 */
export const keyLane = async (userId: string, model?: string): Promise<LeasedKey> => {
    if (await isPremiumCached(userId)) {
        return managedLease(userId, model, false)
    }

    // A row that will not decrypt is unusable no matter how healthy its rotation state looks, so it
    // is retired and the next key tried. Bounded by the same per-request key budget the extension
    // uses, so a pathologically corrupt vault cannot spin.
    for (let attempt = 0; attempt < MAX_KEYS_PER_REQUEST; attempt += 1) {
        let lease
        try {
            lease = await leaseKey(userId, model)
        } catch (error) {
            if (error instanceof NoVaultKeysError) return noUsableVaultKey(userId, model, error.deadKeysOnly)
            throw error
        }

        try {
            // ── THE ONE DECRYPT SITE (SEC 15.8) ───────────────────────────────────────────────
            // In memory, for this request, for one Google call. Not logged, not cached, not returned.
            const apiKey = openKey(lease.row, userId, lease.row.id)

            return {
                apiKey,
                lane: "vault",
                keyId: lease.row.id,
                model: lease.model,
                userId,
            }
        } catch (error) {
            if (!(error instanceof KeyVaultDecryptError)) throw error

            // openKey has already logged the alertable error and bumped the failure counter.
            logger.error(
                `[SERVICE: keyLane] Retiring undecryptable vault key ${lease.row.id} for user ${userId}`
            )
            await aiKeyRepo.updateRotationState(userId, lease.row.id, { status: "DEAD" })
            await forgetKey(userId, lease.row.id)
        }
    }

    // Every key we reached was corrupt — from the user's point of view identical to having none.
    return noUsableVaultKey(userId, model, true)
}

/**
 * The SEC 15.7 rollout fork, in one place so both entry points behave identically:
 * flag off ⇒ grandfather onto the managed key; flag on ⇒ 402 AI_SETUP_REQUIRED.
 */
const noUsableVaultKey = (userId: string, model: string | undefined, deadKeysOnly: boolean): LeasedKey => {
    if (WEB_BYOK_REQUIRED) {
        throw new AiSetupRequiredError(deadKeysOnly ? "dead-keys" : "no-keys")
    }

    logger.info(
        `[SERVICE: keyLane] Free user ${userId} has no usable vault key; serving from the managed lane ` +
        "(WEB_BYOK_REQUIRED=false — 30-day grandfather window, SEC 15.7)."
    )
    return managedLease(userId, model, true)
}

/**
 * Open one specific vault key by id — the **only** other decrypt entry point, and it exists so that
 * `POST /api/ai-keys/:id/test` can re-validate a key without `openKey` escaping this file.
 *
 * Deliberately bypasses rotation: a user pressing "Test" is an explicit action against a named key,
 * not metered generation, so it must work on a COOLDOWN or EXHAUSTED key (that is precisely when a
 * user wants to check one) and it must not consume the key's budget.
 *
 * @returns `null` when the id does not belong to this user, or the row will not decrypt.
 */
export const openVaultKey = async (userId: string, keyId: string): Promise<LeasedKey | null> => {
    const row = await aiKeyRepo.findById(userId, keyId)
    if (row === null) return null

    try {
        // ── THE ONE DECRYPT SITE (SEC 15.8) ────────────────────────────────────────────────────
        const apiKey = openKey(row, userId, row.id)
        return { apiKey, lane: "vault", keyId: row.id, model: DEFAULT_WEB_MODEL, userId }
    } catch (error) {
        if (!(error instanceof KeyVaultDecryptError)) throw error

        logger.error(`[SERVICE: openVaultKey] Retiring undecryptable vault key ${keyId} for user ${userId}`)
        await aiKeyRepo.updateRotationState(userId, keyId, { status: "DEAD" })
        await forgetKey(userId, keyId)
        return null
    }
}

/**
 * Close the loop: feed the result of the Gemini call back into the rotation state machine so the
 * next lease sees an accurate picture (SEC 5.4 / 15.6).
 *
 * Managed-lane outcomes have no durable row to record against — the env pool is not rotated by
 * `@repo/rotation` — so they are logged and dropped. Vault outcomes drive strikes, cooldowns, the
 * daily ledger and DEAD-ness.
 *
 * Never throws: bookkeeping must not be able to turn a successful generation into a 500.
 */
export const reportLaneOutcome = async (leased: LeasedKey, outcome: Outcome): Promise<void> => {
    if (leased.lane === "managed" || leased.keyId === null) {
        if (outcome.kind !== "ok") {
            logger.warn(`[SERVICE: reportLaneOutcome] Managed-lane call ended with ${outcome.kind}`)
        }
        return
    }

    await reportOutcome(leased.userId, leased.keyId, leased.model, outcome)
}
