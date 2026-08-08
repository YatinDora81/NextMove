import { redirect } from "next/navigation"

const LEGACY_STEPS: Record<string, string> = {
    welcome: "welcome",
    ai: "ai",
    done: "connect",
}

export default async function LegacyOnboardingRedirect({
    searchParams,
}: {
    searchParams: Promise<{ step?: string }>
}) {
    const params = await searchParams
    const step = params.step !== undefined ? LEGACY_STEPS[params.step] : undefined
    redirect(step !== undefined ? `/onboarding?step=${step}` : "/onboarding")
}

export const dynamic = "force-dynamic"
