"use client"

import { ArrowRight, Briefcase, Loader2, Lock, ShieldCheck, User } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

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
        <div className="flex flex-col gap-8">
            <header className="flex flex-col gap-3">
                <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
                    NextMove Autofill
                </p>
                <h1 className="font-mono text-3xl font-semibold tracking-tight">
                    {firstName ? `Let’s set you up, ${firstName}.` : "Let’s set you up."}
                </h1>
                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    Fill in your details once here, and the NextMove extension fills them into every job
                    application form you open — it finds the submit button and highlights it, but never
                    presses it.
                </p>
            </header>

            <div className="flex flex-col gap-3">
                <h2 className="font-mono text-sm font-semibold">What the next five screens collect</h2>
                <ul className="grid gap-3 sm:grid-cols-3">
                    {COLLECTED.map((item) => {
                        const Icon = item.icon
                        return (
                            <li
                                key={item.title}
                                className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-4"
                            >
                                <Icon className="size-4 text-muted-foreground" />
                                <p className="text-sm font-medium">{item.title}</p>
                                <p className="text-xs leading-relaxed text-muted-foreground">{item.body}</p>
                            </li>
                        )
                    })}
                </ul>
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4">
                <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                    Your answers are encrypted in this browser before they are stored. Our servers only
                    ever hold the ciphertext, and the key never leaves your device — which is why the
                    last screen offers you a copy of it to keep somewhere safe.
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <Button size="lg" onClick={onStart} disabled={busy}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                    Start with the basics
                    {busy ? null : <ArrowRight className="size-4" />}
                </Button>
                <p className="text-xs text-muted-foreground">Takes about four minutes. You can stop and come back.</p>
            </div>
        </div>
    )
}
