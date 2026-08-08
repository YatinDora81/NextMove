"use client"

/** JF-001 SEC 15.7 — status badges for vaulted keys: ACTIVE / COOLDOWN / EXHAUSTED / DEAD. */

import { cn } from "@/lib/utils"
import type { AiKeyStatus } from "@/hooks/useAiKeys"

const BADGE_STYLES: Record<AiKeyStatus, string> = {
    ACTIVE: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    COOLDOWN: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    EXHAUSTED: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    DEAD: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
}

/** One-line plain-English gloss for each status, used under the badge and in the legend. */
export const STATUS_HELP: Record<AiKeyStatus, string> = {
    ACTIVE: "Ready to serve requests.",
    COOLDOWN: "Hit a rate limit — backing off, then it returns on its own.",
    EXHAUSTED: "Daily free quota spent. Resets at midnight Pacific.",
    DEAD: "Google rejected this key. Fix the key or delete it.",
}

export function KeyStatusBadge({ status, className }: { status: AiKeyStatus; className?: string }) {
    return (
        <span
            title={STATUS_HELP[status]}
            className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-medium tracking-wide uppercase",
                BADGE_STYLES[status],
                className,
            )}
        >
            {status}
        </span>
    )
}
