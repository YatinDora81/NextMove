"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { motion } from "motion/react"
import {
    AlertTriangle,
    ArrowRight,
    Check,
    CheckCircle2,
    Chrome,
    Download,
    KeyRound,
    Loader2,
    Puzzle,
    RefreshCw,
    ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { useProfileVault } from "@/hooks/useProfileVault"
import {
    deviceNameFromUserAgent,
    sendConnect,
    sendHello,
    sendStatus,
} from "@/lib/extensionBridge"
import type { BridgeError } from "@/lib/extensionBridge"
import { cn } from "@/lib/utils"
import { DEVICE_PAIR_CODE } from "@/utils/url"

const CHROME_STORE_URL =
    process.env.NEXT_PUBLIC_CHROME_STORE_URL ??
    "https://chromewebstore.google.com/search/NextMove%20Autofill"

type Phase = "detecting" | "missing" | "idle" | "connecting" | "connected" | "failed"

interface Outcome {
    alreadyPaired: boolean
    profilesApplied: number
    deviceName: string | null
    version: string
}

const STEPS: { title: string; detail: string }[] = [
    {
        title: "Creating your encryption key",
        detail: "A 256-bit key, generated here in your browser. NextMove never receives a copy.",
    },
    {
        title: "Opening a channel to the extension",
        detail: "A single-use token proves this page is the one the extension opened.",
    },
    {
        title: "Minting a one-time pairing code",
        detail: "Valid for five minutes, usable once. It is not a password and cannot be reused.",
    },
    {
        title: "Handing over and pulling your profile",
        detail: "The extension trades the code for its own token, then decrypts your profile locally.",
    },
]

function Shell({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex min-h-screen w-full items-start justify-center pt-[8vh] md:pt-[12vh]">
            <div className="flex w-[90%] max-w-2xl flex-col gap-6 pb-24">{children}</div>
        </div>
    )
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <div
            className={cn(
                "rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm md:p-8",
                className,
            )}
        >
            {children}
        </div>
    )
}

function PinCoachMark() {
    return (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-4">
            <div className="flex items-center gap-2">
                <Puzzle className="size-4 text-muted-foreground" />
                <p className="text-sm font-medium">Pin it to your toolbar</p>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
                Chrome hides new extensions behind the puzzle-piece icon to the right of the address
                bar. Click it, find <span className="font-medium text-foreground">NextMove Autofill</span>,
                and click the pin next to it. There is no way for a page to do this for you &mdash; Chrome
                reserves it for you deliberately, and it takes about three seconds.
            </p>
        </div>
    )
}

