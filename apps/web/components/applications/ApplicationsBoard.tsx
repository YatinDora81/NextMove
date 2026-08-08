"use client"

/**
 * JF-001 SEC 6.7 board view: kanban lanes `draft → applied → interview → offer /
 * rejected / ghosted`, where dragging a card between lanes appends to `history[]` with a
 * timestamp. The append itself lives in the hook (`setStatus`), so the drag here and the
 * "Move to" menu in the table produce identical audit trails.
 *
 * Drag uses the native HTML5 API — no new dependency (SPINE §3). Because native drag is
 * not keyboard-accessible, every card also carries the same "Move to" menu, so the board
 * is fully operable without a pointer.
 */

import { useMemo, useState, type DragEvent } from "react"
import { ExternalLink, GripVertical } from "lucide-react"
import { cn } from "@/lib/utils"
import ApplicationRowActions from "@/components/applications/ApplicationRowActions"
import {
    BOARD_LANES,
    JobAppStatus,
    JobApplication,
    STATUS_ACCENT,
    STATUS_LABEL,
    appliedAtMs,
    fillScorePct,
    formatAts,
    formatDate,
    safeHostname,
} from "@/components/applications/types"

const DRAG_MIME = "application/x-nextmove-job-application"

export type ApplicationsBoardProps = {
    rows: readonly JobApplication[]
    onStatusChange: (row: JobApplication, status: JobAppStatus) => void
    onEdit: (row: JobApplication) => void
    onAddNote: (row: JobApplication) => void
    onDelete: (row: JobApplication) => void
}

function groupByLane(rows: readonly JobApplication[]): Record<JobAppStatus, JobApplication[]> {
    const lanes: Record<JobAppStatus, JobApplication[]> = {
        DRAFT: [],
        APPLIED: [],
        INTERVIEW: [],
        OFFER: [],
        REJECTED: [],
        GHOSTED: [],
    }
    for (const row of rows) {
        lanes[row.status].push(row)
    }
    for (const lane of BOARD_LANES) {
        // Newest activity first inside a lane.
        lanes[lane].sort((left, right) => (appliedAtMs(right) ?? 0) - (appliedAtMs(left) ?? 0))
    }
    return lanes
}

function BoardCard({
    row,
    onStatusChange,
    onEdit,
    onAddNote,
    onDelete,
    onDragStart,
    onDragEnd,
    isDragging,
}: {
    row: JobApplication
    onStatusChange: (status: JobAppStatus) => void
    onEdit: () => void
    onAddNote: () => void
    onDelete: () => void
    onDragStart: (event: DragEvent<HTMLDivElement>) => void
    onDragEnd: () => void
    isDragging: boolean
}) {
    const host = safeHostname(row.url)
    const score = fillScorePct(row)

    return (
        <div
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            aria-roledescription="Draggable application card"
            className={cn(
                "group flex cursor-grab flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm transition-opacity active:cursor-grabbing dark:border-zinc-800 dark:bg-zinc-900",
                isDragging && "opacity-40",
            )}
        >
            <div className="flex items-start justify-between gap-1">
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold" title={row.company}>
                        {row.company}
                    </div>
                    <div className="truncate text-xs text-zinc-600 dark:text-zinc-400" title={row.role}>
                        {row.role}
                    </div>
                </div>
                <div className="flex shrink-0 items-center">
                    <GripVertical
                        className="h-4 w-4 text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-zinc-700"
                        aria-hidden="true"
                    />
                    <ApplicationRowActions
                        row={row}
                        compact
                        onStatusChange={onStatusChange}
                        onEdit={onEdit}
                        onAddNote={onAddNote}
                        onDelete={onDelete}
                    />
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-500">
                <span>{formatAts(row.ats)}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{formatDate(row.appliedAt)}</span>
                {score !== null && (
                    <>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{score}% filled</span>
                    </>
                )}
            </div>

            {row.notes !== null && row.notes.trim() !== "" && (
                <p className="line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">{row.notes}</p>
            )}

            {host !== null && row.url !== null && (
                <a
                    href={row.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 truncate text-[11px] text-blue-600 hover:underline dark:text-blue-400"
                >
                    <span className="truncate">{host}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
            )}
        </div>
    )
}

export function ApplicationsBoard({
    rows,
    onStatusChange,
    onEdit,
    onAddNote,
    onDelete,
}: ApplicationsBoardProps) {
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const [hoverLane, setHoverLane] = useState<JobAppStatus | null>(null)

    const lanes = useMemo(() => groupByLane(rows), [rows])

    const handleDrop = (lane: JobAppStatus, event: DragEvent<HTMLDivElement>) => {
        event.preventDefault()
        setHoverLane(null)
        setDraggingId(null)
        const clientId = event.dataTransfer.getData(DRAG_MIME)
        if (clientId === "") return
        const row = rows.find((candidate) => candidate.clientId === clientId)
        if (row === undefined || row.status === lane) return
        onStatusChange(row, lane)
    }

    return (
        <div className="w-full overflow-x-auto pb-2">
            <div className="flex min-w-max gap-3">
                {BOARD_LANES.map((lane) => {
                    const laneRows = lanes[lane]
                    const isHovered = hoverLane === lane
                    return (
                        <div
                            key={lane}
                            onDragOver={(event) => {
                                event.preventDefault()
                                event.dataTransfer.dropEffect = "move"
                                if (hoverLane !== lane) setHoverLane(lane)
                            }}
                            onDragLeave={(event) => {
                                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                    setHoverLane((current) => (current === lane ? null : current))
                                }
                            }}
                            onDrop={(event) => handleDrop(lane, event)}
                            className={cn(
                                "flex w-[17rem] shrink-0 flex-col gap-3 rounded-xl border p-3 transition-colors",
                                isHovered
                                    ? "border-blue-400 bg-blue-50/70 dark:border-blue-700 dark:bg-blue-950/30"
                                    : "border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-900/40",
                            )}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <span
                                        className={cn("h-2 w-2 rounded-full", STATUS_ACCENT[lane])}
                                        aria-hidden="true"
                                    />
                                    <span className="text-sm font-semibold">{STATUS_LABEL[lane]}</span>
                                </div>
                                <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] tabular-nums text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                                    {laneRows.length}
                                </span>
                            </div>

                            <div className="flex min-h-[6rem] flex-col gap-2">
                                {laneRows.length === 0 ? (
                                    <p className="px-1 py-6 text-center text-xs text-zinc-400 dark:text-zinc-600">
                                        Drop a card here to move it to {STATUS_LABEL[lane].toLowerCase()}.
                                    </p>
                                ) : (
                                    laneRows.map((row) => (
                                        <BoardCard
                                            key={row.clientId}
                                            row={row}
                                            isDragging={draggingId === row.clientId}
                                            onDragStart={(event) => {
                                                event.dataTransfer.setData(DRAG_MIME, row.clientId)
                                                event.dataTransfer.effectAllowed = "move"
                                                setDraggingId(row.clientId)
                                            }}
                                            onDragEnd={() => {
                                                setDraggingId(null)
                                                setHoverLane(null)
                                            }}
                                            onStatusChange={(status) => onStatusChange(row, status)}
                                            onEdit={() => onEdit(row)}
                                            onAddNote={() => onAddNote(row)}
                                            onDelete={() => onDelete(row)}
                                        />
                                    ))
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

export default ApplicationsBoard
