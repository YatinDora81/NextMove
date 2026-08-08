"use client"

/**
 * JF-001 SEC 8.5 — the "Outreach" tab of the unified Applied dashboard.
 *
 * This is the pre-existing GeneratedMessages table, moved inside the tab with its
 * behaviour untouched: same columns, same 70-character truncation into the `ShowMessage`
 * dialog, same empty-state row, same caption. Only the page-level wrapper (which now
 * belongs to the tab shell) was dropped — everything a user could do here before, they can
 * still do.
 */

import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import ShowMessage from "@/components/modals/ShowMessage"
import { GeneratedMessage } from "@/utils/api_types"

export function OutreachTab({ messages }: { messages: GeneratedMessage[] }) {
    return (
        <Table>
            <TableCaption>A list of your applied Companies.</TableCaption>
            <TableHeader>
                <TableRow>
                    <TableHead className="w-[15px]">No</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Recruiter Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead className="text-right">Date</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {messages && messages.length > 0 ? (
                    messages.map((msg, index: number) => (
                        <TableRow key={msg.id}>
                            <TableCell className="font-medium">{index + 1}</TableCell>
                            <TableCell className="">{msg.company_gen_rel?.name || ""}</TableCell>
                            <TableCell className="">{msg.recruiterName}</TableCell>
                            <TableCell className="">{msg.roleRel?.name || ""}</TableCell>
                            <TableCell className="">
                                {msg.messageType === "MESSAGE" ? "Message" : msg.messageType}
                            </TableCell>
                            <TableCell className="message text-wrap">
                                {msg.message.length > 70 ? (
                                    <ShowMessage
                                        message={msg.message}
                                        companyName={msg.company_gen_rel?.name || ""}
                                        recruiterName={msg.recruiterName || ""}
                                        role={msg.roleRel?.name || ""}
                                        type={msg.messageType}
                                        createdAt={msg.createdAt}
                                    >
                                        {msg.message.slice(0, 70) + "..."}
                                    </ShowMessage>
                                ) : (
                                    msg.message
                                )}
                            </TableCell>
                            <TableCell className="text-right">
                                {new Date(msg.createdAt).toLocaleDateString()}
                            </TableCell>
                        </TableRow>
                    ))
                ) : (
                    <TableRow>
                        <TableCell colSpan={7} className="text-center">
                            No messages found
                        </TableCell>
                    </TableRow>
                )}
            </TableBody>
        </Table>
    )
}

export default OutreachTab
