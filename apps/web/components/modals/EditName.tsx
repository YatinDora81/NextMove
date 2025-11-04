"use client"
import React, { ReactNode, useEffect, useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from '../ui/input'
import { useAuth, useUser } from '@clerk/nextjs'
import { Label } from '../ui/label'
import { capitalizeWords } from '@/utils/strings'
import { Button } from '../ui/button'
import toast from 'react-hot-toast'
import { UPDATE_USER_DETAILS } from '@/utils/url'

function EditName({ children }: { children: ReactNode }) {
    const { user } = useUser()
    const { getToken } = useAuth()
    const [firstName, setFirstName] = useState('')
    const [lastName, setLastName] = useState('')
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)


    const changeHandler = async () => {
        // First name is required
        if(!user) return;
        if (firstName.trim().length === 0) {
            toast.error("First name is required")
            return
        }

        // Check if name has changed
        const currentFirstName = capitalizeWords(user?.firstName || '')
        const currentLastName = capitalizeWords(user?.lastName || '')
        if (firstName.trim() === currentFirstName && lastName.trim() === currentLastName) {
            toast.error("Name is already same")
            return
        }

        // First name length validation
        if (firstName.trim().length > 50) {
            toast.error("First name is too long")
            return
        }

        // Last name length validation (if provided)
        if (lastName.trim().length > 50) {
            toast.error("Last name is too long")
            return
        }

        setLoading(true)
        try {
            const token = await getToken({ template: "frontend_token" })
            if(!token) {
                toast.error("Token not found")
                setLoading(false)
                return
            }

            const res = await fetch(UPDATE_USER_DETAILS , {
                method: 'POST',
                body: JSON.stringify({
                    "userId": user.id,
                    "firstName": firstName,
                    "lastName" : lastName,
                    "image_url": null
                }),
                headers: {
                    'Content-Type': 'application/json',
                    "Authorization": `Bearer ${token}`,
                },
            })
            
            if(res.ok){
                toast.success("Name updated successfully")
                toast("Please refresh the page to see the changes or will take 1-2 minutes to update.")
                // Reload user data
                await user?.reload()
                // Close dialog
                setOpen(false)
            } else {
                const errorData = await res.json()
                toast.error(errorData.message || "Failed to update name")
            }
        } catch {
            toast.error("Failed to update name")
        } finally {
            setLoading(false)
        }
    }


    useEffect(()=>{
        setFirstName(capitalizeWords(user?.firstName || ''))
        setLastName(capitalizeWords(user?.lastName || ''))
    },[user])

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger className="hover:underline">{children}</DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Change Your Name</DialogTitle>
                </DialogHeader>
                <DialogDescription className="space-y-3 py-5 flex flex-col gap-1">
                    <div className=' flex w-full items-center  gap-3 pb-4'>
                        <div className=' gap-2 w-[48%] flex flex-col'>
                            <Label htmlFor="yourName">First Name</Label>
                            <Input placeholder="Enter Your Name" value={firstName} onChange={(e) => setFirstName(e.target.value)} type="text" disabled={loading} />

                        </div>
                        <div className=' gap-2 w-[48%] flex flex-col'>
                            <Label htmlFor="yourName">Last Name (Optional)</Label>
                            <Input placeholder="Enter Your Name" value={lastName} onChange={(e) => setLastName(e.target.value)} type="text" disabled={loading} />
                        </div>
                    </div>


                    <div className="bg-muted/50 border border-border rounded-lg p-3 text-sm">
                        <span className="font-semibold text-foreground">Note:</span>{" "}
                        <span className="text-muted-foreground">Changing your name will take 1-2 minutes to update.</span>
                    </div>


                    <div className=' flex gap-2 '>
                        <Button className='  w-[48%]' variant={"outline"} size="icon" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
                        <Button className='  w-[48%]' size="icon" onClick={changeHandler} disabled={loading}>
                            {loading ? "Saving..." : "Save"}
                        </Button>
                    </div>

                </DialogDescription>
            </DialogContent>
        </Dialog>
    )
}

export default EditName
