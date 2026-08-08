import { redirect } from "next/navigation"

/**
 * Legacy `/on-boarding`, kept alive purely as a redirect.
 *
 * The three-screen version of onboarding lived here and was linked from the 402 AI_SETUP_REQUIRED
 * card (`/on-boarding?step=ai`) and from anything a user bookmarked. The wizard that replaced it
 * lives at `/onboarding`, so this route's whole job is to translate the old step names onto the new
 * ones and get out of the way — `done` becomes `connect`, which is the screen that now ends the
 * flow.
 */
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
