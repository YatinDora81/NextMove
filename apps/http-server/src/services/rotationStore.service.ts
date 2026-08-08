import logger from "@/config/logger.js"
import aiKeyRepo, { type VaultKeyRow } from "@/repository/aiKeyRepo.js"
import { clearRedis, getRedis, setRedis } from "@/utils/redisCommon.js"
import {
    AllKeysBusyError,
    DEFAULT_MODEL_BUDGETS,
    MODEL_FALLBACK_CHAIN,
    RPM_WINDOW_MS,
    applyOutcome,
    markLeased,
    newLedger,
    poolHealth,
    refreshStatus,
    selectKey,
    type KeyLedger,
    type KeyState,
    type ModelBudgets,
    type ModelId,
    type Outcome,
    type PoolSnapshot,
} from "@repo/rotation"

/**
 * JF-001 SEC 15.6 — the **server host adapter** for `@repo/rotation`.
 *
 * `@repo/rotation` is pure: it never touches storage, never calls `Date.now()`, and returns a new
 * state from every mutator. This file is the server's half of that bargain — the mirror image of
 * what the extension service worker does with `chrome.storage` (SEC 5.4). Same algorithm, same
 * ladder, same Pacific-midnight boundary; only the adapters differ.
 *
 * Storage split, exactly as SEC 15.3 prescribes:
 *
 *   HOT      Redis   `aikey:rpm:{userId}:{keyId}:{model}`  60s sliding window of request stamps
 *                    `aikey:rpd:{userId}:{keyId}:{model}`  daily ledger `{ used, resetAt }`
 *   DURABLE  Postgres  status · strikes · cooldownUntil · lastUsedAt on `UserGeminiKey`
 *
 * **Redis holds ledgers about keys, never keys** (SEC 15.8). Nothing written here is secret; the
 * values are counters and timestamps.
 *
 * ── Graceful degradation ────────────────────────────────────────────────────────────────────
 * `redisCommon`'s helpers return `null`/`false` when Redis is unreachable rather than throwing, so
 * a Redis outage costs us the hot counters and nothing else: `readWindow` yields an empty window,
 * `readLedger` yields a fresh one, and selection falls back to **DB-only checks** — status,
 * cooldown deadline and DEAD-ness still gate every key. The design's rule is explicit: a Redis
 * outage must degrade the ceiling enforcement, never fail generation (SEC 15.6). Google's own 429
 * remains the authoritative limiter, and it feeds straight back in through `reportOutcome`.
 *
 * ── No cron ─────────────────────────────────────────────────────────────────────────────────
 * The daily reset is lazy: `readLedger` compares the stored `resetAt` against `now` and hands back
 * a fresh ledger once the Pacific-midnight boundary has passed. Nothing schedules anything.
 */

/* ------------------------------------------------------------------------- *
 * Redis keys and TTLs
 * ------------------------------------------------------------------------- */

const rpmKey = (userId: string, keyId: string, model: ModelId): string =>
    `aikey:rpm:${userId}:${keyId}:${model}`

const rpdKey = (userId: string, keyId: string, model: ModelId): string =>
    `aikey:rpd:${userId}:${keyId}:${model}`

/** Window is 60s; the extra minute absorbs clock skew between app instances. */
const RPM_TTL_SECONDS = Math.ceil(RPM_WINDOW_MS / 1000) + 60

/** Floor/ceiling for the daily ledger's TTL, which otherwise tracks the Pacific-midnight reset. */
const RPD_MIN_TTL_SECONDS = 60
const RPD_MAX_TTL_SECONDS = 48 * 60 * 60

const ledgerTtlSeconds = (ledger: KeyLedger, now: number): number => {
    const remaining = Math.ceil((ledger.resetAt - now) / 1000) + 300
    if (!Number.isFinite(remaining)) return RPD_MAX_TTL_SECONDS
    return Math.min(RPD_MAX_TTL_SECONDS, Math.max(RPD_MIN_TTL_SECONDS, remaining))
}

/* ------------------------------------------------------------------------- *
 * Budgets
 * ------------------------------------------------------------------------- */

/**
 * Free-tier budgets. **Approximate by nature** — Google revises free-tier limits without notice —
 * so they are soft ceilings and are overridable from configuration (SEC 5.2 / 15.6). Set
 * `WEB_MODEL_BUDGETS` to a JSON object of `{ "model": { "rpm": n, "rpd": n } }` to override or
 * extend the shipped table without a deploy of `@repo/rotation`.
 */
