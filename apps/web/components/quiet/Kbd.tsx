import type { ReactNode } from "react"
import { cx } from "./cx"

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
    return <kbd className={cx("qp-kbd", className)}>{children}</kbd>
}