export function ConnectHandshake({
    nonce,
    extensionVersion,
}: {
    nonce: string | null
    extensionVersion: string | null
}) {
    const { getToken } = useAuth()
    const { ensureVaultKey, exportRecoveryKey, load, error: vaultError } = useProfileVault()

    const [phase, setPhase] = useState<Phase>("detecting")
    const [stepIndex, setStepIndex] = useState(0)
    const [failure, setFailure] = useState<BridgeError | null>(null)
    const [outcome, setOutcome] = useState<Outcome | null>(null)
    const [deviceName, setDeviceName] = useState<string | null>(null)
    const [keyExported, setKeyExported] = useState(false)

    const nonceRef = useRef<string | null>(nonce)

    const probe = useCallback(async () => {
        setPhase("detecting")
        const result = await sendStatus()
        if (!result.ok) {
            setPhase("missing")
            return
        }
        if (result.reply.paired) {
            setOutcome({
                alreadyPaired: true,
                profilesApplied: 0,
                deviceName: result.reply.deviceName ?? null,
                version: result.reply.version,
            })
            setPhase("connected")
            return
        }
        setPhase("idle")
    }, [])

    useEffect(() => {
        setDeviceName(deviceNameFromUserAgent())
        void probe()
    }, [probe])

    useEffect(() => {
        void load()
    }, [load])

    const mintPairCode = useCallback(async (): Promise<string> => {
        const token = await getToken()
        if (token === null || token.length === 0) {
            throw new Error("You are signed out. Sign in again and reopen this page.")
        }
        const res = await fetch(DEVICE_PAIR_CODE, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        })
        const body = (await res.json()) as { success?: boolean; data?: unknown; message?: string }
        if (!res.ok || body.success !== true) {
            throw new Error(body.message ?? "Could not create a pairing code. Try again in a moment.")
        }
        const data = typeof body.data === "object" && body.data !== null
            ? (body.data as Record<string, unknown>)
            : {}
        if (typeof data.code !== "string" || data.code.length === 0) {
            throw new Error("The server did not return a pairing code.")
        }
        return data.code
    }, [getToken])

    const runConnect = useCallback(async () => {
        setPhase("connecting")
        setFailure(null)
        setStepIndex(0)

        try {
            const vaultKey = await ensureVaultKey()

            setStepIndex(1)
            let handshakeNonce = nonceRef.current
            if (handshakeNonce === null) {
                const hello = await sendHello()
                if (!hello.ok) {
                    setFailure(hello.error)
                    setPhase("failed")
                    return
                }
                if (typeof hello.reply.nonce !== "string" || hello.reply.nonce.length === 0) {
                    setFailure({
                        code: "NO_NONCE",
                        message: "The extension did not issue a connect token. Reload this page and try again.",
                    })
                    setPhase("failed")
                    return
                }
                handshakeNonce = hello.reply.nonce
            }
            nonceRef.current = null

            setStepIndex(2)
            const pairCode = await mintPairCode()

            setStepIndex(3)
            const connected = await sendConnect({
                nonce: handshakeNonce,
                pairCode,
                vaultKey,
                ...(deviceName !== null ? { deviceName } : {}),
            })
            if (!connected.ok) {
                setFailure(connected.error)
                setPhase("failed")
                return
            }
            if (!connected.reply.ok) {
                setFailure(
                    connected.reply.error ?? {
                        code: "REFUSED",
                        message: "The extension refused the connection without saying why.",
                    },
                )
                setPhase("failed")
                return
            }

            setOutcome({
                alreadyPaired: false,
                profilesApplied: connected.reply.profilesApplied ?? 0,
                deviceName: connected.reply.deviceName ?? deviceName,
                version: connected.reply.version,
            })
            setPhase("connected")
        } catch (err) {
            setFailure({
                code: "CONNECT_FAILED",
                message: err instanceof Error && err.message.length > 0
                    ? err.message
                    : "Something went wrong while connecting. Try again.",
            })
            setPhase("failed")
        }
    }, [deviceName, ensureVaultKey, mintPairCode])

    const handleExport = useCallback(() => {
        exportRecoveryKey()
        setKeyExported(true)
    }, [exportRecoveryKey])

    if (phase === "detecting") {
        return (
            <Shell>
                <Panel className="flex items-center gap-3">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                        Looking for NextMove Autofill in this browser&hellip;
                    </p>
                </Panel>
            </Shell>
        )
    }

    if (phase === "missing") {
        return (
            <Shell>
                <Panel className="flex flex-col gap-5">
                    <div className="flex flex-col gap-2">
                        <Chrome className="size-6 text-muted-foreground" />
                        <h1 className="font-mono text-2xl font-semibold">Install the extension first</h1>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                            This page connects NextMove Autofill to your account, but nothing is answering
                            in this browser. Either it is not installed yet, or it is switched off at{" "}
                            <span className="font-mono text-foreground">chrome://extensions</span>.
                        </p>
                    </div>

                    <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                        <li className="flex items-start gap-2">
                            <span className="mt-0.5 font-mono text-xs text-foreground">1.</span>
                            Add NextMove Autofill from the Chrome Web Store.
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="mt-0.5 font-mono text-xs text-foreground">2.</span>
                            It reopens this page by itself once it is installed &mdash; if it does not, come
                            back here and press Check again.
                        </li>
                    </ul>

                    <div className="flex flex-col gap-3 sm:flex-row">
                        <Button asChild className="gap-2">
                            <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer">
                                <Download className="size-4" />
                                Add to Chrome &mdash; free
                            </a>
                        </Button>
                        <Button variant="outline" className="gap-2" onClick={() => void probe()}>
                            <RefreshCw className="size-4" />
                            Check again
                        </Button>
                    </div>

                    <p className="text-xs text-muted-foreground">
                        Firefox and Safari are not supported yet &mdash; the handshake this page uses is a
                        Chromium API. Everything else on NextMove works in any browser.
                    </p>
                </Panel>
            </Shell>
        )
    }

    if (phase === "connected" && outcome !== null) {
        const needsProfile = !outcome.alreadyPaired && outcome.profilesApplied === 0
        return (
            <Shell>
                <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    className="flex flex-col gap-6"
                >
                    <Panel className="flex flex-col gap-5">
                        <div className="flex flex-col gap-2">
                            <CheckCircle2 className="size-7 text-emerald-600 dark:text-emerald-400" />
                            <h1 className="font-mono text-2xl font-semibold">
                                {outcome.alreadyPaired
                                    ? "This browser is already connected"
                                    : "NextMove Autofill is connected"}
                            </h1>
                            <p className="text-sm leading-relaxed text-muted-foreground">
                                {outcome.alreadyPaired
                                    ? "The extension in this browser is already paired with your account, so there was nothing to do. You can re-pair it from Settings if you ever need to."
                                    : "Press Alt+J on any job application and it will fill what it can, highlight what it filled, and leave Submit to you."}
                            </p>
                        </div>

                        <ul className="flex flex-col gap-3">
                            <li className="flex items-start gap-3">
                                <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                <span className="text-sm leading-relaxed">
                                    Paired as{" "}
                                    <span className="font-medium">
                                        {outcome.deviceName ?? deviceName ?? "this browser"}
                                    </span>
                                    . Revoke it any time from{" "}
                                    <Link
                                        href="/settings/devices"
                                        className="font-medium underline underline-offset-4"
                                    >
                                        Settings &rarr; Connected devices
                                    </Link>
                                    .
                                </span>
                            </li>
                            <li className="flex items-start gap-3">
                                <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                <span className="text-sm leading-relaxed">
                                    {outcome.alreadyPaired
                                        ? "Your profile syncs in the background on a timer, so it is already on this device and stays current without you doing anything."
                                        : outcome.profilesApplied > 0
                                          ? `Your profile is on this device — ${outcome.profilesApplied} ${outcome.profilesApplied === 1 ? "profile" : "profiles"} decrypted and stored locally. The extension can fill forms with the network off.`
                                          : "Your account has no saved profile yet, so there was nothing to pull down. Fill one in and the extension picks it up on its next sync."}
                                </span>
                            </li>
                            <li className="flex items-start gap-3">
                                <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                <span className="text-sm leading-relaxed">
                                    Your encryption key went straight from this tab to the extension. It was
                                    never sent to NextMove, which is why we can store your profile without
                                    being able to read it.
                                </span>
                            </li>
                        </ul>
                    </Panel>

                    <Panel className="flex flex-col gap-4 border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/25">
                        <div className="flex items-center gap-2">
                            <KeyRound className="size-4 text-amber-700 dark:text-amber-300" />
                            <h2 className="text-base font-semibold text-amber-900 dark:text-amber-100">
                                Save your recovery key before you go
                            </h2>
                        </div>
                        <p className="text-sm leading-relaxed text-amber-900/90 dark:text-amber-100/90">
                            Your profile is encrypted with a key that only this browser and this extension
                            hold. We cannot reset it, because we never had it. Download it now and keep it
                            in your password manager &mdash; you will need it to sign in on another
                            computer, and without it a cleared browser means starting your profile over.
                        </p>
                        <div className="flex flex-wrap items-center gap-3">
                            <Button
                                variant={keyExported ? "outline" : "default"}
                                className="gap-2"
                                onClick={handleExport}
                            >
                                <Download className="size-4" />
                                {keyExported ? "Download again" : "Download recovery key"}
                            </Button>
                            {keyExported ? (
                                <span className="flex items-center gap-1.5 text-xs text-amber-900/80 dark:text-amber-100/80">
                                    <ShieldCheck className="size-3.5" />
                                    Saved as nextmove-recovery-key.txt &mdash; move it into your password
                                    manager.
                                </span>
                            ) : null}
                        </div>
                    </Panel>

                    <Panel className="flex flex-col gap-4">
                        <PinCoachMark />
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                            <Button asChild className="gap-2">
                                <Link href={needsProfile ? "/onboarding" : "/applied"}>
                                    {needsProfile ? "Fill in your profile" : "Open your dashboard"}
                                    <ArrowRight className="size-4" />
                                </Link>
                            </Button>
                            <p className="text-xs text-muted-foreground">
                                {needsProfile
                                    ? "Two minutes now saves you retyping the same answers on every application."
                                    : "Every application the extension fills lands here automatically."}
                            </p>
                        </div>
                    </Panel>
                </motion.div>
            </Shell>
        )
    }

    const running = phase === "connecting"

    return (
        <Shell>
            <Panel className="flex flex-col gap-6">
                <div className="flex flex-col gap-2">
                    <Chrome className="size-6 text-muted-foreground" />
                    <h1 className="font-mono text-2xl font-semibold">Connect NextMove</h1>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                        One click pairs the extension with your account and gives it the key to your
                        profile. The key is created in this browser and handed over directly &mdash; it
                        does not travel through our servers, and we cannot read what it protects.
                    </p>
                </div>

                <ol className="flex flex-col gap-3">
                    {STEPS.map((step, index) => {
                        const done = running && index < stepIndex
                        const active = running && index === stepIndex
                        return (
                            <li key={step.title} className="flex items-start gap-3">
                                <span
                                    className={cn(
                                        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]",
                                        done && "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                                        active && "border-foreground/30 bg-foreground text-background",
                                        !done && !active && "border-border bg-muted text-muted-foreground",
                                    )}
                                >
                                    {done ? (
                                        <Check className="size-3" />
                                    ) : active ? (
                                        <Loader2 className="size-3 animate-spin" />
                                    ) : (
                                        index + 1
                                    )}
                                </span>
                                <div className="flex flex-col gap-0.5">
                                    <p
                                        className={cn(
                                            "text-sm",
                                            active ? "font-medium text-foreground" : "text-foreground/90",
                                        )}
                                    >
                                        {step.title}
                                    </p>
                                    <p className="text-xs leading-relaxed text-muted-foreground">
                                        {step.detail}
                                    </p>
                                </div>
                            </li>
                        )
                    })}
                </ol>

                {vaultError !== null ? (
                    <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/25">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
                        <p className="text-xs leading-relaxed text-amber-900/90 dark:text-amber-100/90">
                            {vaultError} You can still connect this device &mdash; pairing and the
                            application tracker work either way.
                        </p>
                    </div>
                ) : null}

                {phase === "failed" && failure !== null ? (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
                    >
                        <div className="flex items-center gap-2">
                            <AlertTriangle className="size-4 text-destructive" />
                            <p className="text-sm font-medium">That did not work</p>
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                {failure.code}
                            </code>
                        </div>
                        <p className="text-sm leading-relaxed text-muted-foreground">{failure.message}</p>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                            Connect tokens are single-use, so trying again asks the extension for a fresh
                            one. If it keeps failing, pair manually from{" "}
                            <Link href="/settings/devices" className="font-medium underline underline-offset-4">
                                Settings &rarr; Connected devices
                            </Link>
                            .
                        </p>
                    </motion.div>
                ) : null}

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <Button className="gap-2" disabled={running} onClick={() => void runConnect()}>
                        {running ? (
                            <>
                                <Loader2 className="size-4 animate-spin" />
                                Connecting&hellip;
                            </>
                        ) : phase === "failed" ? (
                            <>
                                <RefreshCw className="size-4" />
                                Try again
                            </>
                        ) : (
                            <>
                                <ShieldCheck className="size-4" />
                                Connect NextMove
                            </>
                        )}
                    </Button>
                    {deviceName !== null ? (
                        <p className="text-xs text-muted-foreground">
                            This device will show up as{" "}
                            <span className="font-medium text-foreground">{deviceName}</span>
                            {extensionVersion !== null ? ` · extension v${extensionVersion}` : ""}.
                        </p>
                    ) : null}
                </div>
            </Panel>
        </Shell>
    )
}
