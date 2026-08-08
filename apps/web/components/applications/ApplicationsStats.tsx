"use client"

/**
 * JF-001 SEC 6.7 stats strip, ported to the web: applied this week · total ·
 * active interviews · response rate · median days-to-response.
 */

import { CalendarClock, CheckCircle2, Send, Timer, TrendingUp } from "lucide-react"
import { ApplicationStats } from "@/components/applications/stats"
import { cn } from "@/lib/utils"

type Tile = {
    label: string
    value: string
    hint: string
    icon: typeof Send
}

function buildTiles(stats: ApplicationStats): Tile[] {
    return [
        {
            label: "Applied this week",
            value: String(stats.appliedThisWeek),
            hint: "Sent in the last 7 days",
            icon: Send,
        },
        {
            label: "Total tracked",
            value: String(stats.total),
            hint: stats.total === stats.sentCount ? "All sent" : `${stats.sentCount} sent, rest drafts`,
            icon: CheckCircle2,
        },
        {
            label: "Active interviews",
            value: String(stats.activeInterviews),
            hint: "Sitting in the interview lane",
            icon: CalendarClock,
        },
        {
            label: "Response rate",
            value: stats.responseRatePct === null ? "—" : `${stats.responseRatePct}%`,
            hint:
                stats.sentCount === 0
                    ? "No applications sent yet"
                    : `Reached interview or offer, of ${stats.sentCount} sent`,
            icon: TrendingUp,
        },
        {
            label: "Median days to reply",
            value: stats.medianDaysToResponse === null ? "—" : String(stats.medianDaysToResponse),
            hint:
                stats.respondedCount === 0
                    ? "No replies recorded yet"
                    : `Across ${stats.respondedCount} replied application${stats.respondedCount === 1 ? "" : "s"}`,
            icon: Timer,
        },
    ]
}

export function ApplicationsStats({ stats, className }: { stats: ApplicationStats; className?: string }) {
    const tiles = buildTiles(stats)

    return (
        <div className={cn("grid w-full grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5", className)}>
            {tiles.map((tile) => (
                <div
                    key={tile.label}
                    className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/60"
                >
                    <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        <tile.icon className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{tile.label}</span>
                    </div>
                    <div className="text-2xl font-semibold tabular-nums">{tile.value}</div>
                    <div className="text-[11px] leading-tight text-zinc-500 dark:text-zinc-500">{tile.hint}</div>
                </div>
            ))}
        </div>
    )
}

export default ApplicationsStats
