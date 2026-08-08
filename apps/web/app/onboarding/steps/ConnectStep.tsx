"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import toast from "react-hot-toast"
import {
    Check,
    CheckCircle2,
    Circle,
    Copy,
    Download,
    KeyRound,
    Loader2,
    RotateCw,
    ShieldAlert,
    Sparkles,
} from "lucide-react"
import type { SharedProfile } from "@repo/types/ProfileTypes"
import { Button } from "@/components/quiet/Button"
import { Chip } from "@/components/quiet/Chip"
import { Well } from "@/components/quiet/Card"
import { cn } from "@/lib/utils"
import { linkButton } from "@/app/onboarding/steps/fields"

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
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-1">
                <p className="text-[11px] font-medium tracking-[0.09em] text-fg3 uppercase">Last step</p>
                <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg">
                    Your profile is saved
                </h1>
                <p className="text-[13px] leading-relaxed text-fg2">
                    {[
                        `${roles} ${roles === 1 ? "role" : "roles"}`,
                        `${schools} ${schools === 1 ? "school" : "schools"}`,
                        `${skills} ${skills === 1 ? "skill" : "skills"}`,
                    ].join(", ")}{" "}
                    sealed in your vault. Two things left, and the first one matters more than it looks.
                </p>
            </header>

            {saveFailed ? (
                <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-dan/40 bg-danbg p-4">
                    <ShieldAlert aria-hidden className="size-4 shrink-0 text-dan" />
                    <p className="flex-1 text-[13px] leading-relaxed text-fg">
                        The last save didn’t reach the server. Your answers are still in this tab — try
                        again before you leave.
                    </p>
                    <Button
                        variant="sec"
                        className="px-3 py-1.5 text-[12.5px]"
                        onClick={onSaveAgain}
                        disabled={saving}
                    >
                        {saving ? (
                            <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                            <RotateCw className="size-3.5" />
                        )}
                        Save again
                    </Button>
                </div>
            ) : null}

            <section
                className={cn(
                    "flex flex-col gap-4 rounded-[10px] border p-5",
                    exported ? "border-hair bg-well" : "border-warn/40 bg-warnbg",
                )}
            >
                <div className="flex items-start gap-3">
                    <KeyRound aria-hidden className="mt-0.5 size-4 shrink-0 text-fg2" />
                    <div className="flex flex-col gap-1">
                        <h2 className="text-[13.5px] font-medium text-fg">Save your recovery key</h2>
                        <p className="text-xs leading-relaxed text-fg2">
                            Your profile is encrypted with this key before it leaves the browser, and we
                            never receive a copy. It lives in this browser’s storage — clear that, or
                            switch to another machine, and this key is the only way back into your vault.
                        </p>
                    </div>
                </div>

                {vaultKey === null ? (
                    <p className="font-mono text-xs text-fg2">Preparing your key…</p>
                ) : (
                    <>
                        <code className="rounded-lg border border-hair2 bg-surface px-3 py-2 font-mono text-xs break-all text-fg2">
                            {maskKey(vaultKey)}
                        </code>
                        <div className="flex flex-wrap items-center gap-3">
                            <Button
                                variant="acc"
                                onClick={() => {
                                    onExportRecoveryKey()
                                    setExported(true)
                                }}
                            >
                                <Download className="size-4" />
                                Download recovery key
                            </Button>
                            <Button variant="ghost" onClick={() => void handleCopy()}>
                                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                                {copied ? "Copied" : "Copy to clipboard"}
                            </Button>
                        </div>
                        {!exported ? (
                            <p className="text-xs leading-relaxed text-warn">
                                Do this before you close the tab. There is no reset link — that is the
                                point of end-to-end encryption.
                            </p>
                        ) : null}
                    </>
                )}
            </section>

            <section className="rounded-[10px] border border-hair p-5">
                <h2 className="text-[13.5px] font-medium text-fg">
                    {paired ? "Extension connected" : "Connect the extension"}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-fg2">
                    {paired
                        ? "This browser is already paired. Your profile syncs to it automatically — you can manage or revoke the pairing from Settings → Devices."
                        : "Pairing hands the extension your vault key so it can fill forms offline. It finds the submit button and highlights it; it never presses it."}
                </p>

                <ul className="mt-4 flex flex-col">
                    <li className="flex items-center gap-2.5 border-b border-hair px-0.5 py-3 text-[13.5px] text-fg">
                        {probe === "checking" ? (
                            <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-fg3" />
                        ) : probe === "installed" ? (
                            <CheckCircle2 aria-hidden className="size-4 shrink-0 text-ok" />
                        ) : (
                            <Circle aria-hidden className="size-4 shrink-0 text-fg3" />
                        )}
                        Extension detected
                        <span className="ml-auto text-xs text-fg2">
                            {probe === "checking"
                                ? "Checking…"
                                : probe === "installed"
                                  ? "Ready"
                                  : "Not found"}
                        </span>
                    </li>
                    <li className="flex items-center gap-2.5 px-0.5 py-3 text-[13.5px] text-fg">
                        {paired ? (
                            <CheckCircle2 aria-hidden className="size-4 shrink-0 text-ok" />
                        ) : (
                            <Circle aria-hidden className="size-4 shrink-0 text-fg3" />
                        )}
                        Paired with this browser
                        {paired ? (
                            <Chip tone="ok" className="ml-auto">
                                Live
                            </Chip>
                        ) : (
                            <span className="ml-auto text-xs text-fg2">Not paired yet</span>
                        )}
                    </li>
                </ul>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                    {probe === "checking" ? (
                        <Button variant="sec" disabled>
                            <Loader2 className="size-4 animate-spin" />
                            Looking for the extension…
                        </Button>
                    ) : probe === "missing" ? (
                        <>
                            <Link href="/extension" className={linkButton.sec}>
                                Install NextMove Autofill
                            </Link>
                            <p className="text-xs text-fg2">
                                Already installed? Reload this page and we’ll spot it.
                            </p>
                        </>
                    ) : paired ? (
                        <Link href="/settings/devices" className={linkButton.sec}>
                            Manage paired devices
                        </Link>
                    ) : (
                        <Link href="/extension/connect" className={linkButton.sec}>
                            Connect this browser
                        </Link>
                    )}
                </div>
            </section>

            {skippedAi ? (
                <Well className="flex items-start gap-3 p-4">
                    <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-fg2" />
                    <p className="text-xs leading-relaxed text-fg2">
                        You skipped the AI key, which is fine — autofill, templates and tracking all work
                        without one. Add a free Gemini key from{" "}
                        <Link href="/settings/ai-keys" className="text-fg underline underline-offset-4">
                            Settings → AI Keys
                        </Link>{" "}
                        whenever you want the drafting features switched on.
                    </p>
                </Well>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 border-t border-hair pt-6">
                <Link href="/generate" className={cn(linkButton.acc, "px-5 py-2.5")}>
                    Start using NextMove
                </Link>
                <p className="text-xs text-fg2">
                    Everything here is editable later from your profile.
                </p>
            </div>
        </div>
    )
}
