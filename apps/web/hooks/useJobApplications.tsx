"use client"

/**
 * JF-001 SEC 8.5 / SEC 8.3 — client for `GET|POST|PATCH|DELETE /api/job-applications`.
 *
 * These are the tracker rows the extension pushed up (SEC 6.7), not outreach messages —
 * the two live side by side in the Applied dashboard but answer different questions
 * (SEC 7.5). Everything here is user-curated tracker data: no profile PII, no answers and
 * no Gemini key ever crosses this boundary (INV-5, SEC 7.4 note).
 *
 * Writes address rows by `clientId`, which is what makes the sync idempotent (SEC 7.4).
 * The API speaks the repo-standard `{ success, data, message }` envelope.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import toast from "react-hot-toast"
import { useAuth } from "@/hooks/useAuth"
import { JOB_APPLICATIONS } from "@/utils/url"
import {
    JobAppStatus,
    JobApplication,
    JobApplicationDetailsPatch,
    appendHistory,
    appliedAtMs,
    toJobApplication,
} from "@/components/applications/types"
import { applicationsToCsv, csvFilename, downloadCsv } from "@/components/applications/csv"

type ApiEnvelope<T> = {
    success: boolean
    data: T
    message: string
}

/** Quick filters from SEC 6.7: status, ATS, date range (+ a free-text box over the row). */
export type JobApplicationFilters = {
    search: string
    status: JobAppStatus | "ALL"
    ats: string | "ALL"
    /** Inclusive `yyyy-mm-dd` lower bound on the applied date. Empty string = unbounded. */
    from: string
    /** Inclusive `yyyy-mm-dd` upper bound on the applied date. Empty string = unbounded. */
    to: string
}

export const EMPTY_JOB_APPLICATION_FILTERS: JobApplicationFilters = {
    search: "",
    status: "ALL",
    ats: "ALL",
    from: "",
    to: "",
}

export function isDefaultFilters(filters: JobApplicationFilters): boolean {
    return (
        filters.search.trim() === "" &&
        filters.status === "ALL" &&
        filters.ats === "ALL" &&
        filters.from === "" &&
        filters.to === ""
    )
}

const DEFAULT_PAGE_SIZE = 100
const SEARCH_DEBOUNCE_MS = 300
const DAY_MS = 86_400_000

// ==================
// Wire helpers
// ==================

function rowUrl(clientId: string): string {
    return `${JOB_APPLICATIONS}/${encodeURIComponent(clientId)}`
}

/**
 * The list route is cursor-paginated (SEC 8.3) but the exact envelope shape is the sync
 * agent's to choose, so this accepts either a bare array or a `{ items, nextCursor }`
 * style object under any of the obvious key names. Anything it cannot recognise degrades
 * to "no rows, no cursor" rather than throwing on the user.
 */
function readPage(payload: unknown): { items: JobApplication[]; nextCursor: string | null } {
    if (Array.isArray(payload)) {
        return { items: readRows(payload), nextCursor: null }
    }
    if (typeof payload === "object" && payload !== null) {
        const bag = payload as Record<string, unknown>
        const candidates: unknown[] = [bag.items, bag.applications, bag.rows, bag.jobApplications, bag.data]
        const list = candidates.find((candidate): candidate is unknown[] => Array.isArray(candidate))
        const nextCursor =
            typeof bag.nextCursor === "string" && bag.nextCursor.length > 0
                ? bag.nextCursor
                : typeof bag.cursor === "string" && bag.cursor.length > 0
                  ? bag.cursor
                  : null
        return { items: list === undefined ? [] : readRows(list), nextCursor }
    }
    return { items: [], nextCursor: null }
}

function readRows(list: readonly unknown[]): JobApplication[] {
    const out: JobApplication[] = []
    for (const raw of list) {
        const row = toJobApplication(raw)
        if (row !== null) out.push(row)
    }
    return out
}

