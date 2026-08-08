"use client"

import type { ReactNode } from "react"
import { useState } from "react"
import { ExternalLink, KeyRound, TriangleAlert } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/quiet/Button"
import { Well } from "@/components/quiet/Card"
import { cn } from "@/lib/utils"

export const AI_STUDIO_KEYS_URL = "https://aistudio.google.com/apikey"
export const GOOGLE_CREDENTIALS_URL = "https://console.cloud.google.com/apis/credentials"

const LINK_BASE =
    "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
const GHOST_LINK = cn(LINK_BASE, "text-fg2 hover:bg-well hover:text-fg")
const SEC_LINK = cn(LINK_BASE, "border border-hair2 bg-surface text-fg shadow-qsm hover:bg-well")
const ACC_LINK = cn(
    LINK_BASE,
    "bg-acc text-on-acc shadow-[inset_0_1px_0_rgba(255,255,255,.14),var(--qp-sh-sm)] hover:bg-acc-strong",
)

const RESTRICTION_STEPS: readonly string[] = [
    "Open Google Cloud console → APIs & Services → Credentials (the button below opens it).",
    "Pick the project your AI Studio key belongs to, then click the key's name.",
    "Under “API restrictions”, choose “Restrict key”.",
    "In the dropdown, tick “Generative Language API” — that is the Gemini API — and nothing else.",
    "Save. Restrictions take about a minute to propagate.",
    "Come back here and press “Test & Save” again.",
]

export function AuthKeyGuideDialog({ children }: { children: ReactNode }) {
    const [open, setOpen] = useState(false)

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="border-hair bg-surface sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-[16px] font-semibold tracking-[-0.01em] text-fg">
                        <KeyRound className="size-4 text-fg2" strokeWidth={1.5} />
                        Add the “Gemini API only” restriction
                    </DialogTitle>
                    <DialogDescription className="text-[13px] leading-relaxed text-fg2">
                        Google now issues restricted auth keys by default. A key without the Gemini API
                        restriction is refused, and so is any old unrestricted standard key.
                    </DialogDescription>
                </DialogHeader>

                <ol className="flex list-none flex-col gap-3">
                    {RESTRICTION_STEPS.map((step, index) => (
                        <li key={step} className="flex items-start gap-3">
                            <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-well font-mono text-[11px] text-fg2">
                                {index + 1}
                            </span>
                            <span className="text-[13px] leading-relaxed text-fg2">{step}</span>
                        </li>
                    ))}
                </ol>

                <Well className="px-4 py-3 text-xs leading-relaxed text-fg2">
                    Keys created in AI Studio after the auth-key change already carry the restriction —
                    if yours is new and still fails, it is usually the wrong Google project. Standard
                    keys stop working entirely in <span className="font-medium text-fg">September 2026</span>.
                </Well>

                <DialogFooter className="gap-2 sm:justify-between">
                    <a
                        href={AI_STUDIO_KEYS_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={SEC_LINK}
                    >
                        AI Studio keys
                        <ExternalLink className="size-3.5" strokeWidth={1.5} />
                    </a>
                    <a
                        href={GOOGLE_CREDENTIALS_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={ACC_LINK}
                    >
                        Open Credentials
                        <ExternalLink className="size-3.5" strokeWidth={1.5} />
                    </a>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export function AuthKeyNotice({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                "flex flex-col gap-3 rounded-[10px] bg-warnbg px-4 py-3.5 sm:flex-row sm:items-start",
                className,
            )}
        >
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={1.5} />
            <div className="flex flex-1 flex-col gap-3">
                <p className="text-[13px] leading-relaxed text-fg2">
                    <span className="font-medium text-fg">Heads up on Google&apos;s key types.</span>{" "}
                    New AI Studio keys are restricted “auth keys” by default and need the
                    “Gemini API only” restriction to work. Old unrestricted standard keys are now
                    rejected by Google, and stop working entirely in September 2026.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                    <AuthKeyGuideDialog>
                        <Button variant="sec" className="px-3 py-1.5 text-[12.5px]">
                            Show me how
                        </Button>
                    </AuthKeyGuideDialog>
                    <a
                        href={AI_STUDIO_KEYS_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={GHOST_LINK}
                    >
                        Get a free key
                        <ExternalLink className="size-3.5" strokeWidth={1.5} />
                    </a>
                </div>
            </div>
        </div>
    )
}
