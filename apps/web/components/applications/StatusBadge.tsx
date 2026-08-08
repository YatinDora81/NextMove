"use client"

import { Chip } from "@/components/quiet/Chip"
import { JobAppStatus, STATUS_LABEL, STATUS_TONE } from "@/components/applications/types"

export function StatusBadge({ status, className }: { status: JobAppStatus; className?: string }) {
    return (
        <Chip tone={STATUS_TONE[status]} className={className}>
            {STATUS_LABEL[status]}
        </Chip>
    )
}

export default StatusBadge
