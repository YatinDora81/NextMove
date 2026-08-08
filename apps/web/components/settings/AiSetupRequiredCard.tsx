"use client"

import Link from "next/link"
import { KeyRound, Sparkles } from "lucide-react"
import { Card } from "@/components/quiet/Card"
import { cn } from "@/lib/utils"

export const AI_KEYS_SETTINGS_PATH = "/settings/ai-keys"

export const AI_SETUP_REQUIRED = "AI_SETUP_REQUIRED"

export function isAiSetupRequired(body: unknown): boolean {
    if (typeof body !== "object" || body === null) return false
    const envelope = body as Record<string, unknown>
    const data = envelope.data
    if (typeof data !== "object" || data === null) return false
    return (data as Record<string, unknown>).code === AI_SETUP_REQUIRED
}

const LINK_BASE =
    "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"

export function AiSetupRequiredCard({
    message,
    className,
    compact = false,
}: {
    message?: string
    className?: string
    compact?: boolean
}) {
    return (
        <Card
            role="status"
            className={cn("p-5", compact && "p-4", className)}
        >
            <div className="flex items-start gap-3">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-fg2" strokeWidth={1.5} />
                <div className="flex flex-col gap-1">
                    <p className="text-[13.5px] font-semibold text-fg">AI needs a free Google key</p>
                    <p className="text-[13px] leading-relaxed text-fg2">
                        {message ??
                            "NextMove's AI features run on your own free Gemini key. Adding one takes about two minutes and costs nothing — more keys simply means more free quota."}
                    </p>
                </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
                <Link
                    href={AI_KEYS_SETTINGS_PATH}
                    className={cn(
                        LINK_BASE,
                        "bg-acc text-on-acc shadow-[inset_0_1px_0_rgba(255,255,255,.14),var(--qp-sh-sm)] hover:bg-acc-strong",
                    )}
                >
                    <KeyRound className="size-3.5" strokeWidth={1.5} />
                    Set up AI keys
                </Link>
                <Link
                    href="/on-boarding?step=ai"
                    className={cn(LINK_BASE, "text-fg2 hover:bg-well hover:text-fg")}
                >
                    Walk me through it
                </Link>
            </div>
        </Card>
    )
}
