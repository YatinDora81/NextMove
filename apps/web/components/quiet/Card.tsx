import type { ComponentProps } from "react"
import { cx } from "./cx"

export function Card({ className, ...props }: ComponentProps<"div">) {
    return (
        <div
            className={cx("rounded-xl border border-hair bg-surface shadow-qsm", className)}
            {...props}
        />
    )
}

export function Well({ className, ...props }: ComponentProps<"div">) {
    return <div className={cx("rounded-[10px] bg-well", className)} {...props} />
}
