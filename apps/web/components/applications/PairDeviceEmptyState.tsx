"use client"

import Link from "next/link"
import { Chrome, KeyRound, Link2, Puzzle, RefreshCw } from "lucide-react"
import { Button } from "@/components/quiet/Button"
import { Card } from "@/components/quiet/Card"
import { cn } from "@/lib/utils"

type Props = {

    hasPairedDevice: boolean
    onRefresh: () => void
    isRefreshing: boolean
}

const LINK_BUTTON = cn(
    "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[13.5px] font-medium transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc",
)

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
        <div className="flex w-full flex-col items-center gap-6 rounded-xl border border-dashed border-hair2 px-6 py-12">
            <div className="flex max-w-xl flex-col items-center gap-3 text-center">
                <Chrome className="h-5 w-5 text-fg2" aria-hidden="true" />
                <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-fg">
                    {hasPairedDevice ? "No synced applications yet" : "Connect the extension to fill this tab"}
                </h2>
                <p className="text-[13.5px] leading-[1.6] text-fg2">
                    {hasPairedDevice
                        ? "This device is paired. Applications appear here as soon as NextMove Autofill fills a form and syncs the row up — fill one application and hit refresh."
                        : "This tab shows the applications NextMove Autofill filled for you. Rows land here once you pair a browser with your account."}
                </p>
            </div>

            {!hasPairedDevice && (
                <ol className="grid w-full max-w-3xl gap-3 md:grid-cols-3">
                    {PAIRING_STEPS.map((step, index) => (
                        <li key={step.title}>
                            <Card className="flex h-full flex-col gap-2 p-4 text-left">
                                <div className="flex items-center gap-2 text-xs font-medium text-fg3">
                                    <step.icon className="h-4 w-4" aria-hidden="true" />
                                    Step {index + 1}
                                </div>
                                <div className="text-[13.5px] font-semibold text-fg">{step.title}</div>
                                <p className="text-xs leading-[1.6] text-fg2">{step.body}</p>
                            </Card>
                        </li>
                    ))}
                </ol>
            )}

            <div className="flex flex-wrap items-center justify-center gap-2">
                <Link
                    href="/extension"
                    className={cn(
                        LINK_BUTTON,
                        "bg-acc text-on-acc shadow-[inset_0_1px_0_rgba(255,255,255,.14),var(--qp-sh-sm)] hover:bg-acc-strong",
                    )}
                >
                    Get the extension
                </Link>
                <Link
                    href="/settings/devices"
                    className={cn(LINK_BUTTON, "border border-hair2 bg-surface text-fg shadow-qsm hover:bg-well")}
                >
                    Settings → Connected devices
                </Link>
                <Button variant="ghost" onClick={onRefresh} disabled={isRefreshing}>
                    <RefreshCw className={isRefreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                    Refresh
                </Button>
            </div>

            <p className="max-w-xl text-center text-xs leading-[1.6] text-fg3">
                Only these tracker rows sync. Your profile, resumes, saved answers and Gemini keys stay on the
                device — the extension works with sync switched off.
            </p>
        </div>
    )
}

export default PairDeviceEmptyState
