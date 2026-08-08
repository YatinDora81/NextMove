"use client"

import { useCallback } from "react"
import toast from "react-hot-toast"
import { Copy, ExternalLink, MoreHorizontal, PencilLine, StickyNote, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    JOB_APP_STATUSES,
    JobAppStatus,
    JobApplication,
    STATUS_LABEL,
    isJobAppStatus,
    isOpenableUrl,
} from "@/components/applications/types"

export type ApplicationRowActionsProps = {
    row: JobApplication
    onStatusChange: (status: JobAppStatus) => void
    onEdit: () => void
    onAddNote: () => void
    onDelete: () => void

    compact?: boolean
}

export function ApplicationRowActions({
    row,
    onStatusChange,
    onEdit,
    onAddNote,
    onDelete,
    compact = false,
}: ApplicationRowActionsProps) {
    const canOpen = isOpenableUrl(row.url)

    const copyLink = useCallback(() => {
        const url = row.url
        if (url === null) return
        const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
        if (clipboard === undefined) {
            toast.error("This browser blocked clipboard access.")
            return
        }
        clipboard.writeText(url).then(
            () => toast.success("Posting link copied."),
            () => toast.error("Could not copy the link."),
        )
    }, [row.url])

    const openPosting = useCallback(() => {
        const url = row.url
        if (url === null || typeof window === "undefined") return
        window.open(url, "_blank", "noopener,noreferrer")
    }, [row.url])

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        "inline-flex items-center justify-center rounded-lg text-fg2 transition-colors hover:bg-well hover:text-fg",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc",
                        compact ? "h-7 w-7" : "h-8 w-8",
                    )}
                    aria-label={`Actions for ${row.role} at ${row.company}`}
                >
                    <MoreHorizontal className="h-4 w-4" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="truncate">{row.company}</DropdownMenuLabel>
                <DropdownMenuSeparator />

                <DropdownMenuItem disabled={!canOpen} onSelect={openPosting}>
                    <ExternalLink className="h-4 w-4" />
                    Open posting
                </DropdownMenuItem>
                <DropdownMenuItem disabled={row.url === null} onSelect={copyLink}>
                    <Copy className="h-4 w-4" />
                    Copy link
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        <DropdownMenuRadioGroup
                            value={row.status}
                            onValueChange={(value) => {
                                if (isJobAppStatus(value) && value !== row.status) onStatusChange(value)
                            }}
                        >
                            {JOB_APP_STATUSES.map((status) => (
                                <DropdownMenuRadioItem key={status} value={status}>
                                    {STATUS_LABEL[status]}
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>

                <DropdownMenuItem onSelect={onEdit}>
                    <PencilLine className="h-4 w-4" />
                    Edit company / role
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onAddNote}>
                    <StickyNote className="h-4 w-4" />
                    {row.notes === null || row.notes === "" ? "Add note" : "Edit note"}
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                    <Trash2 className="h-4 w-4" />
                    Delete
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export default ApplicationRowActions
