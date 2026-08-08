"use client"

import { useState } from "react"
import { Check, Copy, Laptop, Loader2, Plug, Trash2 } from "lucide-react"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import toast from "react-hot-toast"
import { Button } from "@/components/quiet/Button"
import { Card, Well } from "@/components/quiet/Card"
import { formatCountdown, formatLastSeen, useDevices, type DeviceRow } from "@/hooks/useDevices"
import { cn } from "@/lib/utils"

function PairCodeCard() {
    const { pairCode, secondsLeft, generatePairCode, isMinting } = useDevices()
    const [copied, setCopied] = useState(false)

    if (!pairCode) return null

    const urgent = secondsLeft <= 60

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(pairCode.code)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
        } catch {
            toast.error("Your browser blocked clipboard access — type the code instead")
        }
    }

    return (
        <Well className="mt-4 px-4 py-3.5">
            <p className="text-[13px] leading-relaxed text-fg2">
                Open the NextMove Autofill extension → Options →{" "}
                <span className="font-medium text-fg">Connect account</span>, and enter this code.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-4">
                <span
                    aria-label={`Pairing code ${pairCode.code.split("").join(" ")}`}
                    className="font-mono text-[28px] font-[650] tracking-[0.3em] text-fg tabular-nums select-all sm:text-[34px]"
                >
                    {pairCode.code}
                </span>
                <Button variant="sec" className="px-3 py-1.5 text-[12.5px]" onClick={() => void copy()}>
                    {copied ? (
                        <Check className="size-3.5" strokeWidth={1.5} />
                    ) : (
                        <Copy className="size-3.5" strokeWidth={1.5} />
                    )}
                    {copied ? "Copied" : "Copy"}
                </Button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className={cn("font-mono tabular-nums", urgent ? "text-dan" : "text-fg2")}>
                    Expires in {formatCountdown(secondsLeft)}
                </span>
                <span className="text-fg3">·</span>
                <span className="text-fg2">Single use.</span>
                <Button
                    variant="ghost"
                    className="px-2.5 py-1.5 text-[12.5px]"
                    onClick={() => void generatePairCode()}
                    disabled={isMinting}
                >
                    {isMinting ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    New code
                </Button>
            </div>
        </Well>
    )
}

function DeviceRowItem({ device }: { device: DeviceRow }) {
    const { revokeDevice } = useDevices()
    const [revoking, setRevoking] = useState(false)

    const handleRevoke = async () => {
        setRevoking(true)
        await revokeDevice(device.id)
        setRevoking(false)
    }

    return (
        <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hair px-4 py-3.5 last:border-b-0">
            <Laptop className="size-4 shrink-0 text-fg2" strokeWidth={1.5} />

            <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold text-fg">
                    {device.name ?? "Unnamed device"}
                </div>
                <div className="truncate text-xs text-fg2">
                    Last seen {formatLastSeen(device.lastSeen).toLowerCase()}
                    {device.createdAt
                        ? ` · paired ${new Date(device.createdAt).toLocaleDateString()}`
                        : ""}
                </div>
            </div>

            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button
                        variant="danger"
                        className="shrink-0 px-2.5 py-1.5 text-[12.5px]"
                        disabled={revoking}
                        aria-label={`Revoke ${device.name ?? "device"}`}
                    >
                        {revoking ? (
                            <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                            <Trash2 className="size-3.5" strokeWidth={1.5} />
                        )}
                        Revoke
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="rounded-xl border-hair bg-surface shadow-qmd">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[16px] tracking-[-0.01em] text-fg">
                            Revoke {device.name ?? "this device"}?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-[13px] leading-relaxed text-fg2">
                            Sync stops for that install and it has to be paired again with a fresh code.
                            Its current token keeps working until the extension next refreshes it, so
                            revocation takes effect on the device&apos;s next token refresh — not
                            instantly. Everything the extension already stored on the device stays there;
                            it is local-first by design.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="rounded-lg border-hair2 bg-surface text-[13.5px] font-medium text-fg shadow-qsm hover:bg-well hover:text-fg">
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            className="rounded-lg border border-dan/40 bg-danbg text-[13.5px] font-medium text-dan shadow-none hover:bg-dan/15"
                            onClick={() => void handleRevoke()}
                        >
                            Revoke device
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </li>
    )
}

export function DevicesPanel() {
    const {
        devices, isLoading, hasLoaded, error, pairCode, isMinting,
        generatePairCode, fetchDevices,
    } = useDevices()

    return (
        <div className="max-w-[600px]">
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[20px] font-[650] tracking-[-0.02em] text-fg">Devices</h1>
                {!pairCode ? (
                    <Button
                        variant="acc"
                        className="ml-auto px-3 py-1.5 text-[13px]"
                        onClick={() => void generatePairCode()}
                        disabled={isMinting}
                    >
                        {isMinting ? (
                            <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                            <Plug className="size-3.5" strokeWidth={1.5} />
                        )}
                        Connect extension
                    </Button>
                ) : null}
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-fg2">
                Pair the NextMove Autofill extension with your account so your profile, saved answers
                and application tracker follow you between browsers.
            </p>

            <PairCodeCard />

            {error ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dan/40 bg-danbg px-4 py-3 text-[13px] text-fg">
                    <span>{error}</span>
                    <Button variant="sec" className="px-3 py-1.5 text-[12.5px]" onClick={() => void fetchDevices()}>
                        Try again
                    </Button>
                </div>
            ) : null}

            {isLoading && !hasLoaded ? (
                <Well className="mt-4 flex items-center gap-2 px-4 py-3.5 text-[13px] text-fg2">
                    <Loader2 className="size-4 animate-spin" />
                    Loading your devices…
                </Well>
            ) : null}

            {devices.length > 0 ? (
                <Card className="mt-4 overflow-hidden">
                    <ul>
                        {devices.map((device) => (
                            <DeviceRowItem key={device.id} device={device} />
                        ))}
                    </ul>
                </Card>
            ) : hasLoaded && !error ? (
                <Well className="mt-4 flex flex-col items-center gap-2 px-4 py-8 text-center">
                    <Laptop className="size-4 text-fg2" strokeWidth={1.5} />
                    <p className="text-[13.5px] font-semibold text-fg">No devices paired</p>
                    <p className="max-w-[46ch] text-[13px] leading-relaxed text-fg2">
                        The extension works fully offline without pairing — connect one only if you
                        want your data synced across browsers.
                    </p>
                </Well>
            ) : null}

            <p className="mt-3 text-xs leading-relaxed text-fg2">
                Revoking a device deletes its pairing record straight away, but the token already on
                that device keeps working until its next refresh — so treat revoke as “stop syncing
                soon”, not “kill the session this second”. Your Gemini keys are never part of
                pairing: extension keys stay on the device and web keys stay in the server vault.
            </p>
        </div>
    )
}