const parseBudgetOverrides = (): ModelBudgets => {
    const raw = process.env.WEB_MODEL_BUDGETS
    if (raw === undefined || raw.trim().length === 0) return DEFAULT_MODEL_BUDGETS

    try {
        const parsed: unknown = JSON.parse(raw)
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new TypeError("expected a JSON object")
        }

        const merged: ModelBudgets = { ...DEFAULT_MODEL_BUDGETS }
        for (const [model, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (value === null || typeof value !== "object") continue
            const candidate = value as { rpm?: unknown; rpd?: unknown }
            const rpm = typeof candidate.rpm === "number" ? candidate.rpm : null
            const rpd = typeof candidate.rpd === "number" ? candidate.rpd : null
            if (rpm === null || rpd === null || rpm < 0 || rpd < 0) continue
            merged[model] = { rpm, rpd }
        }
        return merged
    } catch (error) {
        logger.warn(`[SERVICE: rotationStore] Ignoring malformed WEB_MODEL_BUDGETS, using defaults: ${error}`)
        return DEFAULT_MODEL_BUDGETS
    }
}

const BUDGETS: ModelBudgets = parseBudgetOverrides()

/** The resolved budget table this server enforces. Exposed for status surfaces and tests. */
export const getModelBudgets = (): ModelBudgets => BUDGETS

/* ------------------------------------------------------------------------- *
 * Errors
 * ------------------------------------------------------------------------- */

/**
 * The user has nothing leasable in the vault. Distinct from {@link AllKeysBusyError}, which means
 * "come back later": this one means "the user must act", and it is what the key lane converts into
 * a `402 AI_SETUP_REQUIRED` (SEC 15.5).
 */
export class NoVaultKeysError extends Error {
    /** `true` when keys exist but every one of them is DEAD — the user must fix or replace them. */
    readonly deadKeysOnly: boolean

    constructor(deadKeysOnly: boolean) {
        super(
            deadKeysOnly
                ? "Every Gemini key in this account's vault is marked DEAD and must be replaced."
                : "No Gemini key is configured for this account."
        )
        this.name = "NoVaultKeysError"
        this.deadKeysOnly = deadKeysOnly
        Object.setPrototypeOf(this, NoVaultKeysError.prototype)
    }
}

/* ------------------------------------------------------------------------- *
 * Ledger I/O — every function here is fail-safe by construction
 * ------------------------------------------------------------------------- */

/**
 * Read the 60s sliding RPM window. A Redis miss *or* a Redis outage both yield an empty window,
 * which is the documented degradation: the per-minute ceiling stops being enforced locally, the
 * durable checks keep working, and generation proceeds.
 */
const readWindow = async (
    userId: string,
    keyId: string,
    model: ModelId,
    now: number
): Promise<number[]> => {
    const raw = await getRedis(rpmKey(userId, keyId, model))
    if (raw === null) return []

    try {
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []

        const cutoff = now - RPM_WINDOW_MS
        const stamps: number[] = []
        for (const entry of parsed) {
            if (typeof entry === "number" && Number.isFinite(entry) && entry > cutoff) stamps.push(entry)
        }
        return stamps.sort((a, b) => a - b)
    } catch {
        // A corrupt value is indistinguishable from a cold cache, and is treated the same way.
        return []
    }
}

/**
 * Read the daily ledger, rolling it lazily over the Pacific-midnight boundary — this comparison is
 * the whole reason no cron job exists (SEC 15.6).
 */
const readLedger = async (
    userId: string,
    keyId: string,
    model: ModelId,
    now: number
): Promise<KeyLedger> => {
    const raw = await getRedis(rpdKey(userId, keyId, model))
    if (raw === null) return newLedger(now)

    try {
        const parsed: unknown = JSON.parse(raw)
        if (parsed === null || typeof parsed !== "object") return newLedger(now)

        const candidate = parsed as { used?: unknown; resetAt?: unknown }
        const used = typeof candidate.used === "number" && Number.isFinite(candidate.used) ? candidate.used : null
        const resetAt =
            typeof candidate.resetAt === "number" && Number.isFinite(candidate.resetAt) ? candidate.resetAt : null

        if (used === null || resetAt === null) return newLedger(now)
        // Lazy Pacific-midnight reset: the stored deadline has passed, so the day has rolled.
        if (now >= resetAt) return newLedger(now)

        return { used: Math.max(0, used), resetAt }
    } catch {
        return newLedger(now)
    }
}

