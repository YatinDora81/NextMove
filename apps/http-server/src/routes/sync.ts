import { Router } from "express"
import syncControllers from "@/controllers/syncControllers.js"
import { authenticateUser } from "@/middleware/authenticateUser.js"
import { syncRateLimit } from "@/middleware/rateLimit.js"

/**
 * JF-001 SEC 8.3 - E2E profile blob + site mapping sync, mounted at `/api/sync`.
 *
 *   GET /api/sync/profile    JWT   ciphertext down
 *   PUT /api/sync/profile    JWT   ciphertext up, optimistic `version` -> 409 VERSION_CONFLICT
 *   GET /api/sync/mappings   JWT
 *   PUT /api/sync/mappings   JWT   last-write-wins per (domain, sigHash)
 *
 * Every route is authenticated and metered at 60/min/user (SEC 8.4). `authenticateUser` precedes
 * `syncRateLimit` because the limiter keys on the verified `user_id`.
 */
const router: Router = Router()

router.get("/profile", authenticateUser, syncRateLimit, syncControllers.getProfileBlob)
router.put("/profile", authenticateUser, syncRateLimit, syncControllers.putProfileBlob)
router.get("/mappings", authenticateUser, syncRateLimit, syncControllers.getMappings)
router.put("/mappings", authenticateUser, syncRateLimit, syncControllers.putMappings)

export default router
