import logger from "@/config/logger.js"
import Prisma, { prismaClient } from "@repo/db/db"
import { jobApplicationRowSchema } from "@repo/types/ExtensionTypes"
import type {
    jobAppStatusSchemaType,
    jobApplicationPatchSchemaType,
    jobApplicationRowSchemaType
} from "@repo/types/ExtensionTypes"

/**
 * JF-001 SEC 7.4 / 8.3 - Prisma CRUD over `JobApplication`, the tracker rows the extension pushes
 * up and the unified Applied dashboard reads back.
 *
 * Two rules run through every method:
 *
 *  1. **Tenant scoping is not optional.** `userId` appears in the `where` clause of every read,
 *     update and delete. `clientId` is globally unique in the schema, which makes it a perfectly
 *     good idempotency key *and* a perfectly good way to write over a stranger's row if it were
 *     used naked - so the upsert resolves the row by `clientId`, checks the owner, and refuses
 *     (`JobApplicationOwnershipError`) before it writes anything.
 *  2. **Idempotent on `clientId`.** The extension retries pushes freely; a retry must update, never
 *     duplicate (SEC 7.4).
 */

/** Thrown when a `clientId` in the payload already belongs to a different account. */
export class JobApplicationOwnershipError extends Error {
    readonly code = "CLIENT_ID_TAKEN" as const
    readonly clientId: string

    constructor(clientId: string) {
        super(`clientId '${clientId}' is already registered to another account`)
        this.name = "JobApplicationOwnershipError"
        this.clientId = clientId
    }
}

/** A tracker row as the API returns it - every date already an ISO string. */
export interface JobApplicationRecord {
    id: string
    clientId: string
    company: string
    role: string
    url: string | null
    ats: string | null
    status: jobAppStatusSchemaType
    appliedAt: string | null
    notes: string | null
    fillStats: { filled: number; total: number } | null
    history: { at: number; to: jobAppStatusSchemaType }[] | null
    updatedAt: string
}

export interface JobApplicationListOptions {
    /** Row id to resume after. `null`/absent starts at the first page. */
    cursor?: string | null
    /** Page size, clamped to [1, 200]. */
    limit?: number
    /** Optional status filter, matching the `@@index([userId, status, appliedAt])`. */
    status?: jobAppStatusSchemaType | null
}

export interface JobApplicationPage {
    items: JobApplicationRecord[]
    /** Feed straight back as `?cursor=` to fetch the next page. `null` when the list is exhausted. */
    nextCursor: string | null
    hasMore: boolean
}

export interface JobApplicationUpsertResult {
    record: JobApplicationRecord
    /** `true` when this call inserted the row, `false` when it was an idempotent overwrite. */
    created: boolean
}

/** Page size used when the caller does not ask for one. Shared with the controller. */
export const DEFAULT_PAGE_SIZE = 50
/** Hard ceiling on page size - a client cannot ask the database for the whole table. */
export const MAX_PAGE_SIZE = 200

/** Columns the API returns. An explicit `select`, so a future column cannot silently join the wire. */
const JOB_APPLICATION_SELECT = {
    id: true,
    clientId: true,
    company: true,
    role: true,
    url: true,
    ats: true,
    status: true,
    appliedAt: true,
    notes: true,
    fillStats: true,
    history: true,
    updatedAt: true
} as const

/** Shape of a selected Prisma row. `Json` columns arrive as `unknown` and are validated below. */
interface JobApplicationDbRow {
    id: string
    clientId: string
    company: string
    role: string
    url: string | null
    ats: string | null
    status: jobAppStatusSchemaType
    appliedAt: Date | null
    notes: string | null
    fillStats: unknown
    history: unknown
    updatedAt: Date
}

/**
 * The `Json` columns are re-validated with the *same* shared schema that guarded them on the way in
 * (`@repo/types/ExtensionTypes`) rather than a locally invented shape - a row written by an older
 * client version therefore degrades to `null` instead of poisoning the response body.
 */
const fillStatsSchema = jobApplicationRowSchema.shape.fillStats
const historySchema = jobApplicationRowSchema.shape.history

const parseFillStats = (value: unknown): { filled: number; total: number } | null => {
    const parsed = fillStatsSchema.safeParse(value)
    return parsed.success ? parsed.data ?? null : null
}

const parseHistory = (value: unknown): { at: number; to: jobAppStatusSchemaType }[] | null => {
    const parsed = historySchema.safeParse(value)
    return parsed.success ? parsed.data ?? null : null
}

/** True when a string is something `new Date()` can actually turn into a real instant. */
export const isParseableDate = (value: string): boolean => !Number.isNaN(new Date(value).getTime())

