import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getServerToken } from "@/lib/auth"
import { AiKeysProvider } from "@/hooks/useAiKeys"
import { DevicesProvider } from "@/hooks/useDevices"
import { SettingsShell } from "@/components/settings/SettingsShell"

export const metadata: Metadata = {
    title: "Settings | NextMoveApp",
    description: "Manage your Gemini API keys and the devices connected to your NextMove account.",
}

/**
 * JF-001 SEC 8.5 / 15.7 — Settings shell.
 *
 * Guarded the same way /templates and /applied are: the cookie is checked on the server and an
 * unauthenticated visitor is bounced to the login popup with a redirect back here.
 */
export default async function SettingsLayout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    const token = await getServerToken()

    if (!token) {
        redirect("/?popup=login&redirect_url=/settings")
    }

    return (
        <AiKeysProvider>
            <DevicesProvider>
                <SettingsShell>{children}</SettingsShell>
            </DevicesProvider>
        </AiKeysProvider>
    )
}

export const dynamic = "force-dynamic"
