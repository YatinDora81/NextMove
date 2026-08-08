

import type { ChipTone } from "@/components/quiet/Chip"

export type JobAppStatus = "DRAFT" | "APPLIED" | "INTERVIEW" | "OFFER" | "REJECTED" | "GHOSTED"

export const JOB_APP_STATUSES: readonly JobAppStatus[] = [
    "DRAFT",
    "APPLIED",
    "INTERVIEW",
    "OFFER",
    "REJECTED",
    "GHOSTED",
]

export const BOARD_LANES: readonly JobAppStatus[] = JOB_APP_STATUSES

export const RESPONSE_STATUSES: readonly JobAppStatus[] = ["INTERVIEW", "OFFER", "REJECTED"]

export const POSITIVE_RESPONSE_STATUSES: readonly JobAppStatus[] = ["INTERVIEW", "OFFER"]

export const STATUS_LABEL: Record<JobAppStatus, string> = {
    DRAFT: "Draft",
    APPLIED: "Applied",
    INTERVIEW: "Interview",
    OFFER: "Offer",
    REJECTED: "Rejected",
    GHOSTED: "Ghosted",
}

export const STATUS_TONE: Record<JobAppStatus, ChipTone> = {
    DRAFT: "mut",
    APPLIED: "acc",
    INTERVIEW: "warn",
    OFFER: "ok",
    REJECTED: "mut",
    GHOSTED: "mut",
}

export const STATUS_DOT: Record<JobAppStatus, string> = {
    DRAFT: "bg-fg3",
    APPLIED: "bg-acc",
    INTERVIEW: "bg-warn",
    OFFER: "bg-ok",
    REJECTED: "bg-fg3",
    GHOSTED: "bg-fg3",
}

export function isJobAppStatus(value: unknown): value is JobAppStatus {
    return typeof value === "string" && (JOB_APP_STATUSES as readonly string[]).includes(value)
}

export type JobApplicationHistoryEntry = {

    at: number
    to: JobAppStatus
}

export type JobApplicationFillStats = {
    filled: number
    total: number
}

export type JobApplication = {
    id: string

    clientId: string
    company: string
    role: string
    url: string | null
    ats: string | null
    status: JobAppStatus
    appliedAt: string | null
    notes: string | null
    fillStats: JobApplicationFillStats | null
    history: JobApplicationHistoryEntry[]
    updatedAt: string | null
}

export type JobApplicationDetailsPatch = {
    company: string
    role: string
    url: string | null
    ats: string | null
}

function toFillStats(raw: unknown): JobApplicationFillStats | null {
    if (typeof raw !== "object" || raw === null) return null
    const bag = raw as Record<string, unknown>
    const filled = bag.filled
    const total = bag.total
    if (typeof filled !== "number" || typeof total !== "number") return null
    if (!Number.isFinite(filled) || !Number.isFinite(total)) return null
    return { filled, total }
}

function toHistory(raw: unknown): JobApplicationHistoryEntry[] {
    if (!Array.isArray(raw)) return []
    const out: JobApplicationHistoryEntry[] = []
    for (const entry of raw) {
        if (typeof entry !== "object" || entry === null) continue
        const bag = entry as Record<string, unknown>
        const at = bag.at
        if (typeof at !== "number" || !Number.isFinite(at)) continue
        if (!isJobAppStatus(bag.to)) continue
        out.push({ at, to: bag.to })
    }
    out.sort((a, b) => a.at - b.at)
    return out
}

function optionalString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null
}

export function toJobApplication(raw: unknown): JobApplication | null {
    if (typeof raw !== "object" || raw === null) return null
    const bag = raw as Record<string, unknown>

    const clientId = typeof bag.clientId === "string" ? bag.clientId : null
    const id = typeof bag.id === "string" ? bag.id : clientId
    if (id === null || clientId === null) return null
    if (typeof bag.company !== "string" || typeof bag.role !== "string") return null

    return {
        id,
        clientId,
        company: bag.company,
        role: bag.role,
        url: optionalString(bag.url),
        ats: optionalString(bag.ats),
        status: isJobAppStatus(bag.status) ? bag.status : "APPLIED",
        appliedAt: optionalString(bag.appliedAt),
        notes: typeof bag.notes === "string" ? bag.notes : null,
        fillStats: toFillStats(bag.fillStats),
        history: toHistory(bag.history),
        updatedAt: optionalString(bag.updatedAt),
    }
}

export function appliedAtMs(row: JobApplication): number | null {
    if (row.appliedAt !== null) {
        const parsed = Date.parse(row.appliedAt)
        if (!Number.isNaN(parsed)) return parsed
    }
    for (const entry of row.history) {
        if (entry.to === "APPLIED") return entry.at
    }
    return null
}

export function respondedAtMs(row: JobApplication): number | null {
    for (const entry of row.history) {
        if ((RESPONSE_STATUSES as readonly string[]).includes(entry.to)) return entry.at
    }
    return null
}

export function reachedInterview(row: JobApplication): boolean {
    if ((POSITIVE_RESPONSE_STATUSES as readonly string[]).includes(row.status)) return true
    return row.history.some((entry) => (POSITIVE_RESPONSE_STATUSES as readonly string[]).includes(entry.to))
}

export function fillScorePct(row: JobApplication): number | null {
    const stats = row.fillStats
    if (stats === null || stats.total <= 0) return null
    const pct = Math.round((stats.filled / stats.total) * 100)
    return Math.max(0, Math.min(100, pct))
}

const ATS_LABELS: Record<string, string> = {
    greenhouse: "Greenhouse",
    lever: "Lever",
    workday: "Workday",
    icims: "iCIMS",
    ashby: "Ashby",
    smartrecruiters: "SmartRecruiters",
    taleo: "Taleo",
    generic: "Other",
}

export function formatAts(ats: string | null): string {
    if (ats === null) return "—"
    return ATS_LABELS[ats.toLowerCase()] ?? ats
}

export function formatDate(iso: string | null): string {
    if (iso === null) return "—"
    const parsed = Date.parse(iso)
    if (Number.isNaN(parsed)) return "—"
    return new Date(parsed).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    })
}

export function formatDayLabel(iso: string | null, now: number = Date.now()): string {
    if (iso === null) return "—"
    const parsed = Date.parse(iso)
    if (Number.isNaN(parsed)) return "—"
    const then = new Date(parsed)
    const today = new Date(now)
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()
    const dayDelta = Math.round((startOfToday - startOfThen) / 86_400_000)
    if (dayDelta === 0) return "Today"
    if (dayDelta === 1) return "Yesterday"
    if (then.getFullYear() === today.getFullYear()) {
        return then.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    }
    return then.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

export function formatTimeAgo(iso: string | null, now: number = Date.now()): string | null {
    if (iso === null) return null
    const parsed = Date.parse(iso)
    if (Number.isNaN(parsed)) return null
    const seconds = Math.max(0, Math.round((now - parsed) / 1000))
    if (seconds < 60) return "just now"
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.round(hours / 24)
    if (days < 30) return `${days}d ago`
    return formatDayLabel(iso, now)
}

export function safeHostname(url: string | null): string | null {
    if (url === null) return null
    try {
        const parsed = new URL(url)
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
        return parsed.hostname.replace(/^www\./, "")
    } catch {
        return null
    }
}

export function isOpenableUrl(url: string | null): boolean {
    return safeHostname(url) !== null
}

export function appendHistory(
    row: JobApplication,
    to: JobAppStatus,
    at: number,
): JobApplicationHistoryEntry[] {
    return [...row.history, { at, to }]
}
