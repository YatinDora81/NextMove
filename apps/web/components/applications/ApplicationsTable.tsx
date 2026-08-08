"use client"

/**
 * JF-001 SEC 6.7 table view, ported to the web.
 *
 * Sortable columns: Company · Role · Status · ATS · Applied date · Fill score · Link · Notes.
 * Sorting is client-side over the rows already loaded — the list route is cursor-paginated,
 * so "sort" means "sort what you are looking at", which is what the loaded-count line under
 * the filters says.
 */

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, StickyNote } from "lucide-react"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import ApplicationRowActions from "@/components/applications/ApplicationRowActions"
import StatusBadge from "@/components/applications/StatusBadge"
import {
    JOB_APP_STATUSES,
    JobAppStatus,
    JobApplication,
    appliedAtMs,
    fillScorePct,
    formatAts,
    formatDate,
    safeHostname,
} from "@/components/applications/types"

export type SortField = "company" | "role" | "status" | "ats" | "appliedAt" | "fillScore"
export type SortDirection = "asc" | "desc"
export type TableSort = { field: SortField; direction: SortDirection }

export const DEFAULT_TABLE_SORT: TableSort = { field: "appliedAt", direction: "desc" }

const STATUS_ORDER: Record<JobAppStatus, number> = JOB_APP_STATUSES.reduce(
    (acc, status, index) => {
        acc[status] = index
        return acc
    },
    {} as Record<JobAppStatus, number>,
)

function compareStrings(a: string, b: string): number {
    return a.localeCompare(b, undefined, { sensitivity: "base" })
}

/** `null` sorts last in both directions — an unknown value is never "the smallest". */
function compareNullableNumbers(a: number | null, b: number | null, direction: SortDirection): number {
    if (a === null && b === null) return 0
    if (a === null) return 1
    if (b === null) return -1
    return direction === "asc" ? a - b : b - a
}

export function sortApplications(
    rows: readonly JobApplication[],
    sort: TableSort,
): JobApplication[] {
    const factor = sort.direction === "asc" ? 1 : -1
    return [...rows].sort((left, right) => {
        switch (sort.field) {
            case "company":
                return factor * compareStrings(left.company, right.company)
            case "role":
                return factor * compareStrings(left.role, right.role)
            case "status":
                return factor * (STATUS_ORDER[left.status] - STATUS_ORDER[right.status])
            case "ats":
                return factor * compareStrings(formatAts(left.ats), formatAts(right.ats))
            case "appliedAt":
                return compareNullableNumbers(appliedAtMs(left), appliedAtMs(right), sort.direction)
            case "fillScore":
                return compareNullableNumbers(fillScorePct(left), fillScorePct(right), sort.direction)
            default:
                return 0
        }
    })
}

