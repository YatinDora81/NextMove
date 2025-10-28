"use client"
import React from 'react'
import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import ShowMessage from '@/components/modals/ShowMessage'
import { GeneratedMessage } from '@/utils/api_types'

function AppliedPage({ messages }: { messages: GeneratedMessage[] }) {

    return (
        <div className=' w-full min-h-screen pt-[8vh] md:pt-[12vh] flex justify-center items-center'>
            <div className=' w-[80%] min-h-screen h-[200vh] flex flex-col justify-start items-start'>

                <Table>
                    <TableCaption>A list of your applied Companies.</TableCaption>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[15px]">No</TableHead>
                            <TableHead>Company</TableHead>
                            <TableHead>Recruiter Name</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Type</TableHead>
                            {/* <TableHead>Gender</TableHead> */}
                            <TableHead>Message</TableHead>
                            <TableHead className="text-right">Date</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {
                            messages.map((msg, index: number) => (<TableRow key={msg.id}>
                                <TableCell className="font-medium">{index + 1}</TableCell>
                                <TableCell className="">{msg.company_gen_rel?.name || ""}</TableCell>
                                <TableCell className="">{msg.recruiterName}</TableCell>
                                <TableCell className="">{msg.roleRel?.name || ""}</TableCell>
                                <TableCell className="">{msg.messageType === "MESSAGE" ? "Message" : msg.messageType}</TableCell>
                                {/* <TableCell className="">{msg.gender}</TableCell> */}
                                <TableCell className="message text-wrap">{msg.message.length > 70 ? <ShowMessage 
                                    message={msg.message} 
                                    companyName={msg.company_gen_rel?.name || ""} 
                                    recruiterName={msg.recruiterName || ""} 
                                    role={msg.roleRel?.name || ""} 
                                    type={msg.messageType}
                                    createdAt={msg.createdAt}
                                    >
                                        {msg.message.slice(0, 70) + '...'}</ShowMessage> : msg.message}</TableCell>
                                <TableCell className="text-right">{new Date(msg.createdAt).toLocaleDateString()}</TableCell>
                            </TableRow>))
                        }

                    </TableBody>
                </Table>

            </div>
        </div>
    )
}

export default AppliedPage