function buildListUrl(filters: JobApplicationFilters, cursor: string | null, pageSize: number): string {
    const params = new URLSearchParams()
    params.set("limit", String(pageSize))
    if (cursor !== null) params.set("cursor", cursor)
    if (filters.status !== "ALL") params.set("status", filters.status)
    if (filters.ats !== "ALL") params.set("ats", filters.ats)
    if (filters.from !== "") params.set("from", filters.from)
    if (filters.to !== "") params.set("to", filters.to)
    const search = filters.search.trim()
    if (search !== "") params.set("q", search)
    return `${JOB_APPLICATIONS}?${params.toString()}`
}

function errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message
    return fallback
}

function envelopeMessage(payload: unknown, fallback: string): string {
    if (typeof payload === "object" && payload !== null) {
        const bag = payload as Record<string, unknown>
        if (typeof bag.message === "string" && bag.message.length > 0) return bag.message
    }
    return fallback
}

// ==================
// Client-side filtering
// ==================

function dayBoundMs(day: string, endOfDay: boolean): number | null {
    if (day === "") return null
    const parsed = Date.parse(`${day}T00:00:00`)
    if (Number.isNaN(parsed)) return null
    return endOfDay ? parsed + DAY_MS - 1 : parsed
}

/**
 * Applied on top of whatever the server returned. When the API honours the query params
 * this is a no-op; when it does not, the visible list still matches the chips the user
 * set. Rows with no applied date are excluded as soon as a date bound is in play — they
 * cannot honestly be said to fall inside a range.
 */
export function filterApplications(
    rows: readonly JobApplication[],
    filters: JobApplicationFilters,
): JobApplication[] {
    const needle = filters.search.trim().toLowerCase()
    const fromMs = dayBoundMs(filters.from, false)
    const toMs = dayBoundMs(filters.to, true)

    return rows.filter((row) => {
        if (filters.status !== "ALL" && row.status !== filters.status) return false
        if (filters.ats !== "ALL") {
            const ats = row.ats === null ? "" : row.ats.toLowerCase()
            if (ats !== filters.ats.toLowerCase()) return false
        }
        if (fromMs !== null || toMs !== null) {
            const sentAt = appliedAtMs(row)
            if (sentAt === null) return false
            if (fromMs !== null && sentAt < fromMs) return false
            if (toMs !== null && sentAt > toMs) return false
        }
        if (needle !== "") {
            const haystack = [row.company, row.role, row.ats ?? "", row.notes ?? "", row.url ?? ""]
                .join(" ")
                .toLowerCase()
            if (!haystack.includes(needle)) return false
        }
        return true
    })
}

// ==================
// Hook
// ==================

export type UseJobApplications = {
    /** Rows after the client-side filter pass — what every view should render. */
    applications: JobApplication[]
    /** Every row fetched so far, filters ignored. */
    allApplications: JobApplication[]
    isLoading: boolean
    isLoadingMore: boolean
    isMutating: boolean
    /** Settles true after the first list call resolves — separates "empty" from "not loaded". */
    hasLoaded: boolean
    error: string | null
    hasMore: boolean
    filters: JobApplicationFilters
    setFilters: (next: JobApplicationFilters) => void
    resetFilters: () => void
    /** ATS ids present in the loaded rows, for the quick-filter dropdown. */
    atsOptions: string[]
    refresh: () => Promise<void>
    loadMore: () => Promise<void>
    /** Moves a row to a new lane and appends the transition to `history[]` (SEC 6.7). */
    setStatus: (clientId: string, status: JobAppStatus) => Promise<boolean>
    updateDetails: (clientId: string, details: JobApplicationDetailsPatch) => Promise<boolean>
    updateNotes: (clientId: string, notes: string) => Promise<boolean>
    deleteApplication: (clientId: string) => Promise<boolean>
    /** One-click CSV of the rows passed in, or of the current filtered view. */
    exportCsv: (rows?: readonly JobApplication[]) => void
}

