import { Router } from "express"
import jobApplicationControllers from "@/controllers/jobApplicationControllers.js"
import { authenticateUser } from "@/middleware/authenticateUser.js"
import { syncRateLimit } from "@/middleware/rateLimit.js"

/**
 * JF-001 SEC 8.3 - tracker CRUD, mounted at `/api/job-applications`.
 *
 *   GET    /api/job-applications              JWT   cursor paginated, `?cursor=&limit=&status=`
 *   POST   /api/job-applications              JWT   create-or-replace, idempotent on clientId
 *   PATCH  /api/job-applications/:clientId    JWT   partial update
 *   DELETE /api/job-applications/:clientId    JWT   delete
 *
 * Rows are addressed by `clientId` - the id the extension minted - rather than the server's own
 * row id, so an offline device can build a request without a round trip first. Every query is
 * scoped by `req.user.user_id` inside the repository.
 *
 * `authenticateUser` precedes `syncRateLimit` because the limiter meters per verified user
 * (60/min, SEC 8.4).
 */
const router: Router = Router()

router.get("/", authenticateUser, syncRateLimit, jobApplicationControllers.list)
router.post("/", authenticateUser, syncRateLimit, jobApplicationControllers.create)
router.patch("/:clientId", authenticateUser, syncRateLimit, jobApplicationControllers.patch)
router.delete("/:clientId", authenticateUser, syncRateLimit, jobApplicationControllers.remove)

export default router
