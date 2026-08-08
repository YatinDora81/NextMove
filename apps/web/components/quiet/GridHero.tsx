import type { ReactNode } from "react"
import { cx } from "./cx"

export function GridHero({
    children,
    className,
    gridHeight = 700,
}: {
    children: ReactNode
    className?: string
    gridHeight?: number
}) {
    return (
        <div className={cx("relative", className)}>
            <div className="qp-gridbg" style={{ height: gridHeight }} />
            <div className="relative">{children}</div>
        </div>
    )
}