const toDate = (value: string | null | undefined): Date | null => {
    if (typeof value !== "string" || value.length === 0) return null
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

const toRecord = (row: JobApplicationDbRow): JobApplicationRecord => ({
    id: row.id,
    clientId: row.clientId,
    company: row.company,
    role: row.role,
    url: row.url,
    ats: row.ats,
    status: row.status,
    appliedAt: row.appliedAt ? row.appliedAt.toISOString() : null,
    notes: row.notes,
    fillStats: parseFillStats(row.fillStats),
    history: parseHistory(row.history),
    updatedAt: row.updatedAt.toISOString()
})

/**
 * Full-row write payload for POST (create-or-replace semantics).
 *
 * `Prisma.DbNull` rather than a bare `null`: on a nullable `Json` column, `null` is ambiguous
 * between "SQL NULL" and "the JSON literal null", so Prisma requires the sentinel.
 */
const toWriteData = (row: jobApplicationRowSchemaType) => ({
    company: row.company,
    role: row.role,
    url: row.url ?? null,
    ats: row.ats ?? null,
    status: row.status,
    appliedAt: toDate(row.appliedAt),
    notes: row.notes ?? null,
    fillStats: row.fillStats ?? Prisma.DbNull,
    history: row.history ?? Prisma.DbNull
})

/** Partial write payload for PATCH: only keys the caller actually sent are present. */
interface JobApplicationPatchData {
    company?: string
    role?: string
    url?: string | null
    ats?: string | null
    status?: jobAppStatusSchemaType
    appliedAt?: Date | null
    notes?: string | null
    fillStats?: { filled: number; total: number } | typeof Prisma.DbNull
    history?: { at: number; to: jobAppStatusSchemaType }[] | typeof Prisma.DbNull
}

const toPatchData = (patch: jobApplicationPatchSchemaType): JobApplicationPatchData => {
    const data: JobApplicationPatchData = {}
    if (patch.company !== undefined) data.company = patch.company
    if (patch.role !== undefined) data.role = patch.role
    if (patch.url !== undefined) data.url = patch.url
    if (patch.ats !== undefined) data.ats = patch.ats
    if (patch.status !== undefined) data.status = patch.status
    if (patch.appliedAt !== undefined) data.appliedAt = toDate(patch.appliedAt)
    if (patch.notes !== undefined) data.notes = patch.notes
    if (patch.fillStats !== undefined) data.fillStats = patch.fillStats ?? Prisma.DbNull
    if (patch.history !== undefined) data.history = patch.history ?? Prisma.DbNull
    return data
}

/** Number of keys a patch would actually write - lets the controller reject an empty body. */
export const countPatchFields = (patch: jobApplicationPatchSchemaType): number =>
    Object.keys(toPatchData(patch)).length

/**
 * Prisma's known-request errors carry a `code` (`P2002` = unique constraint violation). Read
 * structurally rather than via `instanceof Prisma.PrismaClientKnownRequestError` so this file needs
 * no Prisma type imports and keeps working across client versions.
 */
const prismaErrorCode = (error: unknown): string | null => {
    if (typeof error !== "object" || error === null) return null
    const code = (error as { code?: unknown }).code
    return typeof code === "string" ? code : null
}

/** One attempt at the read-then-write upsert. Extracted so the caller can retry it exactly once. */
const runUpsert = async (
    userId: string,
    row: jobApplicationRowSchemaType
): Promise<JobApplicationUpsertResult> =>
    prismaClient.$transaction(async (tx) => {
        const existing = await tx.jobApplication.findUnique({
            where: { clientId: row.clientId },
            select: { id: true, userId: true }
        })

        if (existing && existing.userId !== userId) {
            throw new JobApplicationOwnershipError(row.clientId)
        }

        if (existing) {
            const updated = await tx.jobApplication.update({
                where: { id: existing.id },
                data: toWriteData(row),
                select: JOB_APPLICATION_SELECT
            })
            return { record: toRecord(updated), created: false }
        }

        const created = await tx.jobApplication.create({
            data: {
                userId,
                clientId: row.clientId,
                ...toWriteData(row)
            },
            select: JOB_APPLICATION_SELECT
        })
        return { record: toRecord(created), created: true }
    })

class JobApplicationRepo {
    /**
     * One page of a user's applications.
     *
     * Cursor pagination on the row id with the classic `take` + `skip: 1` pattern: the cursor row
     * itself is skipped, and one extra row is fetched purely to answer "is there more?" without a
     * second count query. The sort is `appliedAt desc, id desc` - the `id` tiebreaker is what makes
     * the order total, and a total order is what makes a cursor stable across pages.
     */
    async listForUser(userId: string, options: JobApplicationListOptions = {}): Promise<JobApplicationPage> {
        const requested = options.limit ?? DEFAULT_PAGE_SIZE
        const take = Math.min(Math.max(Math.trunc(requested), 1), MAX_PAGE_SIZE)
        const cursor = options.cursor ?? null
        const status = options.status ?? null

        try {
            const rows = await prismaClient.jobApplication.findMany({
                where: {
                    userId,
                    ...(status ? { status } : {})
                },
                select: JOB_APPLICATION_SELECT,
                orderBy: [{ appliedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
                take: take + 1,
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
            })

            const hasMore = rows.length > take
            const page = hasMore ? rows.slice(0, take) : rows
            // noUncheckedIndexedAccess: the last element is `T | undefined` even when hasMore is true.
            const last = page[page.length - 1]

            return {
                items: page.map(toRecord),
                nextCursor: hasMore && last ? last.id : null,
                hasMore
            }
        } catch (error) {
            logger.error(`[REPO: listForUser] Error listing job applications for user: ${userId}`, error)
            throw error
        }
    }

    /** How many applications a user has, optionally narrowed to one status. */
    async countForUser(userId: string, status: jobAppStatusSchemaType | null = null): Promise<number> {
        try {
            return await prismaClient.jobApplication.count({
                where: {
                    userId,
                    ...(status ? { status } : {})
                }
            })
        } catch (error) {
            logger.error(`[REPO: countForUser] Error counting job applications for user: ${userId}`, error)
            throw error
        }
    }

    /**
     * Create-or-replace keyed on `clientId`, which is what makes the extension's retries safe.
     *
     * The lookup and the write share one interactive transaction so a concurrent push of the same
     * `clientId` cannot slip between them. The owner check runs before any write: `clientId` is
     * unique across the whole table, so without it a caller could overwrite another account's row
     * by guessing (or replaying) its id.
     */
    async upsertByClientId(
        userId: string,
        row: jobApplicationRowSchemaType
    ): Promise<JobApplicationUpsertResult> {
        try {
            return await runUpsert(userId, row)
        } catch (error) {
            // P2002 on `clientId`: two pushes of the same brand-new row raced and the other one
            // inserted between our lookup and our insert. Retried exactly once - the second attempt
            // finds the row, takes the update branch, and re-runs the ownership check. Retrying
            // once is enough because the row now exists and cannot go back to not existing.
            if (prismaErrorCode(error) === "P2002") {
                try {
                    return await runUpsert(userId, row)
                } catch (retryError) {
                    if (retryError instanceof JobApplicationOwnershipError) throw retryError
                    logger.error(
                        `[REPO: upsertByClientId] Retry failed for job application ${row.clientId}, user: ${userId}`,
                        retryError
                    )
                    throw retryError
                }
            }

            if (error instanceof JobApplicationOwnershipError) throw error
            logger.error(
                `[REPO: upsertByClientId] Error upserting job application ${row.clientId} for user: ${userId}`,
                error
            )
            throw error
        }
    }

    /**
     * Partial update. Returns `null` when the row does not exist *or* belongs to someone else -
     * the two are deliberately indistinguishable to the caller, so a probe learns nothing.
     */
    async patchByClientId(
        userId: string,
        clientId: string,
        patch: jobApplicationPatchSchemaType
    ): Promise<JobApplicationRecord | null> {
        const data = toPatchData(patch)

        try {
            return await prismaClient.$transaction(async (tx) => {
                const existing = await tx.jobApplication.findFirst({
                    where: { userId, clientId },
                    select: { id: true }
                })
                if (!existing) return null

                if (Object.keys(data).length === 0) {
                    const unchanged = await tx.jobApplication.findUnique({
                        where: { id: existing.id },
                        select: JOB_APPLICATION_SELECT
                    })
                    return unchanged ? toRecord(unchanged) : null
                }

                const updated = await tx.jobApplication.update({
                    where: { id: existing.id },
                    data,
                    select: JOB_APPLICATION_SELECT
                })
                return toRecord(updated)
            })
        } catch (error) {
            logger.error(
                `[REPO: patchByClientId] Error patching job application ${clientId} for user: ${userId}`,
                error
            )
            throw error
        }
    }

    /** Delete one row. `deleteMany` so another tenant's `clientId` is a silent no-op, not a P2025. */
    async deleteByClientId(userId: string, clientId: string): Promise<boolean> {
        try {
            const result = await prismaClient.jobApplication.deleteMany({
                where: { userId, clientId }
            })
            return result.count > 0
        } catch (error) {
            logger.error(
                `[REPO: deleteByClientId] Error deleting job application ${clientId} for user: ${userId}`,
                error
            )
            throw error
        }
    }
}

export default new JobApplicationRepo()
