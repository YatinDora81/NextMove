import { createHash } from "node:crypto"
import type { NextFunction, Request, RequestHandler, Response } from "express"
import logger from "@/config/logger.js"
import { isRedisReady } from "@/config/redis.js"
import { getRedis, setRedis } from "@/utils/redisCommon.js"

/**
 * JF-001 SEC 8.4 — Redis token-bucket rate limiting for the Phase-2 sync surface.
 *
 *   POST /api/devices/pair   5/min/IP    (public route — the only unauthenticated sync endpoint)
 *   authed sync routes      60/min/user
 *
 * Built on the existing `redisCommon` helpers so the limiter inherits their graceful degradation
 * (SPINE 1.1: those helpers return `null`/`false` instead of throwing when Redis is down).
 *
 * **Fail-open is a deliberate decision.** A Redis outage must never lock every user out of their
 * own data — a throttle that becomes an outage amplifier is worse than no throttle. When Redis is
 * unreachable this middleware logs a throttled warning and calls `next()`. The trade-off is honest:
 * during an outage there is *no* rate limiting, so pair-code brute force is bounded only by the
 * 300 s TTL and the 31^8 (~8.5e11) code space, not by this middleware.
 *
 * **Honest limitation — the bucket update is not atomic.** `redisCommon` exposes GET/SET/DEL only,
 * so a bucket is read, refilled in process, and written back. Two requests that interleave between
 * the GET and the SET can each spend the same token, so the effective ceiling under heavy
 * concurrency is slightly above `max`. That is acceptable for abuse throttling (the bound stays
 * O(max), it does not degrade to unlimited) and is the price of not reaching past the shared
 * helpers into the raw client. An atomic version would need INCR/EXPIRE or a Lua script in
 * `redisCommon` itself, which this file deliberately does not own.
 */

/** Redis key namespace: `rl:{name}:{identity}`. */
const KEY_PREFIX = "rl"

/** How often an ongoing Redis outage may re-log, so a dead Redis cannot flood the log file. */
const OUTAGE_WARN_INTERVAL_MS = 30_000

/** Serialised bucket state. `t` = tokens left, `u` = epoch ms of the last update. */
interface Bucket {
    t: number
    u: number
}

export interface RateLimitOptions {
    /** Refill window in seconds — a fully drained bucket is full again this long after the last hit. */
    windowSec: number
    /** Bucket capacity: how many requests one identity may burst before it is throttled. */
    max: number
    /** Extracts the identity to meter. Returning `null` opts the request out of limiting entirely. */
    keyBy: (req: Request) => string | null
    /** Namespace so buckets of different limiters never collide. Defaults to `"default"`. */
    name?: string
}

let lastOutageWarnAt = 0

const warnOutage = (name: string, detail: string): void => {
    const now = Date.now()
    if (now - lastOutageWarnAt < OUTAGE_WARN_INTERVAL_MS) return
    lastOutageWarnAt = now
    logger.warn(
        `[MIDDLEWARE: rateLimit] Redis unavailable (${detail}) — the '${name}' limiter is FAILING OPEN and letting traffic through.`
    )
}

/**
 * Identities are hashed before they become Redis keys. For `keyByIp` that keeps raw client IPs out
 * of Redis entirely (SEC 9.2 posture: we do not retain IPs), and it keeps every key a fixed, safe
 * length regardless of what the identity was.
 */
const hashIdentity = (value: string): string =>
    createHash("sha256").update(value).digest("base64url").slice(0, 22)

const readBucket = (raw: string | null, max: number, now: number): Bucket => {
    if (!raw) return { t: max, u: now }
    try {
        const parsed: unknown = JSON.parse(raw)
        if (typeof parsed !== "object" || parsed === null) return { t: max, u: now }
        const { t, u } = parsed as { t?: unknown; u?: unknown }
        if (typeof t !== "number" || !Number.isFinite(t)) return { t: max, u: now }
        if (typeof u !== "number" || !Number.isFinite(u)) return { t: max, u: now }
        // Clamp so a corrupt or clock-skewed record can neither grant extra tokens nor stall refill.
        return { t: Math.min(Math.max(t, 0), max), u: Math.min(u, now) }
    } catch {
        return { t: max, u: now }
    }
}

