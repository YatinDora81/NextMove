import { Router } from "express"
import deviceControllers from "@/controllers/deviceControllers.js"
import { authenticateUser } from "@/middleware/authenticateUser.js"
import { pairRateLimit, syncRateLimit } from "@/middleware/rateLimit.js"

/**
 * JF-001 SEC 8.3 - device pairing and management, mounted at `/api/devices`.
 *
 *   POST   /api/devices/pair-code   JWT              mint a single-use code (Redis, 300s TTL)
 *   POST   /api/devices/pair        rate-limited     redeem a code -> Device row + 7-day JWT
 *   GET    /api/devices             JWT              list paired installs
 *   DELETE /api/devices/:id         JWT              revoke one
 *
 * `POST /pair` is the only route in the Phase-2 surface without `authenticateUser` - it *is* the
 * authentication step, so it carries the pairing code as its credential and `pairRateLimit`
 * (5/min/IP) as its brute-force ceiling instead.
 *
 * Middleware order matters on the authed routes: `authenticateUser` runs first because
 * `syncRateLimit` meters per `req.user.user_id`, which does not exist until the token is verified.
 */
const router: Router = Router()

router.post("/pair-code", authenticateUser, syncRateLimit, deviceControllers.mintPairCode)
router.post("/pair", pairRateLimit, deviceControllers.pairDevice)
router.get("/", authenticateUser, syncRateLimit, deviceControllers.listDevices)
router.delete("/:id", authenticateUser, syncRateLimit, deviceControllers.revokeDevice)

export default router
