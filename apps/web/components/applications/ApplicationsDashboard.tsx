"use client"

/**
 * JF-001 SEC 8.5 — the "Applications" half of the unified Applied dashboard: the SEC 6.7
 * tracker ported to the web. Stats strip · filters · table ⇄ kanban · row actions · CSV.
 *
 * These rows come from `GET /api/job-applications`, i.e. what the extension chose to log.
 * The device list is read only to decide which empty state is honest — a user with no
 * paired device needs the pairing story (SEC 8.2), not "0 results".
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Download, KanbanSquare, RefreshCw, Rows3 } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { JobAppStatus, JobApplication, JobApplicationDetailsPatch } from "@/components/applications/types"

type BoardOrTable = "table" | "board"
type DialogKind = "edit" | "note" | "delete" | null

/** `null` = we could not find out (API down); the UI then avoids claiming "no devices". */
type DeviceState = { count: number } | null

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

    // Device count drives the empty state only — never gates the table.
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

    // A failed list call must not be reported as "you have no applications" — the error
    // banner owns that case, and the dashboard chrome stays up so Retry is reachable.
    const isEmpty =
        hasLoaded && error === null && allApplications.length === 0 && isDefaultFilters(filters)
    // Hold the skeleton until the device lookup settles, so the empty state cannot flash the
    // wrong story (pair-your-extension vs. nothing-synced-yet) and then swap.
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
        <div className="flex w-full flex-col gap-5">
            {error !== null && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <div className="flex flex-col gap-2">
                        <span>{error}</span>
                        <Button size="sm" variant="outline" onClick={() => void refresh()} className="w-fit">
                            Try again
                        </Button>
                    </div>
                </div>
            )}

            {showSkeleton ? (
                <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                        {[0, 1, 2, 3, 4].map((key) => (
                            <div
                                key={key}
                                className="h-[5.5rem] animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900"
                            />
                        ))}
                    </div>
                    <div className="h-64 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
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
                    <ApplicationsStats stats={stats} />

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
                                className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800"
                                role="group"
                                aria-label="Switch view"
                            >
                                <button
                                    type="button"
                                    onClick={() => setView("table")}
                                    aria-pressed={view === "table"}
                                    className={cn(
                                        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                                        view === "table"
                                            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                                            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
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
                                        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                                        view === "board"
                                            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                                            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
                                    )}
                                >
                                    <KanbanSquare className="h-3.5 w-3.5" />
                                    Board
                                </button>
                            </div>

                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void refresh()}
                                disabled={isLoading}
                                className="gap-1.5"
                            >
                                <RefreshCw className={isLoading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                                Refresh
                            </Button>

                            <Button size="sm" onClick={() => exportCsv()} className="gap-1.5">
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
                            <Button
                                variant="outline"
                                onClick={() => void loadMore()}
                                disabled={isLoadingMore}
                            >
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
