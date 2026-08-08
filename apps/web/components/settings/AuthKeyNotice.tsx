"use client"

/**
 * JF-001 SEC 15.7 — the Google auth-key warning.
 *
 * Google split API keys in two. New keys minted in AI Studio are restricted **auth keys**: they
 * work with the Gemini API, but only once the "Gemini API only" restriction is on them. The old
 * unrestricted **standard keys** are now rejected by Google, with the full standard-key cutoff in
 * September 2026. Nearly every "my key doesn't work" report is one of those two states, so the
 * fix has to be one click away from the paste field, not buried in docs.
 */

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
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const AI_STUDIO_KEYS_URL = "https://aistudio.google.com/apikey"
export const GOOGLE_CREDENTIALS_URL = "https://console.cloud.google.com/apis/credentials"

const RESTRICTION_STEPS: readonly string[] = [
    "Open Google Cloud console → APIs & Services → Credentials (the button below opens it).",
    "Pick the project your AI Studio key belongs to, then click the key's name.",
    "Under “API restrictions”, choose “Restrict key”.",
    "In the dropdown, tick “Generative Language API” — that is the Gemini API — and nothing else.",
    "Save. Restrictions take about a minute to propagate.",
    "Come back here and press “Test & Save” again.",
]

/** The guide itself — a dialog so it can be opened from settings and from onboarding alike. */
export function AuthKeyGuideDialog({ children }: { children: React.ReactNode }) {
    const [open, setOpen] = useState(false)

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 font-mono">
                        <KeyRound className="size-4" />
                        Add the “Gemini API only” restriction
                    </DialogTitle>
                    <DialogDescription>
                        Google now issues restricted auth keys by default. A key without the Gemini API
                        restriction is refused, and so is any old unrestricted standard key.
                    </DialogDescription>
                </DialogHeader>

                <ol className="flex list-none flex-col gap-3 text-sm">
                    {RESTRICTION_STEPS.map((step, index) => (
                        <li key={step} className="flex items-start gap-3">
                            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted font-mono text-[11px]">
                                {index + 1}
                            </span>
                            <span className="text-muted-foreground leading-relaxed">{step}</span>
                        </li>
                    ))}
                </ol>

                <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                    Keys created in AI Studio after the auth-key change already carry the restriction —
                    if yours is new and still fails, it is usually the wrong Google project. Standard
                    keys stop working entirely in <span className="font-medium text-foreground">September 2026</span>.
                </p>

                <DialogFooter className="gap-2 sm:justify-between">
                    <Button variant="outline" asChild>
                        <a href={AI_STUDIO_KEYS_URL} target="_blank" rel="noopener noreferrer">
                            AI Studio keys
                            <ExternalLink className="size-3.5" />
                        </a>
                    </Button>
                    <Button asChild>
                        <a href={GOOGLE_CREDENTIALS_URL} target="_blank" rel="noopener noreferrer">
                            Open Credentials
                            <ExternalLink className="size-3.5" />
                        </a>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/** The inline warning strip that sits above the paste field. */
export function AuthKeyNotice({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                "flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm sm:flex-row sm:items-start",
                className,
            )}
        >
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="flex flex-1 flex-col gap-3">
                <p className="leading-relaxed text-amber-900 dark:text-amber-100">
                    <span className="font-medium">Heads up on Google&apos;s key types.</span>{" "}
                    New AI Studio keys are restricted “auth keys” by default and need the
                    “Gemini API only” restriction to work. Old unrestricted standard keys are now
                    rejected by Google, and stop working entirely in September 2026.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                    <AuthKeyGuideDialog>
                        <Button size="sm" variant="outline" className="bg-background/60">
                            Show me how
                        </Button>
                    </AuthKeyGuideDialog>
                    <Button size="sm" variant="ghost" asChild>
                        <a href={AI_STUDIO_KEYS_URL} target="_blank" rel="noopener noreferrer">
                            Get a free key
                            <ExternalLink className="size-3.5" />
                        </a>
                    </Button>
                </div>
            </div>
        </div>
    )
}
