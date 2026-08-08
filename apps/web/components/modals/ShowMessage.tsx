import React, { ReactNode } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"

function ShowMessage({ children, message = "", companyName = "", recruiterName = "", role = "", type = "", createdAt }: { children: ReactNode, message?: string, companyName?: string, recruiterName?: string, role?: string, type?: string, createdAt?: Date }) {


    return (
        <Dialog>
            <DialogTrigger className="hover:underline">{children}</DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Message from Recruiter</DialogTitle>
                </DialogHeader>
                <DialogDescription className="space-y-3">
                    <p><strong>Company:</strong> {companyName}</p>
                    <p><strong>Recruiter:</strong> {recruiterName}</p>
                    {/* <p><strong>Gender:</strong> Male</p> */}
                    <p><strong>Type:</strong> {type === "MESSAGE" ? "Message" : type}</p>
                    <p><strong>Role:</strong> {role}</p>
                    <p><strong>Message:</strong></p>
                    <div className="max-h-[40vh] overflow-y-auto rounded-md bg-well p-3 text-sm whitespace-pre-wrap text-fg">
                        {message}
                    </div>
                    <p className="text-xs text-fg3">Sent on: {new Date(createdAt || new Date()).toLocaleString()}</p>
                </DialogDescription>
            </DialogContent>
        </Dialog>
    )
}

export default ShowMessage
