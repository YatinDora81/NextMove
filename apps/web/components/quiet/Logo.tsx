import { cx } from "./cx"

export function Logo({ size = 26, className }: { size?: number; className?: string }) {
    return (
        <span
            aria-hidden
            className={cx("qp-logochip", className)}
            style={{ width: size, height: size }}
        />
    )
}
