"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { GeneratedMessage } from "@/utils/api_types"
import ApplicationsDashboard from "@/components/applications/ApplicationsDashboard"
import OutreachTab from "@/app/applied/OutreachTab"

const TAB_VALUES = ["outreach", "applications"] as const
type TabValue = (typeof TAB_VALUES)[number]

const TAB_TRIGGER = cn(
    "h-auto flex-none rounded-[7px] border-transparent px-3 py-1.5 text-[13px] font-medium text-fg2 shadow-none transition-colors",
    "dark:text-fg2 hover:text-fg",
    "data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-qsm",
    "dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-surface dark:data-[state=active]:text-fg",
    "focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc",
)

function isTabValue(value: string | null): value is TabValue {
    return value !== null && (TAB_VALUES as readonly string[]).includes(value)
}

export function AppliedTabs({
    messages,
    outreachError,
}: {
    messages: GeneratedMessage[]
    /** Set when the server could not load outreach; applications are unaffected either way. */
    outreachError: string | null
}) {
    const router = useRouter()
    const searchParams = useSearchParams()
    const requested = searchParams.get("tab")

    // With outreach broken, opening on it would show the user nothing but an error, so land
    // on applications instead — unless the URL asked for a specific tab.
    const [tab, setTab] = useState<TabValue>(
        isTabValue(requested) ? requested : outreachError !== null ? "applications" : "outreach",
    )

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
        <div className="mx-auto w-full max-w-[980px] px-6 py-6">
            <Tabs value={tab} onValueChange={handleTabChange} className="w-full gap-4">
                <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-3">
                        <h1 className="text-[22px] font-[650] tracking-[-0.02em] text-fg">Applied</h1>
                        <TabsList className="h-auto w-fit gap-0.5 rounded-[9px] bg-well p-[3px]">
                            <TabsTrigger value="outreach" className={TAB_TRIGGER}>
                                Outreach
                                {outreachError === null && (
                                    <span className="tnum text-fg3">{messages.length}</span>
                                )}
                            </TabsTrigger>
                            <TabsTrigger value="applications" className={TAB_TRIGGER}>
                                Applications
                            </TabsTrigger>
                        </TabsList>
                    </div>
                    <p className="text-[13px] text-fg2">
                        Outreach you generated here, and applications NextMove Autofill filled for you.
                    </p>
                </div>

                <TabsContent value="outreach" className="w-full">
                    <OutreachTab messages={messages} error={outreachError} />
                </TabsContent>

                <TabsContent value="applications" className="w-full">
                    <ApplicationsDashboard />
                </TabsContent>
            </Tabs>
        </div>
    )
}

export default AppliedTabs
