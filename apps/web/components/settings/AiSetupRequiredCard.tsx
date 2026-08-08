"use client"

/**
 * JF-001 SEC 15.7 (error surfaces) — the inline card a feature renders when the API answers
 * `402 { data: { code: 'AI_SETUP_REQUIRED' } }`.
 *
 * This is the free-tier BYOK gate: the user has no key in the vault, so the feature cannot run.
 * It is deliberately an inline card and not a toast — a toast disappears and leaves the user
 * staring at a dead button, whereas this explains the state and deep-links to the fix.
 */

import Link from "next/link"
import { KeyRound, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** Deep link used everywhere the 402 surfaces. */
export const AI_KEYS_SETTINGS_PATH = "/settings/ai-keys"

/** The server's discriminator for the free-tier "bring your own key" gate (SEC 15.5). */
export const AI_SETUP_REQUIRED = "AI_SETUP_REQUIRED"

/**
 * True when an API envelope is the 402 BYOK gate. Accepts the raw parsed body so callers can
 * branch before they have decided whether the response was a success at all.
 */
export function isAiSetupRequired(body: unknown): boolean {
    if (typeof body !== "object" || body === null) return false
    const envelope = body as Record<string, unknown>
    const data = envelope.data
    if (typeof data !== "object" || data === null) return false
    return (data as Record<string, unknown>).code === AI_SETUP_REQUIRED
}

export function AiSetupRequiredCard({
    message,
    className,
    compact = false,
}: {
    /** The server's own wording, when it sent any. */
    message?: string
    className?: string
    compact?: boolean
}) {
    return (
        <div
            role="status"
            className={cn(
                "flex flex-col gap-4 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm",
                compact && "p-4",
                className,
            )}
        >
            <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
                    <Sparkles className="size-4 text-muted-foreground" />
                </span>
                <div className="flex flex-col gap-1">
                    <p className="font-mono text-sm font-semibold">AI needs a free Google key</p>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                        {message ??
                            "NextMove's AI features run on your own free Gemini key. Adding one takes about two minutes and costs nothing — more keys simply means more free quota."}
                    </p>
                </div>
            </div>
            <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                    <Link href={AI_KEYS_SETTINGS_PATH}>
                        <KeyRound className="size-4" />
                        Set up AI keys
                    </Link>
                </Button>
                <Button asChild size="sm" variant="ghost">
                    <Link href="/on-boarding?step=ai">Walk me through it</Link>
                </Button>
            </div>
        </div>
    )
}
