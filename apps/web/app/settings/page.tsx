import { redirect } from "next/navigation"

/** /settings has no landing view of its own — AI Keys is the first section (SEC 15.7). */
export default function SettingsIndex() {
    redirect("/settings/ai-keys")
}
