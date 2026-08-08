import type { Request, Response } from "express"
import logger from "@/config/logger.js"
import { touchPairedDevice } from "@/controllers/deviceControllers.js"
import jobApplicationRepo, {
    DEFAULT_PAGE_SIZE,
    JobApplicationOwnershipError,
    MAX_PAGE_SIZE,
    countPatchFields,
    isParseableDate
} from "@/repository/jobApplicationRepo.js"
import { jobAppStatusSchema, jobApplicationPatchSchema, jobApplicationRowSchema } from "@repo/types/ExtensionTypes"
import type { jobAppStatusSchemaType } from "@repo/types/ExtensionTypes"

/**
 * JF-001 SEC 8.3 - `GET|POST|PATCH|DELETE /api/job-applications`.
 *
 * The tracker sync surface: idempotent on `clientId`, cursor paginated, filterable by status. Feeds
 * the Applications tab of the unified Applied dashboard (SEC 8.5).
 *
 * Request bodies come from the shared Zod schemas in `@repo/types/ExtensionTypes` - the same
 * objects the extension's sync client validates against, so the two cannot drift (SEC 8.4).
 * Query strings are not bodies and have no shared schema; they are parsed and clamped here, with
 * `status` still checked against the shared `jobAppStatusSchema` rather than a local copy.
 */

/** Single query param as a string, ignoring arrays/objects that Express may produce. */
const queryString = (value: unknown): string | null =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : null

