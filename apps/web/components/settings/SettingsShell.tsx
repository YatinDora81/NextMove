"use client"

/** JF-001 SEC 8.5 / 15.7 — the Settings shell: title plus the section tabs. */

import Link from "next/link"
import { usePathname } from "next/navigation"
import { KeyRound, Laptop } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type SettingsTab = {
    name: string
    href: string
    icon: LucideIcon
}

const TABS: readonly SettingsTab[] = [
    { name: "AI Keys", href: "/settings/ai-keys", icon: KeyRound },
    { name: "Devices", href: "/settings/devices", icon: Laptop },
]

export function SettingsShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()

    return (
        <div className="flex min-h-screen w-full items-start justify-center pt-[8vh] md:pt-[12vh]">
            <div className="flex w-[90%] max-w-4xl flex-col items-start justify-start gap-6 pb-16">
                <div className="flex flex-col gap-4">
                    <h1 className="font-mono text-3xl font-semibold">Settings</h1>

                    <nav
                        aria-label="Settings sections"
                        className="bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]"
                    >
                        {TABS.map((tab) => {
                            const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
                            const Icon = tab.icon
                            return (
                                <Link
                                    key={tab.href}
                                    href={tab.href}
                                    aria-current={active ? "page" : undefined}
                                    className={cn(
                                        "inline-flex h-[calc(100%-1px)] items-center justify-center gap-1.5 rounded-md border border-transparent px-3 py-1 font-mono text-sm font-medium whitespace-nowrap transition-[color,box-shadow]",
                                        "focus-visible:ring-ring/50 focus-visible:outline-ring focus-visible:ring-[3px] focus-visible:outline-1",
                                        active
                                            ? "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30"
                                            : "text-foreground/70 hover:text-foreground dark:text-muted-foreground",
                                    )}
                                >
                                    <Icon className="size-4" />
                                    {tab.name}
                                </Link>
                            )
                        })}
                    </nav>
                </div>

                <div className="w-full">{children}</div>
            </div>
        </div>
    )
}
