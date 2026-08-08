"use client"

/**
 * JF-001 SEC 8.2 / 8.5 — Settings → Connected devices.
 *
 * The extension never sees your password and never reads a cookie. It gets in by redeeming an
 * 8-character code that lives for five minutes and can be used exactly once, which is why the
 * code is rendered big, monospaced, and next to a countdown: it is meant to be typed into the
 * extension right now, not saved anywhere.
 */

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
import { Button } from "@/components/ui/button"
import toast from "react-hot-toast"
import { formatCountdown, formatLastSeen, useDevices, type DeviceRow } from "@/hooks/useDevices"
import { cn } from "@/lib/utils"

function PairCodeCard() {
    const { pairCode, secondsLeft, generatePairCode, isMinting } = useDevices()
    const [copied, setCopied] = useState(false)

    if (!pairCode) return null

    // Sub-minute is the "type it now" zone — colour the countdown so it reads as urgent.
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
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/30 p-5">
            <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">
                    Open the NextMove Autofill extension → Options → <span className="font-medium text-foreground">Connect account</span>,
                    and enter this code.
                </p>
                <div className="flex flex-wrap items-center gap-4">
                    <span
                        aria-label={`Pairing code ${pairCode.code.split("").join(" ")}`}
                        className="font-mono text-3xl font-bold tracking-[0.35em] tabular-nums select-all sm:text-4xl"
                    >
                        {pairCode.code}
                    </span>
                    <Button size="sm" variant="outline" onClick={() => void copy()}>
                        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                        {copied ? "Copied" : "Copy"}
                    </Button>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm">
                <span
                    className={cn(
                        "font-mono tabular-nums",
                        urgent ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
                    )}
                >
                    Expires in {formatCountdown(secondsLeft)}
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">Single use.</span>
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void generatePairCode()}
                    disabled={isMinting}
                >
                    {isMinting ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    New code
                </Button>
            </div>
        </div>
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
        <li className="flex flex-col gap-3 border-b border-border px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
                    <Laptop className="size-4 text-muted-foreground" />
                </span>
                <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">
                        {device.name ?? "Unnamed device"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                        Last seen {formatLastSeen(device.lastSeen).toLowerCase()}
                        {device.createdAt
                            ? ` · paired ${new Date(device.createdAt).toLocaleDateString()}`
                            : ""}
                    </span>
                </div>
            </div>

            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={revoking}
                        aria-label={`Revoke ${device.name ?? "device"}`}
                    >
                        {revoking ? (
                            <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                            <Trash2 className="size-3.5" />
                        )}
                        Revoke
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Revoke {device.name ?? "this device"}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Sync stops for that install and it has to be paired again with a fresh code.
                            Its current token keeps working until the extension next refreshes it, so
                            revocation takes effect on the device&apos;s next token refresh — not
                            instantly. Everything the extension already stored on the device stays there;
                            it is local-first by design.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void handleRevoke()}>
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
        <div className="flex w-full flex-col gap-6">
            <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
                <header className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                        <h2 className="font-mono text-lg font-semibold">Connected devices</h2>
                        <p className="max-w-xl text-sm text-muted-foreground">
                            Pair the NextMove Autofill extension with your account so your profile,
                            saved answers and application tracker follow you between browsers.
                        </p>
                    </div>
                    {!pairCode ? (
                        <Button size="sm" onClick={() => void generatePairCode()} disabled={isMinting}>
                            {isMinting ? (
                                <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                                <Plug className="size-3.5" />
                            )}
                            Connect extension
                        </Button>
                    ) : null}
                </header>

                <PairCodeCard />

                {error ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-800 dark:text-red-200">
                        <span>{error}</span>
                        <Button size="sm" variant="outline" onClick={() => void fetchDevices()}>
                            Try again
                        </Button>
                    </div>
                ) : null}

                {isLoading && !hasLoaded ? (
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        Loading your devices…
                    </div>
                ) : null}

                {devices.length > 0 ? (
                    <ul className="overflow-hidden rounded-lg border border-border">
                        {devices.map((device) => (
                            <DeviceRowItem key={device.id} device={device} />
                        ))}
                    </ul>
                ) : hasLoaded && !error ? (
                    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
                        <span className="flex size-10 items-center justify-center rounded-xl border border-border bg-muted">
                            <Laptop className="size-5 text-muted-foreground" />
                        </span>
                        <p className="font-mono text-sm font-semibold">No devices paired</p>
                        <p className="max-w-sm text-sm text-muted-foreground">
                            The extension works fully offline without pairing — connect one only if you
                            want your data synced across browsers.
                        </p>
                    </div>
                ) : null}

                <p className="text-xs leading-relaxed text-muted-foreground">
                    Revoking a device deletes its pairing record straight away, but the token already on
                    that device keeps working until its next refresh — so treat revoke as “stop syncing
                    soon”, not “kill the session this second”. Your Gemini keys are never part of
                    pairing: extension keys stay on the device and web keys stay in the server vault.
                </p>
            </section>
        </div>
    )
}
