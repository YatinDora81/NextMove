"use client"

import { Card } from "@/components/quiet/Card"
import ShowMessage from "@/components/modals/ShowMessage"
import { GeneratedMessage } from "@/utils/api_types"

function initial(...candidates: (string | null | undefined)[]): string {
    for (const candidate of candidates) {
        const trimmed = (candidate ?? "").trim()
        if (trimmed !== "") return trimmed.charAt(0).toUpperCase()
    }
    return "—"
}

function joinParts(parts: (string | null | undefined)[]): string {
    return parts.map((part) => (part ?? "").trim()).filter((part) => part !== "").join(" · ")
}

export function OutreachTab({
    messages,
    error,
}: {
    messages: GeneratedMessage[]
    /** Set when the outreach fetch failed. Scoped to this pane so the page still renders. */
    error: string | null
}) {
    // An outreach failure says nothing about the applications tab, so it stays in this pane
    // rather than standing in for the whole page.
    if (error !== null) {
        return (
            <div className="rounded-xl border border-dan/40 bg-danbg px-4 py-3 text-[13.5px] text-dan">
                {error}
            </div>
        )
    }

    if (!messages || messages.length === 0) {
        return (
            <Card className="px-4 py-12 text-center text-[13.5px] text-fg2">No messages found</Card>
        )
    }

    return (
        <Card className="overflow-hidden">
            <ul aria-label="Outreach you generated">
                {messages.map((msg) => {
                    const company = msg.company_gen_rel?.name || ""
                    const role = msg.roleRel?.name || ""
                    const type = msg.messageType === "MESSAGE" ? "Message" : msg.messageType
                    const isLong = msg.message.length > 70

                    return (
                        <li
                            key={msg.id}
                            className="flex items-start gap-3 border-b border-hair px-4 py-3.5 last:border-b-0"
                        >
                            <span
                                aria-hidden="true"
                                className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-full bg-well2 text-xs font-semibold text-fg2"
                            >
                                {initial(msg.recruiterName, company)}
                            </span>

                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-baseline gap-2">
                                    <b className="text-sm font-semibold text-fg">
                                        {joinParts([msg.recruiterName, company]) || "Untitled"}
                                    </b>
                                    <span className="text-[12.5px] text-fg2">{joinParts([role, type])}</span>
                                    <span className="tnum ml-auto text-xs text-fg2">
                                        {new Date(msg.createdAt).toLocaleDateString()}
                                    </span>
                                </div>

                                <p className="mt-1 truncate text-[13px] leading-[1.6] text-fg2">
                                    {isLong ? (
                                        <ShowMessage
                                            message={msg.message}
                                            companyName={company}
                                            recruiterName={msg.recruiterName || ""}
                                            role={role}
                                            type={msg.messageType}
                                            createdAt={msg.createdAt}
                                        >
                                            {msg.message.slice(0, 70) + "..."}
                                        </ShowMessage>
                                    ) : (
                                        msg.message
                                    )}
                                </p>
                            </div>
                        </li>
                    )
                })}
            </ul>
        </Card>
    )
}

export default OutreachTab
