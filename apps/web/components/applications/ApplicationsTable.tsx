"use client"

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
import { Card } from "@/components/quiet/Card"
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
    formatDayLabel,
    safeHostname,
} from "@/components/applications/types"

export type SortField = "company" | "role" | "status" | "ats" | "appliedAt" | "fillScore"
export type SortDirection = "asc" | "desc"
export type TableSort = { field: SortField; direction: SortDirection }

export const DEFAULT_TABLE_SORT: TableSort = { field: "appliedAt", direction: "desc" }

const HEAD_CLASS = "h-auto px-3.5 py-2.5 text-xs font-medium text-fg3"
const CELL_CLASS = "px-3.5 py-3 text-[13.5px] text-fg"

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
        <TableHead className={cn(HEAD_CLASS, className)}>
            <button
                type="button"
                onClick={() => onSort(field)}
                aria-label={`Sort by ${label}`}
                aria-sort={isActive ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                className="inline-flex items-center gap-1.5 rounded-sm text-left font-medium transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
            >
                {label}
                <Icon className={cn("h-3 w-3", isActive ? "opacity-90" : "opacity-40")} />
            </button>
        </TableHead>
    )
}

function FillScoreCell({ row }: { row: JobApplication }) {
    const score = fillScorePct(row)
    if (score === null || row.fillStats === null) {
        return <span className="text-fg3">—</span>
    }
    return (
        <span
            className="tnum text-[13px] text-fg2"
            title={`${row.fillStats.filled} of ${row.fillStats.total} fields filled`}
        >
            {score}%
        </span>
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
        <Card className="w-full overflow-hidden">
            <Table className="min-w-[900px]">
                <TableHeader>
                    <TableRow className="border-hair hover:bg-transparent">
                        <SortableHead field="company" label="Company" sort={sort} onSort={toggleSort} />
                        <SortableHead field="role" label="Role" sort={sort} onSort={toggleSort} />
                        <SortableHead field="status" label="Status" sort={sort} onSort={toggleSort} />
                        <SortableHead field="ats" label="ATS" sort={sort} onSort={toggleSort} />
                        <SortableHead field="appliedAt" label="Applied" sort={sort} onSort={toggleSort} />
                        <SortableHead field="fillScore" label="Fill score" sort={sort} onSort={toggleSort} />
                        <TableHead className={HEAD_CLASS}>Link</TableHead>
                        <TableHead className={cn(HEAD_CLASS, "min-w-[12rem]")}>Notes</TableHead>
                        <TableHead className={cn(HEAD_CLASS, "w-[3rem] text-right")}>
                            <span className="sr-only">Actions</span>
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {sorted.length === 0 ? (
                        <TableRow className="border-hair hover:bg-transparent">
                            <TableCell colSpan={9} className="py-10 text-center text-[13.5px] text-fg2">
                                No applications match these filters.
                            </TableCell>
                        </TableRow>
                    ) : (
                        sorted.map((row) => {
                            const host = safeHostname(row.url)
                            return (
                                <TableRow key={row.clientId} className="border-hair hover:bg-well">
                                    <TableCell className={cn(CELL_CLASS, "font-semibold")}>{row.company}</TableCell>
                                    <TableCell className={cn(CELL_CLASS, "max-w-[16rem] truncate")} title={row.role}>
                                        {row.role}
                                    </TableCell>
                                    <TableCell className={CELL_CLASS}>
                                        <StatusBadge status={row.status} />
                                    </TableCell>
                                    <TableCell className={cn(CELL_CLASS, "text-[13px] text-fg2")}>
                                        {formatAts(row.ats)}
                                    </TableCell>
                                    <TableCell
                                        className={cn(CELL_CLASS, "tnum text-[13px] text-fg2")}
                                        title={formatDate(row.appliedAt)}
                                    >
                                        {formatDayLabel(row.appliedAt)}
                                    </TableCell>
                                    <TableCell className={CELL_CLASS}>
                                        <FillScoreCell row={row} />
                                    </TableCell>
                                    <TableCell className={CELL_CLASS}>
                                        {host === null || row.url === null ? (
                                            <span className="text-fg3">—</span>
                                        ) : (
                                            <a
                                                href={row.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex max-w-[12rem] items-center gap-1 truncate text-[13px] text-fg2 underline-offset-2 transition-colors hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
                                                title={row.url}
                                            >
                                                <span className="truncate">{host}</span>
                                                <ExternalLink className="h-3 w-3 shrink-0" />
                                            </a>
                                        )}
                                    </TableCell>
                                    <TableCell className={cn(CELL_CLASS, "max-w-[18rem]")}>
                                        {row.notes === null || row.notes.trim() === "" ? (
                                            <button
                                                type="button"
                                                onClick={() => onAddNote(row)}
                                                className="inline-flex items-center gap-1 rounded-sm text-xs text-fg3 transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
                                            >
                                                <StickyNote className="h-3 w-3" />
                                                Add note
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => onAddNote(row)}
                                                title={row.notes}
                                                className="block w-full truncate rounded-sm text-left text-[13px] text-fg2 transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
                                            >
                                                {row.notes}
                                            </button>
                                        )}
                                    </TableCell>
                                    <TableCell className={cn(CELL_CLASS, "text-right")}>
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
        </Card>
    )
}

export default ApplicationsTable