const writeWindow = async (
    userId: string,
    keyId: string,
    model: ModelId,
    stamps: readonly number[]
): Promise<void> => {
    await setRedis(rpmKey(userId, keyId, model), JSON.stringify(stamps), RPM_TTL_SECONDS)
}

const writeLedger = async (
    userId: string,
    keyId: string,
    model: ModelId,
    ledger: KeyLedger,
    now: number
): Promise<void> => {
    await setRedis(rpdKey(userId, keyId, model), JSON.stringify(ledger), ledgerTtlSeconds(ledger, now))
}

/* ------------------------------------------------------------------------- *
 * Row ⇄ KeyState
 * ------------------------------------------------------------------------- */

/**
 * Assemble the `KeyState` the pure math operates on: durable fields straight off the Postgres row,
 * hot counters from Redis, then `refreshStatus` to apply the lazy recoveries (an elapsed cooldown
 * becomes ACTIVE, a rolled daily ledger un-EXHAUSTS the key) before anything looks at it.
 */
const toKeyState = async (
    userId: string,
    row: VaultKeyRow,
    model: ModelId,
    now: number
): Promise<KeyState> => {
    const [stamps, ledger] = await Promise.all([
        readWindow(userId, row.id, model, now),
        readLedger(userId, row.id, model, now),
    ])

    const base: KeyState = {
        id: row.id,
        status: row.status,
        strikes: row.strikes,
        cooldownUntil: row.cooldownUntil === null ? 0 : row.cooldownUntil.getTime(),
        lastUsedAt: row.lastUsedAt === null ? 0 : row.lastUsedAt.getTime(),
        rpm: { [model]: stamps },
        daily: { [model]: ledger },
    }

    return refreshStatus(base, model, now)
}

/** Persist the durable half of a state back to Postgres. */
const persistDurable = async (userId: string, state: KeyState): Promise<void> => {
    await aiKeyRepo.updateRotationState(userId, state.id, {
        status: state.status,
        strikes: state.strikes,
        cooldownUntil: state.cooldownUntil > 0 ? new Date(state.cooldownUntil) : null,
        lastUsedAt: state.lastUsedAt > 0 ? new Date(state.lastUsedAt) : null,
    })
}

/** Persist the hot half of a state back to Redis. Both writes are individually fail-safe. */
const persistHot = async (userId: string, state: KeyState, model: ModelId, now: number): Promise<void> => {
    const stamps = state.rpm[model] ?? []
    const ledger = state.daily[model] ?? newLedger(now)
    await Promise.all([
        writeWindow(userId, state.id, model, stamps),
        writeLedger(userId, state.id, model, ledger, now),
    ])
}

/* ------------------------------------------------------------------------- *
 * Public API
 * ------------------------------------------------------------------------- */

/** A key checked out for one request, together with the model it was checked out for. */
export interface VaultLease {
    /** The sealed row. Only `keyLane.service.ts` may open it. */
    row: VaultKeyRow
    /** The model the lease was accounted against — may differ from the requested one. */
    model: ModelId
    /** The post-`markLeased` state, already persisted. */
    state: KeyState
}

/**
 * Lease one of the user's vault keys for one Gemini call.
 *
 * LRU over healthy keys, so three keys give a user roughly 3× the free throughput of one — exactly
 * the extension's behaviour, exactly the same code (SEC 15.6). Accounting is optimistic: the key is
 * marked used the moment it is handed out, and `reportOutcome` refunds the daily unit if the call
 * turns out to have failed for reasons that are not the key's fault.
 *
 * When no model is requested, the SEC 5.2 fallback chain is walked lazily —
 * `gemini-2.5-flash-lite → gemini-2.5-flash → gemini-2.0-flash` — so a pool that has spent its
 * budget on the cheap model degrades the model rather than failing the user. Ledgers are only read
 * for models actually attempted.
 *
 * @throws {NoVaultKeysError} the user has no leasable key — the caller turns this into 402.
 * @throws {AllKeysBusyError} keys exist but none can serve right now; `retryAt` says when.
 */
