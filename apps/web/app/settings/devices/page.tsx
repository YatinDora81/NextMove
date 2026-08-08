import type { Metadata } from "next"
import { DevicesPanel } from "@/components/settings/DevicesPanel"

export const metadata: Metadata = {
    title: "Connected Devices | NextMoveApp",
    description:
        "Pair the NextMove Autofill extension with your account, see when each device last synced, and revoke access in one click.",
}

/** JF-001 SEC 8.5 — Settings → Connected devices. */
export default function DevicesSettingsPage() {
    return <DevicesPanel />
}
