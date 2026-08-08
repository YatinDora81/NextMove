"use client"

import { useEffect, useState } from "react"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/quiet/Button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input, Textarea } from "@/components/quiet/Field"
import { Label } from "@/components/ui/label"
import { JobApplication, JobApplicationDetailsPatch } from "@/components/applications/types"

export function EditApplicationDialog({
    row,
    open,
    isSaving,
    onOpenChange,
    onSave,
}: {
    row: JobApplication | null
    open: boolean
    isSaving: boolean
    onOpenChange: (open: boolean) => void
    onSave: (details: JobApplicationDetailsPatch) => void
}) {
    const [company, setCompany] = useState("")
    const [role, setRole] = useState("")
    const [url, setUrl] = useState("")
    const [ats, setAts] = useState("")

    useEffect(() => {
        if (!open || row === null) return
        setCompany(row.company)
        setRole(row.role)
        setUrl(row.url ?? "")
        setAts(row.ats ?? "")
    }, [open, row])

    const trimmedCompany = company.trim()
    const trimmedRole = role.trim()
    const canSave = trimmedCompany !== "" && trimmedRole !== "" && !isSaving

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-[17px] font-semibold tracking-[-0.015em] text-fg">Edit application</DialogTitle>
                    <DialogDescription className="text-[13px] text-fg2">
                        Company and role are auto-captured from the posting and stay editable (SEC 6.7).
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="application-company" className="text-[13px] font-medium text-fg">Company</Label>
                        <Input
                            id="application-company"
                            value={company}
                            onChange={(event) => setCompany(event.target.value)}
                            placeholder="Acme"
                            autoComplete="off"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="application-role" className="text-[13px] font-medium text-fg">Role</Label>
                        <Input
                            id="application-role"
                            value={role}
                            onChange={(event) => setRole(event.target.value)}
                            placeholder="Frontend Engineer"
                            autoComplete="off"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="application-url" className="text-[13px] font-medium text-fg">Posting link</Label>
                        <Input
                            id="application-url"
                            value={url}
                            onChange={(event) => setUrl(event.target.value)}
                            placeholder="https://boards.greenhouse.io/…"
                            inputMode="url"
                            autoComplete="off"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="application-ats" className="text-[13px] font-medium text-fg">ATS</Label>
                        <Input
                            id="application-ats"
                            value={ats}
                            onChange={(event) => setAts(event.target.value)}
                            placeholder="greenhouse"
                            autoComplete="off"
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="sec" onClick={() => onOpenChange(false)} disabled={isSaving}>
                        Cancel
                    </Button>
                    <Button
                        variant="acc"
                        disabled={!canSave}
                        onClick={() =>
                            onSave({
                                company: trimmedCompany,
                                role: trimmedRole,
                                url: url.trim() === "" ? null : url.trim(),
                                ats: ats.trim() === "" ? null : ats.trim().toLowerCase(),
                            })
                        }
                    >
                        {isSaving ? "Saving…" : "Save changes"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export function NoteDialog({
    row,
    open,
    isSaving,
    onOpenChange,
    onSave,
}: {
    row: JobApplication | null
    open: boolean
    isSaving: boolean
    onOpenChange: (open: boolean) => void
    onSave: (notes: string) => void
}) {
    const [notes, setNotes] = useState("")

    useEffect(() => {
        if (!open || row === null) return
        setNotes(row.notes ?? "")
    }, [open, row])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-[17px] font-semibold tracking-[-0.015em] text-fg">Note</DialogTitle>
                    <DialogDescription className="text-[13px] text-fg2">
                        {row === null ? "" : `${row.role} at ${row.company}`}
                    </DialogDescription>
                </DialogHeader>

                <Textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Recruiter name, referral, salary discussed, follow-up date…"
                    rows={6}
                    aria-label="Application note"
                    className="resize-none"
                />

                <DialogFooter>
                    <Button variant="sec" onClick={() => onOpenChange(false)} disabled={isSaving}>
                        Cancel
                    </Button>
                    <Button variant="acc" disabled={isSaving} onClick={() => onSave(notes)}>
                        {isSaving ? "Saving…" : "Save note"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export function DeleteApplicationDialog({
    row,
    open,
    isDeleting,
    onOpenChange,
    onConfirm,
}: {
    row: JobApplication | null
    open: boolean
    isDeleting: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void
}) {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-[17px] font-semibold tracking-[-0.015em] text-fg">Delete this application?</AlertDialogTitle>
                    <AlertDialogDescription className="text-[13px] text-fg2">
                        {row === null
                            ? "This removes the tracked row from your account."
                            : `“${row.role}” at ${row.company} will be removed from your synced tracker. The copy stored inside the extension on this device is not affected.`}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel
                        disabled={isDeleting}
                        className="rounded-lg border-hair2 bg-surface text-[13.5px] text-fg shadow-qsm hover:bg-well"
                    >
                        Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                        disabled={isDeleting}
                        onClick={onConfirm}
                        className="rounded-lg border border-dan/40 bg-danbg text-[13.5px] text-dan shadow-none hover:bg-dan/15"
                    >
                        {isDeleting ? "Deleting…" : "Delete"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
