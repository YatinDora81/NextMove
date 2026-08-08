"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Download, KanbanSquare, RefreshCw, Rows3 } from "lucide-react"
import { Button } from "@/components/quiet/Button"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/useAuth"
import { DEVICES } from "@/utils/url"
import { useJobApplications, isDefaultFilters } from "@/hooks/useJobApplications"
import ApplicationsBoard from "@/components/applications/ApplicationsBoard"
import ApplicationsFilters from "@/components/applications/ApplicationsFilters"
import ApplicationsStats from "@/components/applications/ApplicationsStats"
import ApplicationsTable from "@/components/applications/ApplicationsTable"
import PairDeviceEmptyState from "@/components/applications/PairDeviceEmptyState"
import {
    DeleteApplicationDialog,
    EditApplicationDialog,
    NoteDialog,
} from "@/components/applications/ApplicationDialogs"
import { computeApplicationStats } from "@/components/applications/stats"
import {
    JobAppStatus,
    JobApplication,
    JobApplicationDetailsPatch,
    formatTimeAgo,
} from "@/components/applications/types"

type BoardOrTable = "table" | "board"
type DialogKind = "edit" | "note" | "delete" | null

type DeviceState = { count: number } | null

function lastSyncedAt(rows: readonly JobApplication[]): string | null {
    let bestIso: string | null = null
    let bestMs = Number.NEGATIVE_INFINITY
    for (const row of rows) {
        if (row.updatedAt === null) continue
        const parsed = Date.parse(row.updatedAt)
        if (Number.isNaN(parsed) || parsed <= bestMs) continue
        bestMs = parsed
        bestIso = row.updatedAt
    }
    return bestIso
}