export const leaseKey = async (userId: string, requestedModel?: ModelId): Promise<VaultLease> => {
    const rows = await aiKeyRepo.findActiveForUser(userId)

    if (rows.length === 0) {
        // Distinguish "never set one up" from "all of them are DEAD": both need the user, but the
        // second deserves different copy in the UI (SEC 15.7 error surfaces).
        const total = await aiKeyRepo.countForUser(userId)
        throw new NoVaultKeysError(total > 0)
    }

    const rowsById = new Map<string, VaultKeyRow>(rows.map((row) => [row.id, row]))
    const candidates: readonly ModelId[] =
        requestedModel === undefined ? MODEL_FALLBACK_CHAIN : [requestedModel]

    const now = Date.now()
    let earliestRetryAt = Number.POSITIVE_INFINITY

    for (const model of candidates) {
        const states = await Promise.all(rows.map((row) => toKeyState(userId, row, model, now)))

        let chosen: KeyState
        try {
            chosen = selectKey(states, model, BUDGETS, now)
        } catch (error) {
            if (error instanceof AllKeysBusyError) {
                earliestRetryAt = Math.min(earliestRetryAt, error.retryAt)
                continue
            }
            throw error
        }

        const row = rowsById.get(chosen.id)
        if (row === undefined) continue // Row vanished between the query and now; try the next model.

        const leased = markLeased(chosen, model, now)

        // Optimistic accounting is written before the call goes out: a crash mid-call must leave
        // the key looking *more* used, never less.
        await Promise.all([persistHot(userId, leased, model, now), persistDurable(userId, leased)])

        logger.debug(
            `[SERVICE: leaseKey] Leased vault key ${row.id} for user ${userId} on ${model} ` +
            `(rpm=${(leased.rpm[model] ?? []).length}, rpd=${(leased.daily[model] ?? newLedger(now)).used})`
        )

        return { row, model, state: leased }
    }

    throw new AllKeysBusyError(earliestRetryAt)
}

/**
 * Feed the result of a Gemini call back into the state machine (SEC 5.4):
 * `ok` clears strikes, `http_429` steps the 60s → 5m → 30m ladder, `quota_daily` pins the ledger to
 * the ceiling until Pacific midnight, `key_invalid` kills the key, and `net_or_5xx` refunds the
 * optimistic daily unit because a Google outage is not the key's fault.
 *
 * Never throws: a bookkeeping failure must not turn a successful generation into a 500. The worst
 * case is a stale ledger, which the next 429 corrects.
 */
export const reportOutcome = async (
    userId: string,
    keyId: string,
    model: ModelId,
    outcome: Outcome
): Promise<void> => {
    try {
        const row = await aiKeyRepo.findById(userId, keyId)
        if (row === null) return // Deleted mid-request — nothing to account against.

        const now = Date.now()
        const state = await toKeyState(userId, row, model, now)
        const next = applyOutcome(state, model, outcome, now, BUDGETS)

        await Promise.all([persistHot(userId, next, model, now), persistDurable(userId, next)])

        if (outcome.kind !== "ok") {
            logger.warn(
                `[SERVICE: reportOutcome] Vault key ${keyId} → ${next.status} after ${outcome.kind} ` +
                `(strikes=${next.strikes}, model=${model})`
            )
        }
    } catch (error) {
        logger.error(`[SERVICE: reportOutcome] Failed to record outcome for key ${keyId}`, error)
    }
}

/**
 * Per-key health for one model — status plus, for keys that cannot serve right now, when they can.
 * Backs the countdown copy the UI shows when every key is cooling (SEC 15.7). DEAD keys are absent
 * because they are not leasable; the masked list already shows them with a DEAD badge.
 */
export const poolStatus = async (userId: string, model?: ModelId): Promise<PoolSnapshot[]> => {
    const resolved = model ?? MODEL_FALLBACK_CHAIN[0] ?? "gemini-2.5-flash-lite"
    const rows = await aiKeyRepo.findActiveForUser(userId)
    if (rows.length === 0) return []

    const now = Date.now()
    const states = await Promise.all(rows.map((row) => toKeyState(userId, row, resolved, now)))
    return poolHealth(states, resolved, BUDGETS, now)
}

/**
 * Drop every hot ledger belonging to a key. Called when the key is deleted, so a later key that
 * somehow reused the id could never inherit a stranded counter. The sealed row itself is shredded
 * by `aiKeyRepo.hardDelete`; there is nothing secret here to clean up (SEC 15.8).
 */
export const forgetKey = async (userId: string, keyId: string): Promise<void> => {
    const models = new Set<ModelId>([...MODEL_FALLBACK_CHAIN, ...Object.keys(BUDGETS)])

    await Promise.all(
        [...models].flatMap((model) => [
            clearRedis(rpmKey(userId, keyId, model)),
            clearRedis(rpdKey(userId, keyId, model)),
        ])
    )
}