/**
 * Builds a rate-limiting middleware. Every instance is independent — its own namespace, capacity
 * and identity function.
 */
export const rateLimit = ({ windowSec, max, keyBy, name = "default" }: RateLimitOptions): RequestHandler => {
    if (!Number.isFinite(windowSec) || windowSec <= 0) {
        throw new Error(`[rateLimit] windowSec must be a positive number, received: ${windowSec}`)
    }
    if (!Number.isInteger(max) || max <= 0) {
        throw new Error(`[rateLimit] max must be a positive integer, received: ${max}`)
    }

    const refillPerMs = max / (windowSec * 1000)
    // Long enough that an idle bucket only ever expires once it would have refilled anyway.
    const ttlSec = Math.ceil(windowSec) + 1

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const identity = keyBy(req)
            if (!identity) {
                next()
                return
            }

            if (!isRedisReady()) {
                warnOutage(name, "client not ready")
                next()
                return
            }

            const key = `${KEY_PREFIX}:${name}:${identity}`
            const now = Date.now()
            const stored = readBucket(await getRedis(key), max, now)
            const tokens = Math.min(max, stored.t + Math.max(0, now - stored.u) * refillPerMs)

            if (tokens >= 1) {
                const bucket: Bucket = { t: tokens - 1, u: now }
                const written = await setRedis(key, JSON.stringify(bucket), ttlSec)
                if (!written) warnOutage(name, "bucket write failed")
                res.setHeader("X-RateLimit-Limit", String(max))
                res.setHeader("X-RateLimit-Remaining", String(Math.floor(bucket.t)))
                next()
                return
            }

            // Drained. Persist the advanced clock so the deficit is measured from *this* moment.
            const retryAfterSec = Math.max(1, Math.ceil((1 - tokens) / refillPerMs / 1000))
            const bucket: Bucket = { t: tokens, u: now }
            await setRedis(key, JSON.stringify(bucket), ttlSec)

            res.setHeader("Retry-After", String(retryAfterSec))
            res.setHeader("X-RateLimit-Limit", String(max))
            res.setHeader("X-RateLimit-Remaining", "0")
            res.status(429).json({
                success: false,
                data: { code: "RATE_LIMITED", retryAfterSec },
                message: `Too many requests. Please retry in ${retryAfterSec} second${retryAfterSec === 1 ? "" : "s"}.`
            })
        } catch (error) {
            // Any unexpected failure in the limiter itself must not take the route down with it.
            logger.error(`[MIDDLEWARE: rateLimit] '${name}' limiter errored — failing open`, error)
            next()
        }
    }
}

/**
 * Per-IP identity for public routes.
 *
 * Uses Express's own `req.ip` rather than reading `X-Forwarded-For` directly: without an explicit
 * `app.set('trust proxy', …)` any client could forge that header and walk straight around the
 * limiter. Behind a load balancer the app owner must enable `trust proxy` in `index.ts` (owned by
 * the integration agent) — until then every request behind the proxy shares one bucket, which is
 * the safe direction to be wrong in.
 */
export const keyByIp = (req: Request): string => hashIdentity(req.ip ?? req.socket.remoteAddress ?? "unknown")

/** Per-user identity for authenticated routes. Must run *after* `authenticateUser`. */
export const keyByUser = (req: Request): string | null => {
    const userId = req.user?.user_id
    return userId ? hashIdentity(userId) : null
}

/** SEC 8.4 — `POST /api/devices/pair`: 5 requests per minute per IP. */
export const pairRateLimit: RequestHandler = rateLimit({
    name: "pair",
    windowSec: 60,
    max: 5,
    keyBy: keyByIp
})

/** SEC 8.4 — every authenticated sync route: 60 requests per minute per user. */
export const syncRateLimit: RequestHandler = rateLimit({
    name: "sync",
    windowSec: 60,
    max: 60,
    keyBy: keyByUser
})
