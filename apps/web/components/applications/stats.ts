/**
 * JF-001 SEC 6.7 — the stats strip: applied this week · total · active interviews ·
 * response rate (% of applied that reached interview) · median days-to-response.
 *
 * Pure functions over the rows currently in view, so the strip always describes exactly
 * what the filters below it are showing.
 */

import {
    JobApplication,
    appliedAtMs,
    reachedInterview,
    respondedAtMs,
} from "@/components/applications/types"

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

export type ApplicationStats = {
    /** Rows actually sent in the last 7 days. */
    appliedThisWeek: number
    /** Every row in view, drafts included. */
    total: number
    /** Rows sitting in the INTERVIEW lane right now. */
    activeInterviews: number
    /** Share of sent applications that reached interview or offer. `null` when nothing was sent. */
    responseRatePct: number | null
    /** Median calendar days from "applied" to the first employer response. `null` when unknown. */
    medianDaysToResponse: number | null
    /** How many rows the median is computed from — shown so a 1-sample median reads honestly. */
    respondedCount: number
    /** Denominator behind `responseRatePct`. */
    sentCount: number
}

export const EMPTY_APPLICATION_STATS: ApplicationStats = {
    appliedThisWeek: 0,
    total: 0,
    activeInterviews: 0,
    responseRatePct: null,
    medianDaysToResponse: null,
    respondedCount: 0,
    sentCount: 0,
}

/** Median of a non-empty numeric list. Returns `null` for an empty one. */
function median(values: readonly number[]): number | null {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    if (sorted.length % 2 === 1) {
        // noUncheckedIndexedAccess: `mid` is in range because the list is non-empty.
        return sorted[mid] ?? null
    }
    const lower = sorted[mid - 1]
    const upper = sorted[mid]
    if (lower === undefined || upper === undefined) return null
    return (lower + upper) / 2
}

export function computeApplicationStats(
    rows: readonly JobApplication[],
    now: number = Date.now(),
): ApplicationStats {
    if (rows.length === 0) return EMPTY_APPLICATION_STATS

    let appliedThisWeek = 0
    let activeInterviews = 0
    let sentCount = 0
    let interviewedCount = 0
    const responseDays: number[] = []

    for (const row of rows) {
        if (row.status === "INTERVIEW") activeInterviews += 1

        const sentAt = appliedAtMs(row)
        // A row is only "sent" once it left DRAFT — a draft has no response to wait for.
        const isSent = row.status !== "DRAFT" && sentAt !== null
        if (!isSent || sentAt === null) continue

        sentCount += 1
        if (now - sentAt <= WEEK_MS) appliedThisWeek += 1
        if (reachedInterview(row)) interviewedCount += 1

        const respondedAt = respondedAtMs(row)
        if (respondedAt !== null && respondedAt >= sentAt) {
            responseDays.push((respondedAt - sentAt) / DAY_MS)
        }
    }

    const medianDays = median(responseDays)

    return {
        appliedThisWeek,
        total: rows.length,
        activeInterviews,
        responseRatePct: sentCount === 0 ? null : Math.round((interviewedCount / sentCount) * 100),
        medianDaysToResponse: medianDays === null ? null : Math.round(medianDays * 10) / 10,
        respondedCount: responseDays.length,
        sentCount,
    }
}
