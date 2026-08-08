"use client"

import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

export type StepIndicatorItem = {
    id: string
    label: string
}

export function StepIndicator({
    steps,
    currentIndex,
    furthestIndex,
    onSelect,
    className,
}: {
    steps: readonly StepIndicatorItem[]
    currentIndex: number
    furthestIndex: number
    onSelect: (id: string) => void
    className?: string
}) {
    return (
        <nav aria-label="Onboarding progress" className={cn("w-full", className)}>
            <ol className="flex flex-wrap items-center justify-center gap-2">
                {steps.map((step, index) => {
                    const done = index < currentIndex
                    const active = index === currentIndex
                    const reachable = index <= furthestIndex && !active

                    return (
                        <li key={step.id} className="flex items-center gap-2">
                            {index > 0 ? <span aria-hidden className="h-px w-5 bg-hair2" /> : null}
                            <button
                                type="button"
                                disabled={!reachable}
                                aria-current={active ? "step" : undefined}
                                onClick={() => onSelect(step.id)}
                                className={cn(
                                    "inline-flex items-center gap-1.5 rounded-md text-[12.5px] transition-colors",
                                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc",
                                    active && "font-semibold text-acc",
                                    done && "text-fg2 hover:text-fg",
                                    !done && !active && "text-fg3",
                                    !reachable && "cursor-default",
                                )}
                            >
                                <span className="truncate">{step.label}</span>
                                {done ? (
                                    <Check aria-hidden className="size-[13px] shrink-0 text-ok" />
                                ) : null}
                            </button>
                        </li>
                    )
                })}
            </ol>
        </nav>
    )
}
