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

function AppliedPage() {

    const mess = 'This is me how are oyu ass hole  This is me how are oyu ass holeThis is me how are oyu ass holeThis is me how are oyu ass holeThis is me how are oyu ass holeThis is me how are oyu ass hole'

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
                            <TableHead>Gender</TableHead>
                            <TableHead>Message</TableHead>
                            <TableHead className="text-right">Date</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        <TableRow>
                            <TableCell className="font-medium">11111</TableCell>
                            <TableCell className="">Google</TableCell>
                            <TableCell className="">Sundar Pichai</TableCell>
                            <TableCell className="">Full Stack</TableCell>
                            <TableCell className="">Email</TableCell>
                            <TableCell className="">Male</TableCell>
                            <TableCell className="message text-wrap">{mess.length > 70 ? <ShowMessage>{mess.slice(0, 70) + '...'}</ShowMessage> : mess}</TableCell>
                            <TableCell className="text-right">2025-09-25</TableCell>
                        </TableRow>
                    </TableBody>
                </Table>

            </div>
        </div>
    )
}

export default AppliedPage
