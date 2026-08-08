import type { ReactNode } from "react"
import { cx } from "./cx"

export type ChipTone = "ok" | "warn" | "dan" | "acc" | "mut"

const tones: Record<ChipTone, { chip: string; dot: string }> = {
    ok: { chip: "bg-okbg text-ok", dot: "bg-ok" },
    warn: { chip: "bg-warnbg text-warn", dot: "bg-warn" },
    dan: { chip: "bg-danbg text-dan", dot: "bg-dan" },
    acc: { chip: "bg-acc-soft text-acc", dot: "bg-acc" },
    mut: { chip: "bg-well text-fg2", dot: "bg-fg3" },
}

export function Chip({
    tone = "mut",
    dot = true,
    children,
    className,
}: {
    tone?: ChipTone
    dot?: boolean
    children: ReactNode
    className?: string
}) {
    const t = tones[tone]
    return (
        <span
            className={cx(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-xs font-medium",
                t.chip,
                className
            )}
        >
            {dot && <span className={cx("size-1.5 rounded-full", t.dot)} />}
            {children}
        </span>
    )
}
