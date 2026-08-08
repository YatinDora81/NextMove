"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { Logo } from "./Logo"
import { Kbd } from "./Kbd"
import { cx } from "./cx"

const tabs = [
    { href: "/generate", label: "Generate" },
    { href: "/templates", label: "Templates" },
    { href: "/applied", label: "Applied" },
    { href: "/ai-chat", label: "AI Chat" },
]

export function AppBar({
    active,
    right,
    onSearch,
}: {
    active: string
    right?: ReactNode
    onSearch?: () => void
}) {
    return (
        <div className="flex items-center gap-2.5 border-b border-hair bg-surface px-4 py-2.5">
            <Logo size={24} />
            <span className="text-sm font-semibold tracking-[-0.01em] text-fg">NextMove</span>
            <nav className="ml-3 flex gap-0.5 max-md:hidden">
                {tabs.map((t) => (
                    <Link
                        key={t.href}
                        href={t.href}
                        className={cx(
                            "rounded-lg px-2.5 py-1.5 text-[13px] font-medium",
                            active.startsWith(t.href)
                                ? "bg-well text-fg"
                                : "text-fg2 hover:bg-well hover:text-fg"
                        )}
                    >
                        {t.label}
                    </Link>
                ))}
            </nav>
            <div className="ml-auto flex items-center gap-2.5">
                {onSearch && (
                    <button
                        type="button"
                        onClick={onSearch}
                        className="flex min-w-[180px] items-center gap-2 rounded-lg bg-well px-2.5 py-1.5 text-[13px] text-fg3 max-md:hidden"
                    >
                        Search
                        <span className="ml-auto">
                            <Kbd>⌘K</Kbd>
                        </span>
                    </button>
                )}
                {right}
            </div>
        </div>
    )
}
