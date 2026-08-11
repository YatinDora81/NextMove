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
 * Three rules run through every method:
 *
 *  1. **Tenant scoping is not optional.** `userId` appears in the `where` clause of every read,
 *     update and delete. `clientId` is globally unique in the schema, which makes it a perfectly
 *     good idempotency key *and* a perfectly good way to write over a stranger's row if it were
 *     used naked - so the upsert resolves the row by `clientId`, checks the owner, and refuses
 *     (`JobApplicationOwnershipError`) before it writes anything.
 *  2. **Idempotent on `clientId`.** The extension retries pushes freely; a retry must update, never
 *     duplicate (SEC 7.4).
 *  3. **One row per posting per user.** `clientId` only survives as long as the extension's local
 *     database does, so rule 2 alone lets a reinstall, a cleared local database or a second local
 *     profile push the same application again under a fresh id - and the Applied page grows a
 *     second card. `urlKey` is the server's own identity for "same posting, same user", and the
 *     upsert falls back to it whenever the `clientId` lookup misses.
 *  4. **The url fallback merges, it never replaces.** A row reached by `clientId` is the pushing
 *     client's own, so a push replaces it wholesale - that is how a correction made in the
 *     extension travels. A row reached by `urlKey` is a row that client has *never seen*: the
 *     status, the notes and the history on it may have been set on the web. See
 *     `mergeUrlMatchedWrite`.
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

/**
 * Thrown when a write would leave one user with two rows on the same posting - the exact state the
 * `@@unique([userId, urlKey])` index exists to prevent. Distinct from the ownership error: nothing
 * here crosses an account boundary, the caller is simply asking for a duplicate.
 */
export class JobApplicationDuplicateUrlError extends Error {
    readonly code = "DUPLICATE_URL" as const
    readonly clientId: string

