"use client"
import React, { ReactNode } from 'react'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"


function AlertModal({ children = 'Open', alertMode = 1 }: { children: ReactNode, alertMode: number }) {

    const alertDetails = [
        {
            title: 'Are you absolutely sure?',
            desc: 'This action cannot be undone. This will permanently delete your template and remove your data from our servers.',
            button1: 'Cancel',
            button1Variant: '',
            button2: 'Delete Permanent',
            button2Variant: ' bg-red-500 hover:bg-red-600 text-white',
        }
    ]

    return (
        <AlertDialog>
            <AlertDialogTrigger>{children}</AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{alertDetails[(alertMode % alertDetails.length)]?.title}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {alertDetails[(alertMode % alertDetails.length)]?.desc}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>{alertDetails[(alertMode % alertDetails.length)]?.button1}</AlertDialogCancel>
                    <AlertDialogAction className={alertDetails[(alertMode % alertDetails.length)]?.button2Variant}>{alertDetails[(alertMode % alertDetails.length)]?.button2}</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

export default AlertModal
