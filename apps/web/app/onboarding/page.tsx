import type { Metadata } from "next"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { getServerToken } from "@/lib/auth"
import { AiKeysProvider } from "@/hooks/useAiKeys"
import { ProfileVaultProvider } from "@/hooks/useProfileVault"
import { OnboardingWizard } from "@/app/onboarding/OnboardingWizard"
import type { StepId } from "@/app/onboarding/OnboardingWizard"

export const metadata: Metadata = {
    title: "Set up your profile | NextMoveApp",
    description:
        "Fill in your application details once. NextMove encrypts them in your browser and the autofill extension takes it from there.",
}

/**
 * The `?step=` whitelist. Written out rather than imported from the wizard because every export of
 * a "use client" module reaches a server component as a client *reference*, not as a callable
 * function — the type import above is erased at compile time and is the only safe half to share.
 */
const STEP_PARAMS: Record<string, StepId> = {
    welcome: "welcome",
    about: "about",
    experience: "experience",
    links: "links",
    eligibility: "eligibility",
    ai: "ai",
    connect: "connect",
}

/**
 * JF-001 SEC 7.2 — `/onboarding`, where a profile is authored.
 *
 * Auth is checked here as well as in middleware.ts: middleware protects the navigation, this guards
 * the render, and the vault call the wizard makes on mount needs a bearer token to be worth making.
 */
export default async function OnboardingPage({
    searchParams,
}: {
    searchParams: Promise<{ step?: string }>
}) {
    const token = await getServerToken()
    if (!token) {
        redirect("/?popup=login&redirect_url=/onboarding")
    }

    const params = await searchParams
    const requested = params.step
    const initialStep: StepId =
        (requested !== undefined ? STEP_PARAMS[requested] : undefined) ?? "welcome"

    return (
        <ProfileVaultProvider>
            <AiKeysProvider>
                {/* useSearchParams inside the wizard needs a boundary of its own. */}
                <Suspense fallback={null}>
                    <OnboardingWizard initialStep={initialStep} />
                </Suspense>
            </AiKeysProvider>
        </ProfileVaultProvider>
    )
}

export const dynamic = "force-dynamic"
