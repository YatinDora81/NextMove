import type { Metadata } from "next"
import { AiKeysPanel } from "@/components/settings/AiKeysPanel"

export const metadata: Metadata = {
    title: "AI Keys | NextMoveApp",
    description:
        "Add and manage the free Google Gemini keys that power NextMove's AI features. Keys are encrypted at rest and never shown again.",
}

/** JF-001 SEC 15.7 — Settings → AI Keys. */
export default function AiKeysSettingsPage() {
    return <AiKeysPanel />
}