function SortableHead({
    field,
    label,
    sort,
    onSort,
    className,
}: {
    field: SortField
    label: string
    sort: TableSort
    onSort: (field: SortField) => void
    className?: string
}) {
    const isActive = sort.field === field
    const Icon = !isActive ? ArrowUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown

    return (
        <TableHead className={className}>
            <button
                type="button"
                onClick={() => onSort(field)}
                aria-label={`Sort by ${label}`}
                aria-sort={isActive ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                className="inline-flex items-center gap-1.5 rounded-sm text-left font-medium transition-colors hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:hover:text-zinc-50"
            >
                {label}
                <Icon className={cn("h-3.5 w-3.5", isActive ? "opacity-90" : "opacity-40")} />
            </button>
        </TableHead>
    )
}

function FillScoreCell({ row }: { row: JobApplication }) {
    const score = fillScorePct(row)
    if (score === null || row.fillStats === null) {
        return <span className="text-zinc-400">—</span>
    }
    // Colour follows the SEC 6.3 / INV-4 thresholds the fill engine itself uses.
    const tone =
        score >= 70
            ? "bg-emerald-500"
            : score >= 50
              ? "bg-amber-500"
              : "bg-rose-500"
    return (
        <div className="flex items-center gap-2" title={`${row.fillStats.filled} of ${row.fillStats.total} fields filled`}>
            <div className="h-1.5 w-12 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div className={cn("h-full rounded-full", tone)} style={{ width: `${score}%` }} />
            </div>
            <span className="tabular-nums text-xs text-zinc-600 dark:text-zinc-400">{score}%</span>
        </div>
    )
}

export type ApplicationsTableProps = {
    rows: readonly JobApplication[]
    onStatusChange: (row: JobApplication, status: JobAppStatus) => void
    onEdit: (row: JobApplication) => void
    onAddNote: (row: JobApplication) => void
    onDelete: (row: JobApplication) => void
}

export function ApplicationsTable({
    rows,
    onStatusChange,
    onEdit,
    onAddNote,
    onDelete,
}: ApplicationsTableProps) {
    const [sort, setSort] = useState<TableSort>(DEFAULT_TABLE_SORT)

    const sorted = useMemo(() => sortApplications(rows, sort), [rows, sort])

    const toggleSort = (field: SortField) => {
        setSort((current) =>
            current.field === field
                ? { field, direction: current.direction === "asc" ? "desc" : "asc" }
                : { field, direction: field === "appliedAt" || field === "fillScore" ? "desc" : "asc" },
        )
    }

    return (
        <div className="w-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <Table>
                <TableHeader className="bg-zinc-50 dark:bg-zinc-900/60">
                    <TableRow>
                        <SortableHead field="company" label="Company" sort={sort} onSort={toggleSort} className="pl-4" />
                        <SortableHead field="role" label="Role" sort={sort} onSort={toggleSort} />
                        <SortableHead field="status" label="Status" sort={sort} onSort={toggleSort} />
                        <SortableHead field="ats" label="ATS" sort={sort} onSort={toggleSort} />
                        <SortableHead field="appliedAt" label="Applied" sort={sort} onSort={toggleSort} />
                        <SortableHead field="fillScore" label="Fill score" sort={sort} onSort={toggleSort} />
                        <TableHead>Link</TableHead>
                        <TableHead className="min-w-[12rem]">Notes</TableHead>
                        <TableHead className="w-[3rem] pr-4 text-right">
                            <span className="sr-only">Actions</span>
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {sorted.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={9} className="py-10 text-center text-sm text-zinc-500">
                                No applications match these filters.
                            </TableCell>
                        </TableRow>
                    ) : (
                        sorted.map((row) => {
                            const host = safeHostname(row.url)
                            return (
                                <TableRow key={row.clientId}>
                                    <TableCell className="pl-4 font-medium">{row.company}</TableCell>
                                    <TableCell className="max-w-[16rem] truncate" title={row.role}>
                                        {row.role}
                                    </TableCell>
                                    <TableCell>
                                        <StatusBadge status={row.status} />
                                    </TableCell>
                                    <TableCell className="text-zinc-600 dark:text-zinc-400">
                                        {formatAts(row.ats)}
                                    </TableCell>
                                    <TableCell className="tabular-nums text-zinc-600 dark:text-zinc-400">
                                        {formatDate(row.appliedAt)}
                                    </TableCell>
                                    <TableCell>
                                        <FillScoreCell row={row} />
                                    </TableCell>
                                    <TableCell>
                                        {host === null || row.url === null ? (
                                            <span className="text-zinc-400">—</span>
                                        ) : (
                                            <a
                                                href={row.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex max-w-[12rem] items-center gap-1 truncate text-blue-600 hover:underline dark:text-blue-400"
                                                title={row.url}
                                            >
                                                <span className="truncate">{host}</span>
                                                <ExternalLink className="h-3 w-3 shrink-0" />
                                            </a>
                                        )}
                                    </TableCell>
                                    <TableCell className="max-w-[18rem]">
                                        {row.notes === null || row.notes.trim() === "" ? (
                                            <button
                                                type="button"
                                                onClick={() => onAddNote(row)}
                                                className="inline-flex items-center gap-1 rounded-sm text-xs text-zinc-400 transition-colors hover:text-zinc-700 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:hover:text-zinc-200"
                                            >
                                                <StickyNote className="h-3 w-3" />
                                                Add note
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => onAddNote(row)}
                                                title={row.notes}
                                                className="block w-full truncate rounded-sm text-left text-sm text-zinc-600 transition-colors hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:text-zinc-400 dark:hover:text-zinc-100"
                                            >
                                                {row.notes}
                                            </button>
                                        )}
                                    </TableCell>
                                    <TableCell className="pr-4 text-right">
                                        <ApplicationRowActions
                                            row={row}
                                            onStatusChange={(status) => onStatusChange(row, status)}
                                            onEdit={() => onEdit(row)}
                                            onAddNote={() => onAddNote(row)}
                                            onDelete={() => onDelete(row)}
                                        />
                                    </TableCell>
                                </TableRow>
                            )
                        })
                    )}
                </TableBody>
            </Table>
        </div>
    )
}

export default ApplicationsTable
