"use client"

import { cn } from "@/lib/utils"
import { JobAppStatus, STATUS_CLASS, STATUS_LABEL } from "@/components/applications/types"

/** Small pill for a `JobAppStatus`. Colours carry an explicit dark-mode pair. */
export function StatusBadge({ status, className }: { status: JobAppStatus; className?: string }) {
    return (
        <span
            className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                STATUS_CLASS[status],
                className,
            )}
        >
            {STATUS_LABEL[status]}
        </span>
    )
}

export default StatusBadge
