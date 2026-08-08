"use client"

/**
 * JF-001 SEC 5.6 / 15.7 — the "all keys cooling" countdown toast.
 *
 * Copy pattern is fixed by the failure matrix: "All keys are rate-limited — ready again in 00:47."
 * with a live countdown and a retry button. A rate limit is temporary, so the user is told exactly
 * how temporary instead of being handed a generic failure.
 */

import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { Clock, RotateCw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatCountdown } from "@/hooks/useDevices"

const COOLDOWN_TOAST_ID = "jf-all-keys-cooling"
const QUOTA_TOAST_ID = "jf-daily-quota-exhausted"

function CooldownToastBody({
    toastId,
    retryAt,
    onRetry,
}: {
    toastId: string
    retryAt: number
    onRetry?: () => void
}) {
    const [remaining, setRemaining] = useState(() => Math.max(0, retryAt - Date.now()))

    useEffect(() => {
        // `retryAt` is Infinity when nothing in the pool will recover on its own — there is
        // nothing to count down to, so we skip the timer entirely and show the static copy.
        if (!Number.isFinite(retryAt)) return
        const tick = () => setRemaining(Math.max(0, retryAt - Date.now()))
        tick()
        const id = window.setInterval(tick, 1000)
        return () => window.clearInterval(id)
    }, [retryAt])

    const ready = Number.isFinite(retryAt) && remaining <= 0

    return (
        <div className="pointer-events-auto flex w-[22rem] max-w-[92vw] items-start gap-3 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg">
            <Clock className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="flex flex-1 flex-col gap-2">
                <p className="text-sm leading-relaxed">
                    {!Number.isFinite(retryAt) ? (
                        <>All of your keys are unavailable. Add another key to keep going.</>
                    ) : ready ? (
                        <>Your keys are ready again.</>
                    ) : (
                        <>
                            All keys are rate-limited — ready again in{" "}
                            <span className="font-mono font-semibold tabular-nums">
                                {formatCountdown(Math.ceil(remaining / 1000))}
                            </span>
                            .
                        </>
                    )}
                </p>
                {onRetry ? (
                    <div>
                        <Button
                            size="sm"
                            variant={ready ? "default" : "outline"}
                            onClick={() => {
                                toast.dismiss(toastId)
                                onRetry()
                            }}
                        >
                            <RotateCw className="size-3.5" />
                            Retry
                        </Button>
                    </div>
                ) : null}
            </div>
            <button
                type="button"
                aria-label="Dismiss"
                onClick={() => toast.dismiss(toastId)}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
                <X className="size-3.5" />
            </button>
        </div>
    )
}

/**
 * Shows (or replaces) the single cooling toast.
 * @param retryAt epoch ms the pool recovers — `Infinity` when nothing will recover on its own.
 */
export function showAllKeysCoolingToast(retryAt: number, onRetry?: () => void): string {
    return toast.custom(
        (t) => (
            <CooldownToastBody
                toastId={t.id}
                retryAt={retryAt}
                {...(onRetry ? { onRetry } : {})}
            />
        ),
        { id: COOLDOWN_TOAST_ID, duration: Infinity },
    )
}

/**
 * SEC 5.6 — the RPD variant. Daily quota is not a countdown the user should watch, so this one
 * states the reset and points at the actual remedy: another free key.
 */
export function showDailyQuotaExhaustedToast(keyCount: number): string {
    const keys = `${keyCount} key${keyCount === 1 ? "" : "s"}`
    return toast(
        `Free daily quota used across ${keys} — resets at midnight PT. Add another key to extend.`,
        { id: QUOTA_TOAST_ID, duration: 8000, icon: "🕛" },
    )
}

/** Clears both quota toasts — call after a successful generation. */
export function dismissQuotaToasts(): void {
    toast.dismiss(COOLDOWN_TOAST_ID)
    toast.dismiss(QUOTA_TOAST_ID)
}
