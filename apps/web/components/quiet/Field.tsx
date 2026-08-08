import type { ComponentProps, ReactNode } from "react"
import { cx } from "./cx"

export function Field({
    label,
    hint,
    children,
    className,
}: {
    label: ReactNode
    hint?: ReactNode
    children: ReactNode
    className?: string
}) {
    return (
        <label className={cx("mt-3.5 block", className)}>
            <span className="mb-1.5 flex justify-between text-[13px] font-medium text-fg">
                <span>{label}</span>
                {hint && <span className="font-normal text-fg3">{hint}</span>}
            </span>
            {children}
        </label>
    )
}

export function Input({ className, ...props }: ComponentProps<"input">) {
    return (
        <input
            className={cx(
                "h-[38px] w-full rounded-lg border border-hair2 bg-surface px-3 text-[13.5px] text-fg placeholder:text-fg3",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acc",
                "disabled:cursor-not-allowed disabled:opacity-60",
                className
            )}
            {...props}
        />
    )
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
    return (
        <textarea
            className={cx(
                "w-full rounded-lg border border-hair2 bg-surface px-3 py-2 text-[13.5px] text-fg placeholder:text-fg3",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acc",
                "disabled:cursor-not-allowed disabled:opacity-60",
                className
            )}
            {...props}
        />
    )
}
