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
    const total = steps.length
    const current = steps[currentIndex]
    const percent = total > 1 ? ((currentIndex + 1) / total) * 100 : 100

    return (
        <nav aria-label="Onboarding progress" className={cn("w-full", className)}>
            <div className="flex flex-col gap-2 sm:hidden">
                <p className="font-mono text-xs text-muted-foreground">
                    Step {currentIndex + 1} of {total}
                    <span className="text-foreground"> · {current?.label ?? ""}</span>
                </p>
                <div className="h-1 w-full overflow-hidden rounded-full bg-border">
                    <div
                        className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
                        style={{ width: `${percent}%` }}
                    />
                </div>
            </div>

            <ol className="hidden gap-2 sm:grid" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
                {steps.map((step, index) => {
                    const done = index < currentIndex
                    const active = index === currentIndex
                    const reachable = index <= furthestIndex && !active

                    return (
                        <li key={step.id} className="flex min-w-0 flex-col gap-2">
                            <span
                                aria-hidden
                                className={cn(
                                    "h-1 w-full rounded-full transition-colors duration-300 motion-reduce:transition-none",
                                    done && "bg-primary/60",
                                    active && "bg-primary",
                                    !done && !active && "bg-border",
                                )}
                            />
                            <button
                                type="button"
                                disabled={!reachable}
                                aria-current={active ? "step" : undefined}
                                onClick={() => onSelect(step.id)}
                                className={cn(
                                    "flex min-w-0 items-center gap-1.5 rounded-md text-left font-mono text-xs transition-colors",
                                    "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                                    active && "text-foreground",
                                    done && "text-muted-foreground hover:text-foreground",
                                    !done && !active && "text-muted-foreground/60",
                                    !reachable && "cursor-default",
                                )}
                            >
                                {done ? (
                                    <Check className="size-3 shrink-0" />
                                ) : (
                                    <span className="shrink-0 tabular-nums">{index + 1}.</span>
                                )}
                                <span className="truncate">{step.label}</span>
                            </button>
                        </li>
                    )
                })}
            </ol>
        </nav>
    )
}
