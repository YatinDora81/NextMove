"use client"

import { Fragment } from "react"
import { ApplicationStats } from "@/components/applications/stats"
import { cn } from "@/lib/utils"

type Count = {
    key: string
    value: string
    label: string
    title?: string
}

function plural(count: number, one: string, many: string): string {
    return count === 1 ? one : many
}

function buildCounts(stats: ApplicationStats): Count[] {
    const closed = stats.byStatus.REJECTED + stats.byStatus.GHOSTED
    const counts: Count[] = [
        { key: "total", value: String(stats.total), label: "total" },
        { key: "applied", value: String(stats.byStatus.APPLIED), label: "applied" },
        { key: "interviewing", value: String(stats.byStatus.INTERVIEW), label: "interviewing" },
        {
            key: "offers",
            value: String(stats.byStatus.OFFER),
            label: plural(stats.byStatus.OFFER, "offer", "offers"),
        },
        { key: "closed", value: String(closed), label: "closed" },
    ]

    if (stats.byStatus.DRAFT > 0) {
        counts.push({
            key: "drafts",
            value: String(stats.byStatus.DRAFT),
            label: plural(stats.byStatus.DRAFT, "draft", "drafts"),
        })
    }

    counts.push({
        key: "week",
        value: String(stats.appliedThisWeek),
        label: "this week",
        title: "Sent in the last 7 days",
    })

    if (stats.responseRatePct !== null) {
        counts.push({
            key: "response",
            value: `${stats.responseRatePct}%`,
            label: "reached interview",
            title: `Reached interview or offer, of ${stats.sentCount} sent`,
        })
    }

    if (stats.medianDaysToResponse !== null) {
        counts.push({
            key: "median",
            value: String(stats.medianDaysToResponse),
            label: plural(stats.medianDaysToResponse, "day to first reply", "days to first reply"),
            title: `Median across ${stats.respondedCount} replied application${stats.respondedCount === 1 ? "" : "s"}`,
        })
    }

    return counts
}

export function ApplicationsStats({ stats, className }: { stats: ApplicationStats; className?: string }) {
    const counts = buildCounts(stats)

    return (
        <p className={cn("tnum flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg2", className)}>
            {counts.map((count, index) => (
                <Fragment key={count.key}>
                    {index > 0 && (
                        <span className="text-fg3" aria-hidden="true">
                            ·
                        </span>
                    )}
                    <span title={count.title}>
                        <b className="font-semibold text-fg">{count.value}</b> {count.label}
                    </span>
                </Fragment>
            ))}
        </p>
    )
}

export default ApplicationsStats
