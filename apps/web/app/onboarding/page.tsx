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

const STEP_PARAMS: Record<string, StepId> = {
    welcome: "welcome",
    about: "about",
    experience: "experience",
    links: "links",
    eligibility: "eligibility",
    ai: "ai",
    connect: "connect",
}

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
                <Suspense fallback={null}>
                    <OnboardingWizard initialStep={initialStep} />
                </Suspense>
            </AiKeysProvider>
        </ProfileVaultProvider>
    )
}

export const dynamic = "force-dynamic"
