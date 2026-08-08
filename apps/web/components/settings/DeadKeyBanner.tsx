"use client"

import { useEffect, useState } from "react"
import { TriangleAlert, X } from "lucide-react"
import { Button } from "@/components/quiet/Button"
import { AuthKeyGuideDialog } from "@/components/settings/AuthKeyNotice"
import { maskedKeyDisplay, type AiKeyPublic } from "@/hooks/useAiKeys"
import { cn } from "@/lib/utils"

const DISMISS_KEY = "jf.deadKeysDismissed"

function signatureOf(keys: readonly AiKeyPublic[]): string {
    return keys.map((k) => k.id).sort().join(",")
}

export function DeadKeyBanner({
    deadKeys,
    className,
}: {
    deadKeys: readonly AiKeyPublic[]
    className?: string
}) {
    const signature = signatureOf(deadKeys)
    const [dismissedSignature, setDismissedSignature] = useState<string | null>(null)

    useEffect(() => {
        try {
            setDismissedSignature(window.sessionStorage.getItem(DISMISS_KEY))
        } catch {
            setDismissedSignature(null)
        }
    }, [])

    if (deadKeys.length === 0) return null
    if (dismissedSignature === signature) return null

    const dismiss = () => {
        setDismissedSignature(signature)
        try {
            window.sessionStorage.setItem(DISMISS_KEY, signature)
        } catch {
            // storage denied
        }
    }

    const names = deadKeys.map((k) => `${k.label} (${maskedKeyDisplay(k.last4)})`).join(", ")

    return (
        <div
            role="alert"
            className={cn(
                "flex flex-col gap-3 rounded-xl border border-dan/40 bg-danbg px-4 py-3.5 sm:flex-row sm:items-start",
                className,
            )}
        >
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-dan" strokeWidth={1.5} />
            <div className="flex flex-1 flex-col gap-2">
                <p className="text-[13.5px] font-semibold text-fg">
                    {deadKeys.length === 1 ? "A key stopped working" : `${deadKeys.length} keys stopped working`}
                </p>
                <p className="text-[13px] leading-relaxed text-fg2">
                    Google rejected {names}. That usually means the key was deleted, or it is missing the
                    “Gemini API only” restriction. Fix it in Google and press Test, or delete the key here —
                    until then it is skipped by rotation and your free quota is smaller.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                    <AuthKeyGuideDialog>
                        <Button variant="sec" className="px-3 py-1.5 text-[12.5px]">
                            Fix key restrictions
                        </Button>
                    </AuthKeyGuideDialog>
                </div>
            </div>
            <button
                type="button"
                aria-label="Dismiss for this session"
                onClick={dismiss}
                className="self-start rounded-lg p-1 text-fg3 transition-colors hover:bg-well hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
            >
                <X className="size-4" strokeWidth={1.5} />
            </button>
        </div>
    )
}
