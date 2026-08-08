"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import toast from "react-hot-toast"
import {
    ArrowRight,
    Check,
    Chrome,
    Copy,
    Download,
    KeyRound,
    Loader2,
    Puzzle,
    RotateCw,
    ShieldAlert,
    Sparkles,
} from "lucide-react"
import type { SharedProfile } from "@repo/types/ProfileTypes"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID ?? ""

const PROBE_TIMEOUT_MS = 1500

type HelloResponse = {
    ok?: boolean
    installed?: boolean
    version?: string
    paired?: boolean
    nonce?: string
}

type ChromeRuntime = {
    sendMessage?: (
        extensionId: string,
        message: { type: string },
        callback: (response?: HelloResponse) => void,
    ) => void
    lastError?: { message?: string }
}

function extensionRuntime(): ChromeRuntime | null {
    if (typeof window === "undefined") return null
    const host = window as unknown as { chrome?: { runtime?: ChromeRuntime } }
    return host.chrome?.runtime ?? null
}

type ProbeState = "checking" | "installed" | "missing"

function maskKey(key: string): string {
    return key.length <= 12 ? key : `${key.slice(0, 6)}…${key.slice(-4)}`
}

export function ConnectStep({
    draft,
    vaultKey,
    skippedAi,
    saving,
    saveFailed,
    onSaveAgain,
    onExportRecoveryKey,
}: {
    draft: SharedProfile
    vaultKey: string | null
    skippedAi: boolean
    saving: boolean
    saveFailed: boolean
    onSaveAgain: () => void
    onExportRecoveryKey: () => void
}) {
    const [probe, setProbe] = useState<ProbeState>("checking")
    const [paired, setPaired] = useState(false)
    const [exported, setExported] = useState(false)
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        const runtime = extensionRuntime()
        const send = runtime?.sendMessage
        if (runtime === null || typeof send !== "function" || EXTENSION_ID === "") {
            setProbe("missing")
            return
        }

        let settled = false
        const timer = window.setTimeout(() => {
            if (settled) return
            settled = true
            setProbe("missing")
        }, PROBE_TIMEOUT_MS)

        try {
            send.call(runtime, EXTENSION_ID, { type: "NEXTMOVE_HELLO" }, (response) => {
                if (settled) return
                settled = true
                window.clearTimeout(timer)
                const failed = runtime.lastError !== undefined || response?.ok !== true
                setProbe(failed ? "missing" : "installed")
                setPaired(response?.paired === true)
            })
        } catch {
            settled = true
            window.clearTimeout(timer)
            setProbe("missing")
        }

        return () => {
            settled = true
            window.clearTimeout(timer)
        }
    }, [])

    const handleCopy = useCallback(async () => {
        if (vaultKey === null) return
        try {
            await navigator.clipboard.writeText(vaultKey)
            setCopied(true)
            setExported(true)
            window.setTimeout(() => setCopied(false), 2000)
        } catch {
            toast.error("Your browser blocked the clipboard — use Download instead.")
        }
    }, [vaultKey])

    const roles = draft.work.length
    const schools = draft.education.length
    const skills = draft.skills.length

    return (
        <div className="flex flex-col gap-8">
            <header className="flex flex-col gap-3">
                <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
                    Last step
                </p>
                <h1 className="font-mono text-3xl font-semibold tracking-tight">Your profile is saved</h1>
                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    {[
                        `${roles} ${roles === 1 ? "role" : "roles"}`,
                        `${schools} ${schools === 1 ? "school" : "schools"}`,
                        `${skills} ${skills === 1 ? "skill" : "skills"}`,
                    ].join(", ")}{" "}
                    sealed in your vault. Two things left, and the first one matters more than it looks.
                </p>
            </header>

            {saveFailed ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
                    <ShieldAlert className="size-4 shrink-0 text-destructive" />
                    <p className="flex-1 text-sm leading-relaxed">
                        The last save didn’t reach the server. Your answers are still in this tab — try
                        again before you leave.
                    </p>
                    <Button variant="outline" size="sm" onClick={onSaveAgain} disabled={saving}>
                        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
                        Save again
                    </Button>
                </div>
            ) : null}

            <section
                className={cn(
                    "flex flex-col gap-4 rounded-lg border p-5",
                    exported ? "border-border bg-muted/30" : "border-amber-500/40 bg-amber-500/5",
                )}
            >
                <div className="flex items-start gap-3">
                    <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="flex flex-col gap-1">
                        <h2 className="font-mono text-sm font-semibold">Save your recovery key</h2>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                            Your profile is encrypted with this key before it leaves the browser, and we
                            never receive a copy. It lives in this browser’s storage — clear that, or
                            switch to another machine, and this key is the only way back into your vault.
                        </p>
                    </div>
                </div>

                {vaultKey === null ? (
                    <p className="font-mono text-xs text-muted-foreground">Preparing your key…</p>
                ) : (
                    <>
                        <code className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xs break-all">
                            {maskKey(vaultKey)}
                        </code>
                        <div className="flex flex-wrap items-center gap-3">
                            <Button
                                onClick={() => {
                                    onExportRecoveryKey()
                                    setExported(true)
                                }}
                            >
                                <Download className="size-4" />
                                Download recovery key
                            </Button>
                            <Button variant="outline" onClick={() => void handleCopy()}>
                                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                                {copied ? "Copied" : "Copy to clipboard"}
                            </Button>
                        </div>
                        {!exported ? (
                            <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                                Do this before you close the tab. There is no reset link — that is the
                                point of end-to-end encryption.
                            </p>
                        ) : null}
                    </>
                )}
            </section>

            <section className="flex flex-col gap-4 rounded-lg border border-border p-5">
                <div className="flex items-start gap-3">
                    <Puzzle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="flex flex-col gap-1">
                        <h2 className="font-mono text-sm font-semibold">
                            {paired ? "Extension connected" : "Connect the extension"}
                        </h2>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                            {paired
                                ? "This browser is already paired. Your profile syncs to it automatically — you can manage or revoke the pairing from Settings → Devices."
                                : "Pairing hands the extension your vault key so it can fill forms offline. It finds the submit button and highlights it; it never presses it."}
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {probe === "checking" ? (
                        <Button disabled>
                            <Loader2 className="size-4 animate-spin" />
                            Looking for the extension…
                        </Button>
                    ) : probe === "missing" ? (
                        <>
                            <Button asChild>
                                <Link href="/extension">
                                    <Chrome className="size-4" />
                                    Install NextMove Autofill
                                </Link>
                            </Button>
                            <p className="text-xs text-muted-foreground">
                                Already installed? Reload this page and we’ll spot it.
                            </p>
                        </>
                    ) : paired ? (
                        <Button variant="outline" asChild>
                            <Link href="/settings/devices">Manage paired devices</Link>
                        </Button>
                    ) : (
                        <Button asChild>
                            <Link href="/extension/connect">
                                Connect this browser
                                <ArrowRight className="size-4" />
                            </Link>
                        </Button>
                    )}
                </div>
            </section>

            {skippedAi ? (
                <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4">
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        You skipped the AI key, which is fine — autofill, templates and tracking all work
                        without one. Add a free Gemini key from{" "}
                        <Link href="/settings/ai-keys" className="underline underline-offset-4">
                            Settings → AI Keys
                        </Link>{" "}
                        whenever you want the drafting features switched on.
                    </p>
                </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
                <Button variant="outline" asChild>
                    <Link href="/generate">
                        Start using NextMove
                        <ArrowRight className="size-4" />
                    </Link>
                </Button>
                <p className="text-xs text-muted-foreground">
                    Everything here is editable later from your profile.
                </p>
            </div>
        </div>
    )
}
