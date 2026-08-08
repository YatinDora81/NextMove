"use client"

/**
 * JF-001 SEC 5.6 / 15.7 — "Key revoked/invalid → badge + banner on next visit".
 *
 * The row badge alone is too quiet: a DEAD key silently shrinks the rotation pool, and the user
 * has no reason to open Settings to find out. So the banner is dismissible for the current
 * browsing session only (sessionStorage, not localStorage) — dismiss it now, see it again on the
 * next visit, exactly as the failure matrix specifies.
 */

import { useEffect, useState } from "react"
import { TriangleAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"
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

    // Read on mount only — sessionStorage is unavailable during SSR and in locked-down browsers.
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
            // Storage denied — the banner simply reappears on the next render path. Harmless.
        }
    }

    const names = deadKeys.map((k) => `${k.label} (${maskedKeyDisplay(k.last4)})`).join(", ")

    return (
        <div
            role="alert"
            className={cn(
                "flex flex-col gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-4 sm:flex-row sm:items-start",
                className,
            )}
        >
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
            <div className="flex flex-1 flex-col gap-2">
                <p className="text-sm font-medium text-red-900 dark:text-red-100">
                    {deadKeys.length === 1 ? "A key stopped working" : `${deadKeys.length} keys stopped working`}
                </p>
                <p className="text-sm leading-relaxed text-red-900/80 dark:text-red-100/80">
                    Google rejected {names}. That usually means the key was deleted, or it is missing the
                    “Gemini API only” restriction. Fix it in Google and press Test, or delete the key here —
                    until then it is skipped by rotation and your free quota is smaller.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                    <AuthKeyGuideDialog>
                        <Button size="sm" variant="outline" className="bg-background/60">
                            Fix key restrictions
                        </Button>
                    </AuthKeyGuideDialog>
                </div>
            </div>
            <button
                type="button"
                aria-label="Dismiss for this session"
                onClick={dismiss}
                className="self-start rounded-md p-1 text-red-900/60 transition-colors hover:bg-red-500/10 hover:text-red-900 dark:text-red-100/60 dark:hover:text-red-100"
            >
                <X className="size-4" />
            </button>
        </div>
    )
}
