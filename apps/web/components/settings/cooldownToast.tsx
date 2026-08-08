"use client"

import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { Clock, RotateCw, X } from "lucide-react"
import { Button } from "@/components/quiet/Button"
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
        if (!Number.isFinite(retryAt)) return
        const tick = () => setRemaining(Math.max(0, retryAt - Date.now()))
        tick()
        const id = window.setInterval(tick, 1000)
        return () => window.clearInterval(id)
    }, [retryAt])

    const ready = Number.isFinite(retryAt) && remaining <= 0

    return (
        <div className="pointer-events-auto flex w-[22rem] max-w-[92vw] items-start gap-3 rounded-[14px] border border-hair bg-surface p-4 shadow-qmd">
            <Clock className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={1.5} />
            <div className="flex flex-1 flex-col gap-2">
                <p className="text-[13px] leading-relaxed text-fg">
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
                            variant={ready ? "acc" : "sec"}
                            className="px-3 py-1.5 text-[12.5px]"
                            onClick={() => {
                                toast.dismiss(toastId)
                                onRetry()
                            }}
                        >
                            <RotateCw className="size-3.5" strokeWidth={1.5} />
                            Retry
                        </Button>
                    </div>
                ) : null}
            </div>
            <button
                type="button"
                aria-label="Dismiss"
                onClick={() => toast.dismiss(toastId)}
                className="rounded-lg p-1 text-fg3 transition-colors hover:bg-well hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
            >
                <X className="size-3.5" strokeWidth={1.5} />
            </button>
        </div>
    )
}

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

export function showDailyQuotaExhaustedToast(keyCount: number): string {
    const keys = `${keyCount} key${keyCount === 1 ? "" : "s"}`
    return toast(
        `Free daily quota used across ${keys} — resets at midnight PT. Add another key to extend.`,
        {
            id: QUOTA_TOAST_ID,
            duration: 8000,
            icon: <Clock className="size-4 shrink-0 text-warn" strokeWidth={1.5} />,
        },
    )
}

export function dismissQuotaToasts(): void {
    toast.dismiss(COOLDOWN_TOAST_ID)
    toast.dismiss(QUOTA_TOAST_ID)
}
