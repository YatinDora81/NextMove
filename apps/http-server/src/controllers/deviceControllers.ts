import { randomInt } from "node:crypto"
import type { Request, Response } from "express"
import jwt from "jsonwebtoken"
import logger from "@/config/logger.js"
import deviceRepo from "@/repository/deviceRepo.js"
import type { PairingUser } from "@/repository/deviceRepo.js"
import { clearRedis, getRedis, setRedis } from "@/utils/redisCommon.js"
import { pairRequestSchema } from "@repo/types/ExtensionTypes"
import type { pairCodeResponseSchemaType, pairResponseSchemaType } from "@repo/types/ExtensionTypes"

/**
 * JF-001 SEC 8.2 - extension/account pairing and device management.
 *
 * The extension never sees a password and never touches a cookie. The whole handshake is a
 * short-lived code exchange:
 *
 *   1. web (JWT)      POST /api/devices/pair-code -> 8-char code in Redis, `pair:{code}` -> userId, TTL 300s
 *   2. extension      POST /api/devices/pair {code, deviceName} -> the code is burned, a Device row
 *                     is created, and the same 7-day JWT NextMove already signs comes back
 *
 * The code is a bearer credential for five minutes, so it is never written to a log line - not on
 * mint, not on redemption, not on failure.
 */

/**
 * Unambiguous alphabet (SPINE 2.10): no 0/O, no 1/I/L. Users read these codes off one screen and
 * type them into another, so glyph collisions are a support-ticket generator, not a nitpick.
 */
const PAIR_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const PAIR_CODE_LENGTH = 8
const PAIR_CODE_TTL_SEC = 300
/** How many times to re-roll if a freshly generated code happens to be live already. */
const PAIR_CODE_MAX_ATTEMPTS = 5
const DEVICE_TOKEN_TTL = "7d"

const pairKey = (code: string): string => `pair:${code}`

/**
 * Codes come from `node:crypto.randomInt`, never `Math.random` (SPINE 2.10) - `Math.random` is a
 * predictable PRNG and this value is a five-minute credential for a whole account.
 *
 * `charAt` rather than `[i]`: under `noUncheckedIndexedAccess` an indexed read is `string |
 * undefined`, and silently coalescing that to `""` would quietly shorten the code.
 */
const randomPairCode = (): string => {
    let code = ""
    for (let i = 0; i < PAIR_CODE_LENGTH; i++) {
        code += PAIR_CODE_ALPHABET.charAt(randomInt(PAIR_CODE_ALPHABET.length))
    }
    return code
}

/** Users paste codes with spaces, dashes and stray case. Normalise before the Redis lookup. */
const normalizePairCode = (code: string): string => code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")

/**
 * Signs the exact payload `authControllers.generateToken` signs, so `authenticateUser` accepts a
 * paired device's token without a single change (SEC 14.3 - the middleware guards sync routes
 * "unmodified"). `device_id` is additive: it identifies which install is calling so `lastSeen` can
 * be stamped. Nothing authorises off it.
 */
const signDeviceToken = (user: PairingUser, deviceId: string): string => {
    const secret = process.env.JWT_SECRET
    if (!secret) {
        throw new Error("JWT_SECRET is not configured in environment variables")
    }

    const payload = {
        user_id: user.id,
        email: user.email,
        full_name: `${user.firstName} ${user.lastName || ""}`.trim(),
        azp: "nextmove",
        iss: "nextmove",
        sub: user.id,
        image_url: "",
        phone_number: null,
        device_id: deviceId
    }

    return jwt.sign(payload, secret, { expiresIn: DEVICE_TOKEN_TTL })
}

/**
 * Reads the optional `device_id` claim off an already-verified token. `req.user` is typed as
 * `authTokenSchemaType`, which predates pairing and has no such field, so the claim is narrowed
 * from `unknown` instead of asserted.
 */
export const deviceIdFromToken = (req: Request): string | null => {
    const claims = req.user as unknown as Record<string, unknown> | undefined
    if (!claims) return null
    const deviceId = claims["device_id"]
    return typeof deviceId === "string" && deviceId.length > 0 ? deviceId : null
}