    constructor(clientId: string) {
        super(`another application already tracks the url pushed with clientId '${clientId}'`)
        this.name = "JobApplicationDuplicateUrlError"
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

/**
 * Query parameters that vary between two visits to the *same* posting - campaign and referral
 * tags, never a job id.
 *
 * Copied verbatim from `TRACKING_PARAM` in `apps/extension/src/tracker/service.ts`, which is the
 * client half of this identity, and mirrored again in the backfill of
 * `20260811000001_job_application_url_dedupe/migration.sql`. All three must change together: a
 * denylist that differs between them is a denylist that lets the server merge two postings the
 * extension keeps apart.
 */
const TRACKING_PARAM =
    /^(utm_|gh_|mc_|_ga$|ref$|source$|src$|fbclid$|gclid$|msclkid$|trk$|trackingId$|lever-source|iis$|iisn$)/i

/** A `key=value` segment's key - everything before the first `=`, or the whole segment if none. */
const paramName = (segment: string): string => {
    const equals = segment.indexOf("=")
    return equals === -1 ? segment : segment.slice(0, equals)
}

/**
 * The query string reduced to the parameters that identify the posting, in a fixed order.
 *
 * Raw `key=value` segments, not `URLSearchParams`: the segments are sorted by their exact bytes so
 * the SQL backfill can reproduce the ordering with `ORDER BY ... COLLATE "C"`, and nothing is
 * decoded and re-encoded, so a key is a pure substring of the url the tracker recorded.
 *
 * That is a knowing divergence from the extension, which *does* round-trip through
 * `URLSearchParams` in `normalizeApplicationUrl`: `?q=a%20b` and `?q=a+b` are one identity there
 * and two keys here, as are `?flag` and `?flag=`. Closing it would require percent-decoding in the
 * migration too, and the decoded form does not sort the way `COLLATE "C"` sorts - the ordering is
 * reproducible in SQL precisely because it compares raw bytes. The divergence also errs the safe
 * way: a *finer* server key costs the user a second Applied card they can see and merge, while a
 * coarser one would let a push overwrite a different posting's row. Half of the normalisation
 * would be worse than none, so this stays raw and documented.
 *
 * `sort()` compares whole `key=value` segments in code-unit order, which orders by key and then by
 * value because `=` (0x3D) sorts below every character a parameter name can continue with.
 */
const normalizeQuery = (rawQuery: string): string =>
    rawQuery
        .split("&")
        .filter((segment) => segment.length > 0 && !TRACKING_PARAM.test(paramName(segment)))
        .sort()
        .join("&")

/**
 * Reduces a posting url to the key stored in `JobApplication.urlKey` - the server's answer to "is
 * this the application the user already has?".
 *
 * Each reduction removes something that varies between two visits to *the same* posting rather than
 * between two postings: the fragment and the tracking parameters carry per-visit noise (`?gh_src=`,
 * `?utm_campaign=`, `#/apply`), the scheme and a leading `www.` vary with how the link was reached,
 * and a trailing slash is noise. Only the host is lowercased - hostnames are case insensitive, but
 * Greenhouse and Lever put case-sensitive job tokens in the path, so folding the whole url would
 * merge two genuinely different openings into one row.
 *
 * The rest of the query string *survives*, sorted. Indeed (`?jk=`), Taleo (`?job=`), SuccessFactors
 * (`?career_job_req_id=`) and LinkedIn (`?currentJobId=`) all put the job id there, so dropping the
 * query would make this key coarser than the identity the extension computes in
 * `normalizeApplicationUrl` - and a coarser server key does not merely under-deduplicate, it lets
 * the url fallback in `runUpsert` overwrite one application with another. Sorting is what stops the
 * same posting from splitting in two when a link arrives with its parameters in a different order.
 *
 * Deliberately string surgery rather than `new URL()`: the tracker records whatever the address bar
 * held, which is not always parseable, and a url this cannot make sense of must degrade to `null`
 * (no identity, no deduplication) instead of throwing on a sync push.
 *
 * The backfill in `20260811000001_job_application_url_dedupe/migration.sql` performs the same
 * reduction in SQL; the two must be changed together or old rows stop matching new pushes.
 */
export const normalizeUrlKey = (url: string | null | undefined): string | null => {
    if (typeof url !== "string") return null

    const trimmed = url.trim()
    if (trimmed.length === 0) return null

    // noUncheckedIndexedAccess: `split` always yields at least one element, but the type does not
    // say so, hence the `?? ""` on the head.
    const withoutFragment = trimmed.split("#")[0] ?? ""
    // Split on the *first* `?` only - a stray second one belongs to the query, not to a new one.
    const queryStart = withoutFragment.indexOf("?")
    const beforeQuery = queryStart === -1 ? withoutFragment : withoutFragment.slice(0, queryStart)
    const rawQuery = queryStart === -1 ? "" : withoutFragment.slice(queryStart + 1)

    const withoutScheme = beforeQuery.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    const withoutWww = withoutScheme.replace(/^www\./i, "")
    const trimmedPath = withoutWww.replace(/\/+$/, "")
    // "https://" and friends reduce to nothing, which is not an identity anything should match on.
    if (trimmedPath.length === 0) return null

    const pathStart = trimmedPath.indexOf("/")
    const base =
        pathStart === -1
            ? trimmedPath.toLowerCase()
            : `${trimmedPath.slice(0, pathStart).toLowerCase()}${trimmedPath.slice(pathStart)}`

    const query = normalizeQuery(rawQuery)
    return query.length === 0 ? base : `${base}?${query}`
}

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

/** Every column a POST writes. Shared by the create-or-replace path and the url-matched merge. */
interface JobApplicationWriteData {
    company: string
    role: string
    url: string | null
    urlKey: string | null
    ats: string | null
    status: jobAppStatusSchemaType
    appliedAt: Date | null
    notes: string | null
    fillStats: { filled: number; total: number } | typeof Prisma.DbNull
    history: { at: number; to: jobAppStatusSchemaType }[] | typeof Prisma.DbNull
}

/**
 * Full-row write payload for POST (create-or-replace semantics).
 *
 * `Prisma.DbNull` rather than a bare `null`: on a nullable `Json` column, `null` is ambiguous
 * between "SQL NULL" and "the JSON literal null", so Prisma requires the sentinel.
 */
const toWriteData = (row: jobApplicationRowSchemaType): JobApplicationWriteData => ({
    company: row.company,
    role: row.role,
    url: row.url ?? null,
    // Derived, never accepted from the client - a caller that could choose its own key could choose
    // one that collides with a row it is not allowed to see.
    urlKey: normalizeUrlKey(row.url),
    ats: row.ats ?? null,
    status: row.status,
    appliedAt: toDate(row.appliedAt),
    notes: row.notes ?? null,
    fillStats: row.fillStats ?? Prisma.DbNull,
    history: row.history ?? Prisma.DbNull
})

/** Columns the url-matched merge reads before it writes; `clientId` and `updatedAt` are not among them. */
const JOB_APPLICATION_MERGE_SELECT = {
    id: true,
    company: true,
    role: true,
    url: true,
    ats: true,
    status: true,
    appliedAt: true,
    notes: true,
    fillStats: true,
    history: true
} as const

/** The server's side of the merge - the row as `JOB_APPLICATION_MERGE_SELECT` returns it. */
interface JobApplicationMergeRow {
    id: string
    company: string
    role: string
    url: string | null
    ats: string | null
    status: jobAppStatusSchemaType
    appliedAt: Date | null
    notes: string | null
    fillStats: unknown
    history: unknown
}

/** `toAtsId` in the extension falls back to this when it could not identify the ATS - not a fact. */
const UNKNOWN_ATS = "generic"

/**
 * The placeholder the extension sends when a posting hides its title (`toWireRow` in
 * apps/extension/src/background/handlers/sync.ts). Treated the same way as `UNKNOWN_ATS`: it is not
 * a fact, so it must never win over a real title and must never become permanent — otherwise the
 * first push that could not read the title would fix "Unknown role" onto the row for good, and a
 * later push that DID scrape it could not correct it.
 */
const UNKNOWN_ROLE = "Unknown role"

const isKnownRole = (value: string | null | undefined): boolean =>
    isNonEmpty(value) && value !== UNKNOWN_ROLE


const isNonEmpty = (value: string | null | undefined): value is string =>
    typeof value === "string" && value.length > 0

type JobApplicationHistory = { at: number; to: jobAppStatusSchemaType }[]

/**
 * Both audit trails as one chronological list, deduplicated on `at` + `to`.
 *
 * Deduplication is what makes this write path idempotent: the extension re-pushes the same row on
 * every sync, so an append-only merge would grow the `history` column without bound.
 */
const mergeHistory = (
    existing: JobApplicationHistory | null,
    incoming: JobApplicationHistory | null
): JobApplicationHistory => {
    const merged: JobApplicationHistory = []
    const seen = new Set<string>()
    for (const entry of [...(existing ?? []), ...(incoming ?? [])]) {
        const key = `${entry.at}:${entry.to}`
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(entry)
    }
    return merged.sort((a, b) => a.at - b.at)
}

/** `betterStats` from the extension's tracker: more fields filled wins, then more fields seen. */
const betterFillStats = (
    existing: { filled: number; total: number } | null,
    incoming: { filled: number; total: number } | null
): { filled: number; total: number } | null => {
    if (incoming === null) return existing
    if (existing === null) return incoming
    if (incoming.filled > existing.filled) return incoming
    if (incoming.filled === existing.filled && incoming.total > existing.total) return incoming
    return existing
}

/**
 * The write payload for a row matched by `urlKey`: the server's copy updated by the push rather
 * than overwritten by it.
 *
 * A `clientId` match means "this install's own row", and a push replaces it - that is the path a
 * correction made in the extension travels. A `urlKey` match means the opposite: the pushing
 * install has thrown its `clientId` away (a reinstall, a cleared local database, a second local
 * profile) and has therefore never seen a single edit made to this application on the web. It
 * cannot be treated as the authority on a status the user set there, on notes it does not hold, or
 * on a history it never recorded - replacing the row loses all three, permanently.
 *
 * The merge rules are `logApplication`'s (apps/extension/src/tracker/service.ts), which solves the
 * same problem locally when a second fill lands on a posting that is already tracked - reused
 * rather than reinvented, so client and server agree on what a re-encounter means:
 *
 *  - **status never walks backwards.** `DRAFT` is the only status a row moves *out* of, exactly as
 *    in `markApplied()`; anything the user or the employer already advanced stays put. So an
 *    INTERVIEW row survives a reinstall pushing `DRAFT`, and a `DRAFT` row is still promoted the
 *    moment a client reports a real application.
 *  - **`appliedAt` is stamped once** - the first time the row leaves `DRAFT`, never re-stamped;
 *    days-to-response is measured from it.
 *  - **an empty incoming value never blanks a stored one** (`notes`, `company`, `role`). A client
 *    that *does* carry notes still wins, because that is a value its user typed.
 *  - **`fillStats` keeps the best run**, not the most recent one.
 *
 * `urlKey` cannot move here: it is what matched this row, and re-deriving it from the incoming url
 * yields the same key by construction (tracking parameters and fragments reduce away).
 */
export const mergeUrlMatchedWrite = (
    existing: JobApplicationMergeRow,
    incoming: jobApplicationRowSchemaType,
    at: Date
): JobApplicationWriteData => {
    const promoted = existing.status === "DRAFT" && incoming.status !== "DRAFT"
    const status = promoted ? incoming.status : existing.status
    const url = isNonEmpty(incoming.url) ? incoming.url : existing.url

    const history = mergeHistory(
        parseHistory(existing.history),
        promoted
            ? [...(incoming.history ?? []), { at: at.getTime(), to: status }]
            : incoming.history ?? null
    )
    const fillStats = betterFillStats(parseFillStats(existing.fillStats), incoming.fillStats ?? null)

    return {
        company: isNonEmpty(existing.company) ? existing.company : incoming.company,
        role: isKnownRole(existing.role) || !isNonEmpty(incoming.role) ? existing.role : incoming.role,

        url,
        urlKey: normalizeUrlKey(url),
        ats: isNonEmpty(incoming.ats) && incoming.ats !== UNKNOWN_ATS ? incoming.ats : existing.ats,
        status,
        appliedAt: existing.appliedAt ?? toDate(incoming.appliedAt) ?? (promoted ? at : null),
        notes: isNonEmpty(incoming.notes) ? incoming.notes : existing.notes,
        fillStats: fillStats ?? Prisma.DbNull,
        history: history.length > 0 ? history : Prisma.DbNull
    }
}

/** Partial write payload for PATCH: only keys the caller actually sent are present. */
interface JobApplicationPatchData {
    company?: string
    role?: string
    url?: string | null
    urlKey?: string | null
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
    // `urlKey` moves with `url` and only with `url`: a patch that leaves the url alone must not
    // recompute the key, and a patch that changes it must not leave the old key behind pointing the
    // deduplication at a posting this row no longer tracks.
    if (patch.url !== undefined) {
        data.url = patch.url
        data.urlKey = normalizeUrlKey(patch.url)
    }
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

const mentionsUrlKey = (value: unknown): boolean => typeof value === "string" && value.includes("urlKey")

/**
 * True when a P2002 came from the `[userId, urlKey]` index rather than the `clientId` one - the two
 * call for opposite responses, so guessing is not an option.
 *
 * `meta.target` identifies the offending constraint, but *how* has moved between Prisma versions:
 * a list of field names, a list holding the index name, or that name as a bare string. Substring
 * matching covers all three, and is unambiguous here because `urlKey` appears in exactly one index.
 */
const isUrlKeyConflict = (error: unknown): boolean => {
    if (prismaErrorCode(error) !== "P2002") return false
    if (typeof error !== "object" || error === null) return false
    const target = (error as { meta?: { target?: unknown } }).meta?.target
    return Array.isArray(target) ? target.some(mentionsUrlKey) : mentionsUrlKey(target)
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

        // The `clientId` misses, but that only means *this install* has never synced this row - the
        // posting itself may well already be on the Applied page under a `clientId` a reinstall,
        // a cleared local database or another local profile has since thrown away. Fall back to the
        // url identity, scoped to this user (the index is unique per user, so at most one matches).
        //
        // The matched row keeps its original `clientId`: it is the id every *other* installation
        // still addresses this application by, and rewriting it here would strand those PATCHes and
        // DELETEs on an id the server no longer knows.
        //
        // It also keeps everything the pushing client cannot know about - see mergeUrlMatchedWrite.
        const urlKey = normalizeUrlKey(row.url)
        if (urlKey !== null) {
            const samePosting = await tx.jobApplication.findFirst({
                where: { userId, urlKey },
                select: JOB_APPLICATION_MERGE_SELECT
            })

            if (samePosting) {
                const updated = await tx.jobApplication.update({
                    where: { id: samePosting.id },
                    data: mergeUrlMatchedWrite(samePosting, row, new Date()),
                    select: JOB_APPLICATION_SELECT
                })
                return { record: toRecord(updated), created: false }
            }
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
     * Create-or-replace keyed on `clientId` first, then a *merge* onto the row that already tracks
     * the posting url - which is what makes the extension's retries safe *and* keeps a reinstall
     * from doubling the Applied page without letting it flatten what the web app knows.
     *
     * Both lookups and the write share one interactive transaction so a concurrent push of the same
     * `clientId` - or of the same posting under a different one - cannot slip between them. The
     * owner check runs before any write: `clientId` is unique across the whole table, so without it
     * a caller could overwrite another account's row by guessing (or replaying) its id. The url
     * fallback needs no equivalent check because it is scoped to `userId` in the query itself.
     */
    async upsertByClientId(
        userId: string,
        row: jobApplicationRowSchemaType
    ): Promise<JobApplicationUpsertResult> {
        try {
            return await runUpsert(userId, row)
        } catch (error) {
            // P2002: two pushes of the same brand-new row raced and the other one inserted between
            // our lookups and our insert - on `clientId` if it was the same row twice, on
            // `[userId, urlKey]` if two clientIds carried one posting. Retried exactly once; the
            // second attempt finds the row, takes an update branch, and re-runs the ownership
            // check. Once is enough because the row now exists and cannot go back to not existing.
            if (prismaErrorCode(error) === "P2002") {
                try {
                    return await runUpsert(userId, row)
                } catch (retryError) {
                    if (retryError instanceof JobApplicationOwnershipError) throw retryError
                    // Still colliding on the url after a retry, so this was never a race: the
                    // caller is moving one of its own rows onto a posting another of its rows
                    // already holds. Refuse rather than silently pick a winner and lose a row.
                    if (isUrlKeyConflict(retryError)) throw new JobApplicationDuplicateUrlError(row.clientId)
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
            // Editing a row's url onto a posting the user already tracks is a duplicate request,
            // not a server fault - the kanban gets a 409 it can explain instead of a 500.
            if (isUrlKeyConflict(error)) throw new JobApplicationDuplicateUrlError(clientId)
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
