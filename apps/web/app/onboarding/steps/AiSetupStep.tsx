"use client"

/**
 * Step 6 — AI setup, and the only optional step in the wizard.
 *
 * This reuses the Settings components verbatim (`AddAiKeyForm`, `AuthKeyNotice`,
 * `HonestLimitsNotice`) rather than restating them: a key added here and a key added in Settings
 * must go through exactly the same validate-then-store path, and two copies of that form would
 * eventually disagree about what a valid key looks like.
 *
 * Skipping is genuinely free — every non-AI feature works without a key, and the 402
 * AI_SETUP_REQUIRED card links back here when someone reaches for an AI feature later. The Skip
 * control lives in the wizard footer next to Continue, at the same visual weight, on purpose.
 */

import { CheckCircle2, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AddAiKeyForm } from "@/components/settings/AddAiKeyForm"
import { AI_STUDIO_KEYS_URL, AuthKeyNotice } from "@/components/settings/AuthKeyNotice"
import { HonestLimitsNotice } from "@/components/settings/HonestLimitsNotice"
import { maskedKeyDisplay, useAiKeys } from "@/hooks/useAiKeys"
import { StepHeader } from "@/app/onboarding/steps/fields"

const AI_STUDIO_STEPS: readonly string[] = [
    "Open Google AI Studio and sign in with any Google account — the free tier needs no billing card.",
    "Click “Create API key”, pick a project, and copy the key it shows you.",
    "Paste it below. We check it with Google once, then store it encrypted — it is never shown again.",
]

export function AiSetupStep() {
    const { keys } = useAiKeys()

    return (
        <div className="flex flex-col gap-8">
            <StepHeader
                title="AI setup"
                description="NextMove’s AI runs on a free Google Gemini key that you own. It takes about two minutes, costs nothing, and adding a second key later simply doubles your free quota — we rotate across all of them."
            />

            <ol className="flex flex-col gap-3">
                {AI_STUDIO_STEPS.map((step, index) => (
                    <li key={step} className="flex items-start gap-3">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted font-mono text-[11px]">
                            {index + 1}
                        </span>
                        <span className="text-sm leading-relaxed text-muted-foreground">{step}</span>
                    </li>
                ))}
            </ol>

            <div>
                <Button variant="outline" asChild>
                    <a href={AI_STUDIO_KEYS_URL} target="_blank" rel="noopener noreferrer">
                        Open Google AI Studio
                        <ExternalLink className="size-3.5" />
                    </a>
                </Button>
            </div>

            <AuthKeyNotice />

            {keys.length > 0 ? (
                <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-900 dark:text-emerald-100">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                    <p className="leading-relaxed">
                        <span className="font-medium">
                            {keys.length === 1 ? "Key saved" : `${keys.length} keys saved`}
                        </span>{" "}
                        — {keys.map((key) => maskedKeyDisplay(key.last4)).join(", ")}. AI features are
                        switched on. You can add more from Settings → AI Keys at any time.
                    </p>
                </div>
            ) : null}

            <AddAiKeyForm />

            <HonestLimitsNotice />

            <p className="text-xs leading-relaxed text-muted-foreground">
                Not now? Skip it. Everything except the AI drafting features works without a key, and
                they will point you back here the first time you reach for one.
            </p>
        </div>
    )
}