/**
 * Fire-and-forget "this install is alive" stamp for the Settings device list. Never awaited and
 * never able to throw (`deviceRepo.touchLastSeen` swallows its own errors), because bookkeeping
 * must not be able to fail a sync request.
 */
export const touchPairedDevice = (req: Request): void => {
    const userId = req.user?.user_id
    const deviceId = deviceIdFromToken(req)
    if (!userId || !deviceId) return
    void deviceRepo.touchLastSeen(userId, deviceId)
}

class DeviceControllers {
    /**
     * `POST /api/devices/pair-code` (JWT) - mint a single-use pairing code.
     *
     * Redis is the only store for these; if Redis is down we answer 503 rather than degrade. This
     * is the one place in the sync API that must NOT fail open: a pairing code that cannot be
     * stored cannot be redeemed, and a code that cannot be deleted cannot be single-use.
     */
    async mintPairCode(req: Request, res: Response) {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    data: null,
                    message: "Unauthorized"
                })
                return
            }

            const userId = req.user.user_id
            let code: string | null = null
            let storeFailed = false

            for (let attempt = 0; attempt < PAIR_CODE_MAX_ATTEMPTS; attempt++) {
                const candidate = randomPairCode()
                const taken = await getRedis(pairKey(candidate))
                if (taken) continue

                const stored = await setRedis(pairKey(candidate), userId, PAIR_CODE_TTL_SEC)
                if (!stored) {
                    storeFailed = true
                    break
                }
                code = candidate
                break
            }

            if (!code) {
                logger.error(
                    `[CONTROLLER: mintPairCode] Could not mint a pairing code for user: ${userId} (${storeFailed ? "redis write failed" : "collision limit reached"})`
                )
                res.status(503).json({
                    success: false,
                    data: null,
                    message: "Pairing is temporarily unavailable. Please try again in a moment."
                })
                return
            }

            // The code itself is deliberately absent from this log line - it is a live credential.
            logger.info(`[CONTROLLER: mintPairCode] Pairing code minted for user: ${userId}`)

            const payload: pairCodeResponseSchemaType = { code, expiresInSec: PAIR_CODE_TTL_SEC }
            res.status(201).json({
                success: true,
                data: payload,
                message: "Pairing code created successfully"
            })
        } catch (error) {
            logger.error(`[CONTROLLER: mintPairCode] Error minting pairing code for user: ${req.user?.user_id}`, error)
            res.status(500).json({
                success: false,
                data: null,
                message: "Internal Server Error"
            })
        }
    }

    /**
     * `POST /api/devices/pair` (public, rate-limited 5/min/IP) - redeem a code for a device token.
     *
     * The code is deleted *before* the token is issued: single-use has to survive a crash between
     * the two steps, and the safe direction to fail is "the user re-mints a code", not "one code
     * pairs an unbounded number of devices". If the delete cannot be confirmed we refuse outright.
     */
    async pairDevice(req: Request, res: Response) {
        try {
            const parsedData = pairRequestSchema.safeParse(req.body)
            if (!parsedData.success) {
                res.status(400).json({
                    success: false,
                    data: parsedData.error,
                    message: "Invalid data"
                })
                return
            }

            const code = normalizePairCode(parsedData.data.code)
            if (code.length === 0) {
                res.status(401).json({
                    success: false,
                    data: { code: "INVALID_OR_EXPIRED_CODE" },
                    message: "That pairing code is invalid or has expired. Generate a new one."
                })
                return
            }

            const userId = await getRedis(pairKey(code))
            if (!userId) {
                res.status(401).json({
                    success: false,
                    data: { code: "INVALID_OR_EXPIRED_CODE" },
                    message: "That pairing code is invalid or has expired. Generate a new one."
                })
                return
            }

            const burned = await clearRedis(pairKey(code))
            if (!burned) {
                logger.error("[CONTROLLER: pairDevice] Could not burn a pairing code - refusing to issue a token")
                res.status(503).json({
                    success: false,
                    data: null,
                    message: "Pairing is temporarily unavailable. Please try again in a moment."
                })
                return
            }

            const user = await deviceRepo.findPairingUser(userId)
            if (!user) {
                // The account disappeared between minting and redeeming. Same answer as a bad code.
                logger.warn(`[CONTROLLER: pairDevice] Pairing code resolved to a missing user: ${userId}`)
                res.status(401).json({
                    success: false,
                    data: { code: "INVALID_OR_EXPIRED_CODE" },
                    message: "That pairing code is invalid or has expired. Generate a new one."
                })
                return
            }

            const device = await deviceRepo.create(user.id, parsedData.data.deviceName)
            const token = signDeviceToken(user, device.id)

            logger.info(`[CONTROLLER: pairDevice] Device ${device.id} paired for user: ${user.id}`)

            const payload: pairResponseSchemaType = { token, device }
            res.status(201).json({
                success: true,
                data: payload,
                message: "Device paired successfully"
            })
        } catch (error) {
            logger.error("[CONTROLLER: pairDevice] Error pairing device", error)
            res.status(500).json({
                success: false,
                data: null,
                message: "Internal Server Error"
            })
        }
    }

    /** `GET /api/devices` (JWT) - the "Connected devices" list in web Settings. */
    async listDevices(req: Request, res: Response) {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    data: null,
                    message: "Unauthorized"
                })
                return
            }

            touchPairedDevice(req)

            const devices = await deviceRepo.listForUser(req.user.user_id)
            res.status(200).json({
                success: true,
                data: devices,
                message: "Devices fetched successfully"
            })
        } catch (error) {
            logger.error(`[CONTROLLER: listDevices] Error listing devices for user: ${req.user?.user_id}`, error)
            res.status(500).json({
                success: false,
                data: null,
                message: "Internal Server Error"
            })
        }
    }

    /**
     * `DELETE /api/devices/:id` (JWT) - revoke a paired install.
     *
     * **Honest limitation.** Deleting the row stops that device appearing in Settings and removes
     * the anchor for its `lastSeen`, but the JWT it already holds stays cryptographically valid
     * until it expires (at most 7 days) - nothing on the request path consults the `Device` table,
     * because `authenticateUser` verifies a signature and nothing else. Closing that window needs a
     * denylist (a `revoked:{jti}` / `revoked:{device_id}` key checked in the auth middleware) or
     * shorter-lived tokens with refresh. Neither exists yet, and this comment exists so nobody
     * reads "revoke" here and assumes it is instant. SEC 8.5 states the same thing from the user's
     * side: "token dies at next 401".
     */
    async revokeDevice(req: Request, res: Response) {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    data: null,
                    message: "Unauthorized"
                })
                return
            }

            const deviceId = req.params["id"]
            if (!deviceId) {
                res.status(400).json({
                    success: false,
                    data: null,
                    message: "Device id is required"
                })
                return
            }

            // Read first so the response can name the device the UI just removed. Both calls are
            // scoped by user id, so a foreign device id is a 404 and never a leak.
            const device = await deviceRepo.findById(req.user.user_id, deviceId)
            if (!device) {
                res.status(404).json({
                    success: false,
                    data: null,
                    message: "Device not found"
                })
                return
            }

            const deleted = await deviceRepo.deleteForUser(req.user.user_id, deviceId)
            if (!deleted) {
                res.status(404).json({
                    success: false,
                    data: null,
                    message: "Device not found"
                })
                return
            }

            logger.info(`[CONTROLLER: revokeDevice] Device ${deviceId} revoked for user: ${req.user.user_id}`)

            res.status(200).json({
                success: true,
                data: device,
                message: "Device revoked. Its existing token stays valid until it expires (up to 7 days)."
            })
        } catch (error) {
            logger.error(`[CONTROLLER: revokeDevice] Error revoking device for user: ${req.user?.user_id}`, error)
            res.status(500).json({
                success: false,
                data: null,
                message: "Internal Server Error"
            })
        }
    }
}

export default new DeviceControllers()
