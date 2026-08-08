"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { cx } from "./cx"

export type SettingsRailItem = { href: string; label: string; icon: ReactNode }

export function SettingsRail({
    items,
    active,
    className,
}: {
    items: SettingsRailItem[]
    active: string
    className?: string
}) {
    return (
        <aside
            className={cx(
                "flex w-[216px] flex-none flex-col gap-0.5 bg-well p-3 max-md:w-[60px] max-md:px-2",
                className
            )}
        >
            <div className="px-3 pb-2 text-[11px] font-medium tracking-[.08em] text-fg3 uppercase max-md:hidden">
                Settings
            </div>
            {items.map((it) => {
                const on = active.startsWith(it.href)
                return (
                    <Link
                        key={it.href}
                        href={it.href}
                        className={cx(
                            "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium max-md:justify-center max-md:px-0",
                            on
                                ? "bg-surface text-fg shadow-qsm [&>svg]:text-acc"
                                : "text-fg2 hover:bg-well2 hover:text-fg"
                        )}
                    >
                        {it.icon}
                        <span className="max-md:hidden">{it.label}</span>
                    </Link>
                )
            })}
        </aside>
    )
}
