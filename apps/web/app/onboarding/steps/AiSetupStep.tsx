"use client"

import { CheckCircle2, ExternalLink } from "lucide-react"
import { AddAiKeyForm } from "@/components/settings/AddAiKeyForm"
import { AI_STUDIO_KEYS_URL, AuthKeyNotice } from "@/components/settings/AuthKeyNotice"
import { HonestLimitsNotice } from "@/components/settings/HonestLimitsNotice"
import { maskedKeyDisplay, useAiKeys } from "@/hooks/useAiKeys"
import { Well } from "@/components/quiet/Card"
import { StepHeader, linkButton } from "@/app/onboarding/steps/fields"

const AI_STUDIO_STEPS: readonly string[] = [
    "Open Google AI Studio and sign in with any Google account — the free tier needs no billing card.",
    "Click “Create API key”, pick a project, and copy the key it shows you.",
    "Paste it below. We check it with Google once, then store it encrypted — it is never shown again.",
]

export function AiSetupStep() {
    const { keys } = useAiKeys()

    return (
        <div className="flex flex-col gap-6">
            <StepHeader
                title="AI setup"
                description="NextMove’s AI runs on a free Google Gemini key that you own. It takes about two minutes, costs nothing, and adding a second key later simply doubles your free quota — we rotate across all of them."
            />

            <ol className="flex flex-col gap-3">
                {AI_STUDIO_STEPS.map((step, index) => (
                    <li key={step} className="flex items-start gap-3">
                        <span className="tnum w-4 shrink-0 font-mono text-xs text-fg3">{index + 1}.</span>
                        <span className="text-[13px] leading-relaxed text-fg2">{step}</span>
                    </li>
                ))}
            </ol>

            <div>
                <a
                    href={AI_STUDIO_KEYS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={linkButton.sec}
                >
                    Open Google AI Studio
                    <ExternalLink className="size-3.5" />
                </a>
            </div>

            <AuthKeyNotice />

            {keys.length > 0 ? (
                <Well className="flex items-start gap-2.5 p-4">
                    <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-ok" />
                    <p className="text-[13px] leading-relaxed text-fg2">
                        <span className="font-medium text-fg">
                            {keys.length === 1 ? "Key saved" : `${keys.length} keys saved`}
                        </span>{" "}
                        — {keys.map((key) => maskedKeyDisplay(key.last4)).join(", ")}. AI features are
                        switched on. You can add more from Settings → AI Keys at any time.
                    </p>
                </Well>
            ) : null}

            <AddAiKeyForm />

            <HonestLimitsNotice />

            <p className="text-xs leading-relaxed text-fg2">
                Not now? Skip it. Everything except the AI drafting features works without a key, and
                they will point you back here the first time you reach for one.
            </p>
        </div>
    )
}
