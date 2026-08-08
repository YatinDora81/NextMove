"use client"

import type { ComponentProps } from "react"
import { cx } from "./cx"

export type ButtonVariant = "acc" | "sec" | "ghost" | "danger"

const styles: Record<ButtonVariant, string> = {
    acc: "bg-acc text-on-acc shadow-[inset_0_1px_0_rgba(255,255,255,.14),var(--qp-sh-sm)] hover:bg-acc-strong",
    sec: "bg-surface border border-hair2 text-fg shadow-qsm hover:bg-well",
    ghost: "text-fg2 hover:bg-well hover:text-fg",
    danger: "text-dan hover:bg-danbg",
}

export type ButtonProps = ComponentProps<"button"> & { variant?: ButtonVariant }

export function Button({ variant = "sec", className, ...props }: ButtonProps) {
    return (
        <button
            className={cx(
                "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[13.5px] font-medium transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc",
                "disabled:pointer-events-none disabled:opacity-50",
                styles[variant],
                className
            )}
            {...props}
        />
    )
}