export function useJobApplications(pageSize: number = DEFAULT_PAGE_SIZE): UseJobApplications {
    const { getToken, isSignedIn, isLoaded } = useAuth()

    const [rows, setRows] = useState<JobApplication[]>([])
    const [cursor, setCursor] = useState<string | null>(null)
    const [hasMore, setHasMore] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [isLoadingMore, setIsLoadingMore] = useState(false)
    const [isMutating, setIsMutating] = useState(false)
    const [hasLoaded, setHasLoaded] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [filters, setFilters] = useState<JobApplicationFilters>(EMPTY_JOB_APPLICATION_FILTERS)

    /** Guards against a slow page-1 response overwriting a newer filter's result. */
    const requestSeq = useRef(0)
    const filtersRef = useRef(filters)
    filtersRef.current = filters
    const cursorRef = useRef<string | null>(null)
    cursorRef.current = cursor
    /**
     * Mutations need the current rows *synchronously* — both to build a rollback snapshot
     * and to read the row being moved. A `useState` updater is not guaranteed to run at
     * call time, so reading through a ref is the only correct way to do that.
     */
    const rowsRef = useRef<JobApplication[]>(rows)
    rowsRef.current = rows

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        const token = await getToken()
        if (!token) throw new Error("Your session expired. Sign in again to load your applications.")
        return {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        }
    }, [getToken])

    const load = useCallback(
        async (mode: "replace" | "append") => {
            const seq = requestSeq.current + 1
            requestSeq.current = seq

            if (mode === "replace") setIsLoading(true)
            else setIsLoadingMore(true)

            try {
                const headers = await authHeaders()
                const nextCursor = mode === "append" ? cursorRef.current : null
                const res = await fetch(buildListUrl(filtersRef.current, nextCursor, pageSize), {
                    method: "GET",
                    headers,
                    cache: "no-store",
                })
                const payload: unknown = await res.json().catch(() => null)

                if (requestSeq.current !== seq) return

                if (!res.ok) {
                    throw new Error(envelopeMessage(payload, `Could not load applications (${res.status}).`))
                }
                const envelope = payload as ApiEnvelope<unknown> | null
                if (envelope === null || envelope.success !== true) {
                    throw new Error(envelopeMessage(payload, "Could not load applications."))
                }

                const page = readPage(envelope.data)
                setRows((previous) => {
                    if (mode === "replace") return page.items
                    const seen = new Set(previous.map((row) => row.clientId))
                    return [...previous, ...page.items.filter((row) => !seen.has(row.clientId))]
                })
                setCursor(page.nextCursor)
                setHasMore(page.nextCursor !== null && page.items.length > 0)
                setError(null)
            } catch (caught) {
                if (requestSeq.current !== seq) return
                const message = errorMessage(caught, "Could not load applications.")
                setError(message)
                if (mode === "append") toast.error(message)
            } finally {
                if (requestSeq.current === seq) {
                    setHasLoaded(true)
                    if (mode === "replace") setIsLoading(false)
                    else setIsLoadingMore(false)
                }
            }
        },
        [authHeaders, pageSize],
    )

    // Filters are pushed to the server (SEC 8.3 query params) after a short debounce so a
    // typed search does not fire a request per keystroke.
    useEffect(() => {
        if (!isLoaded) return
        if (!isSignedIn) {
            setRows([])
            setHasLoaded(true)
            return
        }
        const timer = setTimeout(() => {
            void load("replace")
        }, SEARCH_DEBOUNCE_MS)
        return () => clearTimeout(timer)
    }, [filters, isLoaded, isSignedIn, load])

    const refresh = useCallback(async () => {
        await load("replace")
    }, [load])

    const loadMore = useCallback(async () => {
        if (!hasMore || cursorRef.current === null) return
        await load("append")
    }, [hasMore, load])

    const resetFilters = useCallback(() => {
        setFilters(EMPTY_JOB_APPLICATION_FILTERS)
    }, [])

    /**
     * Optimistic PATCH: the board must feel like a board, so the card moves immediately and
     * the previous rows are restored verbatim if the server refuses.
     */
    const patchRow = useCallback(
        async (
            clientId: string,
            body: Record<string, unknown>,
            optimistic: (row: JobApplication) => JobApplication,
            failureMessage: string,
        ): Promise<boolean> => {
            const snapshot = rowsRef.current
            setRows((previous) => previous.map((row) => (row.clientId === clientId ? optimistic(row) : row)))
            setIsMutating(true)
            try {
                const headers = await authHeaders()
                const res = await fetch(rowUrl(clientId), {
                    method: "PATCH",
                    headers,
                    body: JSON.stringify(body),
                })
                const payload: unknown = await res.json().catch(() => null)
                if (!res.ok) throw new Error(envelopeMessage(payload, failureMessage))
                const envelope = payload as ApiEnvelope<unknown> | null
                if (envelope === null || envelope.success !== true) {
                    throw new Error(envelopeMessage(payload, failureMessage))
                }
                // Reconcile with the server's copy when it hands one back.
                const saved = toJobApplication(envelope.data)
                if (saved !== null) {
                    setRows((previous) => previous.map((row) => (row.clientId === clientId ? saved : row)))
                }
                return true
            } catch (caught) {
                setRows(snapshot)
                toast.error(errorMessage(caught, failureMessage))
                return false
            } finally {
                setIsMutating(false)
            }
        },
        [authHeaders],
    )

    const setStatus = useCallback(
        async (clientId: string, status: JobAppStatus): Promise<boolean> => {
            const current = rowsRef.current.find((row) => row.clientId === clientId)
            if (current === undefined || current.status === status) return true

            const at = Date.now()
            const history = appendHistory(current, status, at)
            // Leaving DRAFT for the first time is what makes a row "applied" — stamp the date
            // the extension's PageObserver would have stamped had it seen the confirmation.
            const stampApplied = status !== "DRAFT" && current.appliedAt === null
            const appliedAt = stampApplied ? new Date(at).toISOString() : current.appliedAt

            const body: Record<string, unknown> = { status, history }
            if (stampApplied) body.appliedAt = appliedAt

            return patchRow(
                clientId,
                body,
                (row) => ({ ...row, status, history, appliedAt }),
                "Could not move that application.",
            )
        },
        [patchRow],
    )

    const updateDetails = useCallback(
        async (clientId: string, details: JobApplicationDetailsPatch): Promise<boolean> => {
            const body: Record<string, unknown> = {
                company: details.company,
                role: details.role,
                url: details.url,
                ats: details.ats,
            }
            return patchRow(
                clientId,
                body,
                (row) => ({ ...row, ...details }),
                "Could not save those changes.",
            )
        },
        [patchRow],
    )

    const updateNotes = useCallback(
        async (clientId: string, notes: string): Promise<boolean> => {
            const trimmed = notes.trim()
            const next = trimmed === "" ? null : trimmed
            return patchRow(
                clientId,
                { notes: next },
                (row) => ({ ...row, notes: next }),
                "Could not save that note.",
            )
        },
        [patchRow],
    )

    const deleteApplication = useCallback(
        async (clientId: string): Promise<boolean> => {
            const snapshot = rowsRef.current
            setRows((previous) => previous.filter((row) => row.clientId !== clientId))
            setIsMutating(true)
            try {
                const headers = await authHeaders()
                const res = await fetch(rowUrl(clientId), { method: "DELETE", headers })
                const payload: unknown = await res.json().catch(() => null)
                if (!res.ok) throw new Error(envelopeMessage(payload, "Could not delete that application."))
                const envelope = payload as ApiEnvelope<unknown> | null
                if (envelope === null || envelope.success !== true) {
                    throw new Error(envelopeMessage(payload, "Could not delete that application."))
                }
                toast.success("Application deleted.")
                return true
            } catch (caught) {
                setRows(snapshot)
                toast.error(errorMessage(caught, "Could not delete that application."))
                return false
            } finally {
                setIsMutating(false)
            }
        },
        [authHeaders],
    )

    const applications = useMemo(() => filterApplications(rows, filters), [rows, filters])

    const atsOptions = useMemo(() => {
        const seen = new Set<string>()
        for (const row of rows) {
            if (row.ats !== null && row.ats.trim() !== "") seen.add(row.ats.toLowerCase())
        }
        return [...seen].sort()
    }, [rows])

    const exportCsv = useCallback(
        (explicit?: readonly JobApplication[]) => {
            const target = explicit ?? applications
            if (target.length === 0) {
                toast.error("Nothing to export yet.")
                return
            }
            downloadCsv(csvFilename(), applicationsToCsv(target))
            toast.success(`Exported ${target.length} application${target.length === 1 ? "" : "s"}.`)
        },
        [applications],
    )

    return {
        applications,
        allApplications: rows,
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
    }
}

export default useJobApplications
