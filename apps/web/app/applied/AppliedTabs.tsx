"use client"

/**
 * JF-001 SEC 8.5 — "/applied evolves into two tabs: Outreach (GeneratedMessages —
 * unchanged) and Applications (synced JobApplication rows)".
 *
 * The two data sets are deliberately not merged: outreach messages and ATS applications
 * answer different questions and are joined only in this UI (SEC 7.5). The active tab is
 * mirrored into `?tab=` so a bookmark or a link from Settings lands on the right half.
 */

import { useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Briefcase, MessagesSquare } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GeneratedMessage } from "@/utils/api_types"
import ApplicationsDashboard from "@/components/applications/ApplicationsDashboard"
import OutreachTab from "@/app/applied/OutreachTab"

const TAB_VALUES = ["outreach", "applications"] as const
type TabValue = (typeof TAB_VALUES)[number]

function isTabValue(value: string | null): value is TabValue {
    return value !== null && (TAB_VALUES as readonly string[]).includes(value)
}

export function AppliedTabs({ messages }: { messages: GeneratedMessage[] }) {
    const router = useRouter()
    const searchParams = useSearchParams()
    const requested = searchParams.get("tab")

    const [tab, setTab] = useState<TabValue>(isTabValue(requested) ? requested : "outreach")

    // Keep the tab in sync when the query string changes underneath us (back/forward, deep link).
    useEffect(() => {
        if (isTabValue(requested) && requested !== tab) setTab(requested)
    }, [requested, tab])

    const handleTabChange = useCallback(
        (next: string) => {
            if (!isTabValue(next)) return
            setTab(next)
            const params = new URLSearchParams(searchParams.toString())
            params.set("tab", next)
            router.replace(`/applied?${params.toString()}`, { scroll: false })
        },
        [router, searchParams],
    )

    return (
        <div className="flex w-full min-h-screen justify-center px-4 pt-[8vh] md:pt-[12vh]">
            <div className="flex w-full max-w-[80rem] flex-col items-start gap-6">
                <div className="flex flex-col gap-1">
                    <h1 className="text-2xl font-semibold md:text-3xl">Applied</h1>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        Outreach you generated here, and applications NextMove Autofill filled for you.
                    </p>
                </div>

                <Tabs value={tab} onValueChange={handleTabChange} className="w-full gap-6">
                    <TabsList>
                        <TabsTrigger value="outreach" className="gap-1.5">
                            <MessagesSquare className="h-3.5 w-3.5" />
                            Outreach
                            <span className="ml-1 rounded-full bg-zinc-200 px-1.5 text-[11px] tabular-nums text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                                {messages.length}
                            </span>
                        </TabsTrigger>
                        <TabsTrigger value="applications" className="gap-1.5">
                            <Briefcase className="h-3.5 w-3.5" />
                            Applications
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="outreach" className="w-full">
                        <OutreachTab messages={messages} />
                    </TabsContent>

                    <TabsContent value="applications" className="w-full">
                        <ApplicationsDashboard />
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    )
}

export default AppliedTabs
