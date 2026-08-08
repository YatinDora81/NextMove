"use client"

import { Briefcase, Loader2, Lock, ShieldCheck, User } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/quiet/Button"
import { Well } from "@/components/quiet/Card"

const COLLECTED: readonly { icon: LucideIcon; title: string; body: string }[] = [
    {
        icon: User,
        title: "Who you are",
        body: "Name, email, phone and address — the block every application form opens with.",
    },
    {
        icon: Briefcase,
        title: "Where you’ve worked",
        body: "Roles, dates and bullet points, plus education, links and skills.",
    },
    {
        icon: ShieldCheck,
        title: "What you’re eligible for",
        body: "Work authorisation and sponsorship, and the voluntary EEO questions you can decline.",
    },
]

export function WelcomeStep({
    firstName,
    busy,
    onStart,
}: {
    firstName: string
    busy: boolean
    onStart: () => void
}) {
    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-2">
                <p className="text-[11px] font-medium tracking-[0.09em] text-fg3 uppercase">
                    NextMove Autofill
                </p>
                <h1 className="text-[26px] leading-[1.15] font-[650] tracking-[-0.022em] text-fg">
                    {firstName ? `Let’s set you up, ${firstName}.` : "Let’s set you up."}
                </h1>
                <p className="text-[13.5px] leading-relaxed text-fg2">
                    Fill in your details once here, and the NextMove extension fills them into every job
                    application form you open — it finds the submit button and highlights it, but never
                    presses it.
                </p>
            </header>

            <div className="flex flex-col gap-3">
                <h2 className="text-[13px] font-medium text-fg">What the next five screens collect</h2>
                <ul className="grid gap-3 sm:grid-cols-3">
                    {COLLECTED.map((item) => {
                        const Icon = item.icon
                        return (
                            <li key={item.title}>
                                <Well className="flex h-full flex-col gap-2 p-4">
                                    <Icon aria-hidden className="size-4 text-fg2" />
                                    <p className="text-[13px] font-medium text-fg">{item.title}</p>
                                    <p className="text-xs leading-relaxed text-fg2">{item.body}</p>
                                </Well>
                            </li>
                        )
                    })}
                </ul>
            </div>

            <Well className="flex items-start gap-3 p-4">
                <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-fg2" />
                <p className="text-xs leading-relaxed text-fg2">
                    Your answers are encrypted in this browser before they are stored. Our servers only
                    ever hold the ciphertext, and the key never leaves your device — which is why the
                    last screen offers you a copy of it to keep somewhere safe.
                </p>
            </Well>

            <div className="flex flex-wrap items-center gap-3">
                <Button variant="acc" className="px-5 py-2.5" onClick={onStart} disabled={busy}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                    Start with the basics
                </Button>
                <p className="text-xs text-fg2">Takes about four minutes. You can stop and come back.</p>
            </div>
        </div>
    )
}
