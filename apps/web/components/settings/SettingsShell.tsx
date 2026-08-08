"use client"

import type { ReactNode } from "react"
import { usePathname } from "next/navigation"
import { KeyRound, Laptop } from "lucide-react"
import { SettingsRail } from "@/components/quiet/SettingsRail"
import type { SettingsRailItem } from "@/components/quiet/SettingsRail"

const ITEMS: SettingsRailItem[] = [
    {
        href: "/settings/ai-keys",
        label: "AI keys",
        icon: <KeyRound className="size-4 shrink-0" strokeWidth={1.5} />,
    },
    {
        href: "/settings/devices",
        label: "Devices",
        icon: <Laptop className="size-4 shrink-0" strokeWidth={1.5} />,
    },
]

export function SettingsShell({ children }: { children: ReactNode }) {
    const pathname = usePathname()

    return (
        <div className="flex min-h-[calc(100dvh-61px)] w-full items-stretch bg-bg">
            <nav aria-label="Settings sections" className="flex flex-none">
                <SettingsRail items={ITEMS} active={pathname} className="px-2.5 py-3.5" />
            </nav>
            <main className="min-w-0 flex-1 px-7 py-6 max-md:px-4">{children}</main>
        </div>
    )
}
