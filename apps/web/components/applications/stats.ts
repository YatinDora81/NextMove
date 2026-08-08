

import {
    JOB_APP_STATUSES,
    JobAppStatus,
    JobApplication,
    appliedAtMs,
    reachedInterview,
    respondedAtMs,
} from "@/components/applications/types"

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

export type ApplicationStats = {

    appliedThisWeek: number

    total: number

    activeInterviews: number

    responseRatePct: number | null

    medianDaysToResponse: number | null

    respondedCount: number

    sentCount: number

    byStatus: Record<JobAppStatus, number>
}

function emptyByStatus(): Record<JobAppStatus, number> {
    return JOB_APP_STATUSES.reduce(
        (acc, status) => {
            acc[status] = 0
            return acc
        },
        {} as Record<JobAppStatus, number>,
    )
}

export const EMPTY_APPLICATION_STATS: ApplicationStats = {
    appliedThisWeek: 0,
    total: 0,
    activeInterviews: 0,
    responseRatePct: null,
    medianDaysToResponse: null,
    respondedCount: 0,
    sentCount: 0,
    byStatus: emptyByStatus(),
}

function median(values: readonly number[]): number | null {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    if (sorted.length % 2 === 1) {

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
    if (rows.length === 0) return { ...EMPTY_APPLICATION_STATS, byStatus: emptyByStatus() }

    const byStatus = emptyByStatus()
    let appliedThisWeek = 0
    let activeInterviews = 0
    let sentCount = 0
    let interviewedCount = 0
    const responseDays: number[] = []

    for (const row of rows) {
        byStatus[row.status] += 1
        if (row.status === "INTERVIEW") activeInterviews += 1

        const sentAt = appliedAtMs(row)

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
        byStatus,
    }
}