export function ApplicationsDashboard() {
    const { getToken, isSignedIn, isLoaded } = useAuth()
    const {
        applications,
        allApplications,
        isLoading,
        isLoadingMore,
        isMutating,
        hasLoaded,
        error,
        hasMore,
        filters,
        setFilters,
        resetFilters,
        atsOptions,
        refresh,
        loadMore,
        setStatus,
        updateDetails,
        updateNotes,
        deleteApplication,
        exportCsv,
    } = useJobApplications()

    const [view, setView] = useState<BoardOrTable>("table")
    const [devices, setDevices] = useState<DeviceState>(null)
    const [devicesLoaded, setDevicesLoaded] = useState(false)
    const [activeRow, setActiveRow] = useState<JobApplication | null>(null)
    const [dialog, setDialog] = useState<DialogKind>(null)

    useEffect(() => {
        if (!isLoaded) return
        if (!isSignedIn) {
            setDevices(null)
            setDevicesLoaded(true)
            return
        }
        let cancelled = false

        const run = async () => {
            try {
                const token = await getToken()
                if (!token) return
                const res = await fetch(DEVICES, {
                    method: "GET",
                    headers: { Authorization: `Bearer ${token}` },
                    cache: "no-store",
                })
                const payload: unknown = await res.json().catch(() => null)
                if (cancelled) return
                if (!res.ok || typeof payload !== "object" || payload === null) {
                    setDevices(null)
                    return
                }
                const data = (payload as Record<string, unknown>).data
                setDevices(Array.isArray(data) ? { count: data.length } : null)
            } catch {
                if (!cancelled) setDevices(null)
            } finally {
                if (!cancelled) setDevicesLoaded(true)
            }
        }

        void run()
        return () => {
            cancelled = true
        }
    }, [getToken, isLoaded, isSignedIn])

    const stats = useMemo(() => computeApplicationStats(applications), [applications])
    const syncedLabel = useMemo(() => formatTimeAgo(lastSyncedAt(allApplications)), [allApplications])

    const closeDialog = useCallback(() => {
        setDialog(null)
    }, [])

    const openDialog = useCallback((kind: Exclude<DialogKind, null>, row: JobApplication) => {
        setActiveRow(row)
        setDialog(kind)
    }, [])

    const handleStatusChange = useCallback(
        (row: JobApplication, status: JobAppStatus) => {
            void setStatus(row.clientId, status)
        },
        [setStatus],
    )

    const handleSaveDetails = useCallback(
        (details: JobApplicationDetailsPatch) => {
            const row = activeRow
            if (row === null) return
            void updateDetails(row.clientId, details).then((ok) => {
                if (ok) closeDialog()
            })
        },
        [activeRow, closeDialog, updateDetails],
    )

    const handleSaveNote = useCallback(
        (notes: string) => {
            const row = activeRow
            if (row === null) return
            void updateNotes(row.clientId, notes).then((ok) => {
                if (ok) closeDialog()
            })
        },
        [activeRow, closeDialog, updateNotes],
    )

    const handleConfirmDelete = useCallback(() => {
        const row = activeRow
        if (row === null) return
        void deleteApplication(row.clientId).then((ok) => {
            if (ok) closeDialog()
        })
    }, [activeRow, closeDialog, deleteApplication])

    const isEmpty =
        hasLoaded && error === null && allApplications.length === 0 && isDefaultFilters(filters)

    const showSkeleton = (!hasLoaded && isLoading) || (isEmpty && !devicesLoaded)
    const hasPairedDevice = devices !== null && devices.count > 0

    const viewProps = {
        rows: applications,
        onStatusChange: handleStatusChange,
        onEdit: (row: JobApplication) => openDialog("edit", row),
        onAddNote: (row: JobApplication) => openDialog("note", row),
        onDelete: (row: JobApplication) => openDialog("delete", row),
    }

    return (
        <div className="flex w-full flex-col gap-4">
            {error !== null && (
                <div className="flex items-start gap-2 rounded-xl border border-dan/40 bg-danbg px-4 py-3 text-[13.5px] text-dan">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <div className="flex flex-col gap-2">
                        <span>{error}</span>
                        <Button variant="sec" onClick={() => void refresh()} className="w-fit px-3 py-1.5 text-[13px]">
                            Try again
                        </Button>
                    </div>
                </div>
            )}

            {showSkeleton ? (
                <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
                    <div className="h-4 w-64 max-w-full animate-pulse rounded-md bg-well" />
                    <div className="h-64 animate-pulse rounded-xl bg-well" />
                    <span className="sr-only">Loading your applications…</span>
                </div>
            ) : isEmpty ? (
                <PairDeviceEmptyState
                    hasPairedDevice={hasPairedDevice}
                    onRefresh={() => void refresh()}
                    isRefreshing={isLoading}
                />
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <ApplicationsStats stats={stats} className="min-w-0" />
                        {syncedLabel !== null && (
                            <span className="ml-auto flex items-center gap-1.5 text-[12.5px] whitespace-nowrap text-fg2">
                                <span className="size-1.5 rounded-full bg-ok" aria-hidden="true" />
                                Synced {syncedLabel}
                            </span>
                        )}
                    </div>

                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex-1">
                            <ApplicationsFilters
                                filters={filters}
                                onChange={setFilters}
                                onReset={resetFilters}
                                atsOptions={atsOptions}
                                shownCount={applications.length}
                                totalCount={allApplications.length}
                            />
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                            <div
                                className="inline-flex gap-0.5 rounded-[9px] bg-well p-[3px]"
                                role="group"
                                aria-label="Switch view"
                            >
                                <button
                                    type="button"
                                    onClick={() => setView("table")}
                                    aria-pressed={view === "table"}
                                    className={cn(
                                        "inline-flex items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc",
                                        view === "table"
                                            ? "bg-surface text-fg shadow-qsm"
                                            : "text-fg2 hover:text-fg",
                                    )}
                                >
                                    <Rows3 className="h-3.5 w-3.5" />
                                    Table
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setView("board")}
                                    aria-pressed={view === "board"}
                                    className={cn(
                                        "inline-flex items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc",
                                        view === "board"
                                            ? "bg-surface text-fg shadow-qsm"
                                            : "text-fg2 hover:text-fg",
                                    )}
                                >
                                    <KanbanSquare className="h-3.5 w-3.5" />
                                    Board
                                </button>
                            </div>

                            <Button
                                variant="sec"
                                onClick={() => void refresh()}
                                disabled={isLoading}
                                className="px-3 py-1.5 text-[13px]"
                            >
                                <RefreshCw className={isLoading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                                Refresh
                            </Button>

                            <Button variant="acc" onClick={() => exportCsv()} className="px-3 py-1.5 text-[13px]">
                                <Download className="h-3.5 w-3.5" />
                                Export CSV
                            </Button>
                        </div>
                    </div>

                    {view === "table" ? (
                        <ApplicationsTable {...viewProps} />
                    ) : (
                        <ApplicationsBoard {...viewProps} />
                    )}

                    {hasMore && (
                        <div className="flex justify-center">
                            <Button variant="sec" onClick={() => void loadMore()} disabled={isLoadingMore}>
                                {isLoadingMore ? "Loading…" : "Load more"}
                            </Button>
                        </div>
                    )}
                </>
            )}

            <EditApplicationDialog
                row={activeRow}
                open={dialog === "edit"}
                isSaving={isMutating}
                onOpenChange={(next) => {
                    if (!next) closeDialog()
                }}
                onSave={handleSaveDetails}
            />
            <NoteDialog
                row={activeRow}
                open={dialog === "note"}
                isSaving={isMutating}
                onOpenChange={(next) => {
                    if (!next) closeDialog()
                }}
                onSave={handleSaveNote}
            />
            <DeleteApplicationDialog
                row={activeRow}
                open={dialog === "delete"}
                isDeleting={isMutating}
                onOpenChange={(next) => {
                    if (!next) closeDialog()
                }}
                onConfirm={handleConfirmDelete}
            />
        </div>
    )
}

export default ApplicationsDashboard
