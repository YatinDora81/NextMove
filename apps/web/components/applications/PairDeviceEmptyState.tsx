"use client"

/**
 * The Applications tab has nothing to show until a device is paired (SEC 8.2) and the
 * extension has pushed a row up. Rather than an empty table, explain the pairing flow.
 */

import Link from "next/link"
import { Chrome, KeyRound, Link2, Puzzle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

type Props = {
    /** False = no device on the account yet; true = paired but nothing synced. */
    hasPairedDevice: boolean
    onRefresh: () => void
    isRefreshing: boolean
}

const PAIRING_STEPS: { icon: typeof Puzzle; title: string; body: string }[] = [
    {
        icon: Puzzle,
        title: "Install NextMove Autofill",
        body: "The extension does the filling. It works entirely offline — pairing is only about syncing this tracker.",
    },
    {
        icon: KeyRound,
        title: "Generate a pairing code",
        body: "Settings → Connected devices → “Connect extension” mints an 8-character code that is valid for 5 minutes and can only be used once.",
    },
    {
        icon: Link2,
        title: "Type it into the extension",
        body: "Open the extension's Options page, paste the code, and name the device. Your NextMove password is never entered into the extension.",
    },
]

export function PairDeviceEmptyState({ hasPairedDevice, onRefresh, isRefreshing }: Props) {
    return (
        <div className="flex w-full flex-col items-center gap-8 rounded-xl border border-dashed border-zinc-300 px-6 py-12 dark:border-zinc-700">
            <div className="flex max-w-xl flex-col items-center gap-3 text-center">
                <div className="rounded-xl bg-zinc-100 p-3 dark:bg-zinc-800">
                    <Chrome className="h-6 w-6" aria-hidden="true" />
                </div>
                <h2 className="text-xl font-semibold">
                    {hasPairedDevice ? "No synced applications yet" : "Connect the extension to fill this tab"}
                </h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {hasPairedDevice
                        ? "This device is paired. Applications appear here as soon as NextMove Autofill fills a form and syncs the row up — fill one application and hit refresh."
                        : "This tab shows the applications NextMove Autofill filled for you. Rows land here once you pair a browser with your account."}
                </p>
            </div>

            {!hasPairedDevice && (
                <ol className="grid w-full max-w-3xl gap-4 md:grid-cols-3">
                    {PAIRING_STEPS.map((step, index) => (
                        <li
                            key={step.title}
                            className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 text-left dark:border-zinc-800 dark:bg-zinc-900/60"
                        >
                            <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                <step.icon className="h-4 w-4" aria-hidden="true" />
                                Step {index + 1}
                            </div>
                            <div className="text-sm font-semibold">{step.title}</div>
                            <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{step.body}</p>
                        </li>
                    ))}
                </ol>
            )}

            <div className="flex flex-wrap items-center justify-center gap-3">
                <Button asChild>
                    <Link href="/extension">Get the extension</Link>
                </Button>
                <Button asChild variant="outline">
                    <Link href="/settings/devices">Settings → Connected devices</Link>
                </Button>
                <Button variant="ghost" onClick={onRefresh} disabled={isRefreshing} className="gap-1.5">
                    <RefreshCw className={isRefreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                    Refresh
                </Button>
            </div>

            <p className="max-w-xl text-center text-xs text-zinc-500 dark:text-zinc-500">
                Only these tracker rows sync. Your profile, resumes, saved answers and Gemini keys stay on the
                device — the extension works with sync switched off.
            </p>
        </div>
    )
}

export default PairDeviceEmptyState
