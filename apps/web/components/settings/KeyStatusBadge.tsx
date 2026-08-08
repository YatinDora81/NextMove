"use client"

import { Chip } from "@/components/quiet/Chip"
import type { ChipTone } from "@/components/quiet/Chip"
import { cn } from "@/lib/utils"
import type { AiKeyStatus } from "@/hooks/useAiKeys"

const BADGE_TONES: Record<AiKeyStatus, ChipTone> = {
    ACTIVE: "ok",
    COOLDOWN: "warn",
    EXHAUSTED: "mut",
    DEAD: "dan",
}

const BADGE_LABELS: Record<AiKeyStatus, string> = {
    ACTIVE: "Active",
    COOLDOWN: "Cooldown",
    EXHAUSTED: "Exhausted",
    DEAD: "Dead",
}

export const STATUS_HELP: Record<AiKeyStatus, string> = {
    ACTIVE: "Ready to serve requests.",
    COOLDOWN: "Hit a rate limit — backing off, then it returns on its own.",
    EXHAUSTED: "Daily free quota spent. Resets at midnight Pacific.",
    DEAD: "Google rejected this key. Fix the key or delete it.",
}

export function KeyStatusBadge({ status, className }: { status: AiKeyStatus; className?: string }) {
    return (
        <span title={STATUS_HELP[status]} className={cn("inline-flex shrink-0", className)}>
            <Chip tone={BADGE_TONES[status]}>{BADGE_LABELS[status]}</Chip>
        </span>
    )
}