class JobApplicationControllers {
    /**
     * `GET /api/job-applications?cursor=&limit=&status=`
     *
     * Cursor pagination: pass the previous response's `nextCursor` straight back. `total` is only
     * computed for the first page - it is a header stat for the dashboard, and re-counting the
     * whole table on every scroll would be pure waste.
     */
    async list(req: Request, res: Response) {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    data: null,
                    message: "Unauthorized"
                })
                return
            }

            const rawStatus = queryString(req.query["status"])
            let status: jobAppStatusSchemaType | null = null
            if (rawStatus) {
                const parsedStatus = jobAppStatusSchema.safeParse(rawStatus.toUpperCase())
                if (!parsedStatus.success) {
                    res.status(400).json({
                        success: false,
                        data: parsedStatus.error,
                        message: "Invalid status filter"
                    })
                    return
                }
                status = parsedStatus.data
            }

            const rawLimit = queryString(req.query["limit"])
            let limit = DEFAULT_PAGE_SIZE
            if (rawLimit) {
                const parsedLimit = Number.parseInt(rawLimit, 10)
                if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
                    res.status(400).json({
                        success: false,
                        data: null,
                        message: `limit must be an integer between 1 and ${MAX_PAGE_SIZE}`
                    })
                    return
                }
                limit = Math.min(parsedLimit, MAX_PAGE_SIZE)
            }

            const cursor = queryString(req.query["cursor"])

            touchPairedDevice(req)

            const page = await jobApplicationRepo.listForUser(req.user.user_id, { cursor, limit, status })
            const total = cursor ? null : await jobApplicationRepo.countForUser(req.user.user_id, status)

            res.status(200).json({
                success: true,
                data: {
                    items: page.items,
                    nextCursor: page.nextCursor,
                    hasMore: page.hasMore,
                    total
                },
                message: "Job applications fetched successfully"
            })
        } catch (error) {
            logger.error(`[CONTROLLER: list] Error listing job applications for user: ${req.user?.user_id}`, error)
            res.status(500).json({
                success: false,
                data: null,
                message: "Internal Server Error"
            })
        }
    }

    /**
     * `POST /api/job-applications` - create or replace, keyed on `clientId`.
     *
     * Idempotent by design: the extension retries pushes whenever it comes back online, and a retry
     * must land on the same row (201 the first time, 200 thereafter). A `clientId` that already
     * belongs to another account is a 409, never a silent overwrite.
     */
    async create(req: Request, res: Response) {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    data: null,
                    message: "Unauthorized"
                })
                return
            }

            const parsedData = jobApplicationRowSchema.safeParse(req.body)
            if (!parsedData.success) {
                res.status(400).json({
                    success: false,
                    data: parsedData.error,
                    message: "Invalid data"
                })
                return
            }

            const appliedAt = parsedData.data.appliedAt
            if (typeof appliedAt === "string" && appliedAt.length > 0 && !isParseableDate(appliedAt)) {
                res.status(400).json({
                    success: false,
                    data: null,
                    message: "appliedAt must be an ISO date string"
                })
                return
            }

            touchPairedDevice(req)

            const result = await jobApplicationRepo.upsertByClientId(req.user.user_id, parsedData.data)
            res.status(result.created ? 201 : 200).json({
                success: true,
                data: result.record,
                message: result.created
                    ? "Job application created successfully"
                    : "Job application updated successfully"
            })
        } catch (error) {
            if (error instanceof JobApplicationOwnershipError) {
                logger.warn(
                    `[CONTROLLER: create] User ${req.user?.user_id} attempted to write clientId ${error.clientId} owned by another account`
                )
                res.status(409).json({
                    success: false,
                    data: { code: error.code },
                    message: "That application id is already in use. Generate a new one on the device."
                })
                return
            }

            logger.error(`[CONTROLLER: create] Error saving job application for user: ${req.user?.user_id}`, error)
            res.status(500).json({
                success: false,
                data: null,
                message: "Internal Server Error"
            })
        }
    }

    /**
     * `PATCH /api/job-applications/:clientId` - partial update (the status kanban's write path).
     *
     * Only the keys actually present in the body are written, so moving a card from APPLIED to
     * INTERVIEW cannot blank out the notes.
     */
    async patch(req: Request, res: Response) {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    data: null,
                    message: "Unauthorized"
                })
                return
            }

            const clientId = req.params["clientId"]
            if (!clientId) {
                res.status(400).json({
                    success: false,
                    data: null,
                    message: "clientId is required"
                })
                return
            }

            const parsedData = jobApplicationPatchSchema.safeParse(req.body)
            if (!parsedData.success) {
                res.status(400).json({
                    success: false,
                    data: parsedData.error,
                    message: "Invalid data"
                })
                return
            }

            if (countPatchFields(parsedData.data) === 0) {
                res.status(400).json({
                    success: false,
                    data: null,
                    message: "Patch body must contain at least one field to update"
                })
                return
            }

            const appliedAt = parsedData.data.appliedAt
            if (typeof appliedAt === "string" && appliedAt.length > 0 && !isParseableDate(appliedAt)) {
                res.status(400).json({
                    success: false,
                    data: null,
                    message: "appliedAt must be an ISO date string"
                })
                return
            }

            touchPairedDevice(req)

            const record = await jobApplicationRepo.patchByClientId(req.user.user_id, clientId, parsedData.data)
            if (!record) {
                res.status(404).json({
                    success: false,
                    data: null,
                    message: "Job application not found"
                })
                return
            }

            res.status(200).json({
                success: true,
                data: record,
                message: "Job application updated successfully"
            })
        } catch (error) {
            logger.error(`[CONTROLLER: patch] Error patching job application for user: ${req.user?.user_id}`, error)
            res.status(500).json({
                success: false,
                data: null,
                message: "Internal Server Error"
            })
        }
    }

    /** `DELETE /api/job-applications/:clientId` - remove one row, scoped to its owner. */
    async remove(req: Request, res: Response) {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    data: null,
                    message: "Unauthorized"
                })
                return
            }

            const clientId = req.params["clientId"]
            if (!clientId) {
                res.status(400).json({
                    success: false,
                    data: null,
                    message: "clientId is required"
                })
                return
            }

            touchPairedDevice(req)

            const deleted = await jobApplicationRepo.deleteByClientId(req.user.user_id, clientId)
            if (!deleted) {
                res.status(404).json({
                    success: false,
                    data: null,
                    message: "Job application not found"
                })
                return
            }

            res.status(200).json({
                success: true,
                data: { clientId },
                message: "Job application deleted successfully"
            })
        } catch (error) {
            logger.error(`[CONTROLLER: remove] Error deleting job application for user: ${req.user?.user_id}`, error)
            res.status(500).json({
                success: false,
                data: null,
                message: "Internal Server Error"
            })
        }
    }
}

export default new JobApplicationControllers()
