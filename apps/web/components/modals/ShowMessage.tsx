import React, { ReactNode } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"

function ShowMessage({ children }: { children: ReactNode }) {
    return (
        <Dialog>
            <DialogTrigger className="hover:underline">{children}</DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Message from Recruiter</DialogTitle>
                </DialogHeader>
                <DialogDescription className="space-y-3">
                    <p><strong>Company:</strong> Google</p>
                    <p><strong>Recruiter:</strong> Sundar Pichai</p>
                    <p><strong>Gender:</strong> Male</p>
                    <p><strong>Type:</strong> Email</p>
                    <p><strong>Role:</strong> Full Stack Developer</p>
                    <p><strong>Message:</strong></p>
                    <div className="p-3 bg-gray-100 dark:bg-zinc-900/60 rounded-md text-sm max-h-[40vh] overflow-y-auto">
                        {/* Dummy long message */}
                        {Array(10).fill(
                            "Hello, thank you for applying to Google. We have reviewed your profile and would like to move forward with the interview process. Please let us know your availability for the coming week. Looking forward to speaking with you. 🚀"
                        ).join(" ")}
                    </div>
                    <p className="text-xs text-muted-foreground">Sent on: 2025-09-25</p>
                </DialogDescription>
            </DialogContent>
        </Dialog>
    )
}

export default ShowMessage
