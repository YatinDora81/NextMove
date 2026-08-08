"use client"

/**
 * JF-001 SEC 7.2 — the onboarding wizard's progress rail.
 *
 * Two renderings of the same state rather than one that shrinks badly: a labelled segment rail on
 * anything wider than a phone, and a single "Step 3 of 5 · Experience" line plus a bar below that.
 * Labels matter here — a bare dot rail tells a user how much is left but not what is coming, and
 * "what is coming" is the whole reason someone keeps going.
 *
 * Completed steps are buttons; steps ahead of the furthest one reached are not, because jumping
 * forward would skip the vault write that happens on every transition.
 */

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
    /** The highest index the user has actually reached; anything beyond it is not navigable. */
    furthestIndex: number
    onSelect: (id: string) => void
    className?: string
}) {
    const total = steps.length
    const current = steps[currentIndex]
    const percent = total > 1 ? ((currentIndex + 1) / total) * 100 : 100

    return (
        <nav aria-label="Onboarding progress" className={cn("w-full", className)}>
            {/* Phone: one line of text and a bar. Nothing is truncated, nothing is guessed at. */}
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
