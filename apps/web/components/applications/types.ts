/**
 * JF-001 SEC 6.7 / SEC 8.5 — shared shapes for the web "Applications" dashboard.
 *
 * These mirror `jobApplicationRowSchema` in `@repo/types/ExtensionTypes` and the
 * `JobApplication` Prisma model (SEC 7.4). They are re-declared here rather than imported
 * because `apps/web` does not depend on `@repo/types` (see its package.json, which is
 * frozen) — the same approach `hooks/useAiKeys.tsx` takes for the AI-key shapes. Any
 * change to the wire contract must be made in both places.
 *
 * Nothing in this module is JobFill *vault* data: profiles, resumes, answers and Gemini
 * keys never reach the web (SEC 7.4 note / INV-5). Only user-curated tracker rows do.
 */

// ==================
// Status
// ==================

/** Mirrors the `JobAppStatus` Prisma enum and `jobAppStatusSchema` (SEC 7.4). */
export type JobAppStatus = "DRAFT" | "APPLIED" | "INTERVIEW" | "OFFER" | "REJECTED" | "GHOSTED"

export const JOB_APP_STATUSES: readonly JobAppStatus[] = [
    "DRAFT",
    "APPLIED",
    "INTERVIEW",
    "OFFER",
    "REJECTED",
    "GHOSTED",
]

/** Kanban lane order — SEC 6.7: `draft → applied → interview → offer / rejected / ghosted`. */
export const BOARD_LANES: readonly JobAppStatus[] = JOB_APP_STATUSES

/** Statuses that count as "the employer came back to you" for the response-rate stat. */
export const RESPONSE_STATUSES: readonly JobAppStatus[] = ["INTERVIEW", "OFFER", "REJECTED"]

/** Reaching one of these means the application converted into a real conversation. */
export const POSITIVE_RESPONSE_STATUSES: readonly JobAppStatus[] = ["INTERVIEW", "OFFER"]

export const STATUS_LABEL: Record<JobAppStatus, string> = {
    DRAFT: "Draft",
    APPLIED: "Applied",
    INTERVIEW: "Interview",
    OFFER: "Offer",
    REJECTED: "Rejected",
    GHOSTED: "Ghosted",
}

/** Badge colours. Every entry carries an explicit dark-mode pair. */
export const STATUS_CLASS: Record<JobAppStatus, string> = {
    DRAFT: "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
    APPLIED: "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-900",
    INTERVIEW: "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-900",
    OFFER: "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-900",
    REJECTED: "bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-900",
    GHOSTED: "bg-violet-50 text-violet-700 border-violet-300 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-900",
}

/** Accent used for the lane header rules on the board view. */
export const STATUS_ACCENT: Record<JobAppStatus, string> = {
    DRAFT: "bg-zinc-400 dark:bg-zinc-600",
    APPLIED: "bg-blue-500",
    INTERVIEW: "bg-amber-500",
    OFFER: "bg-emerald-500",
    REJECTED: "bg-rose-500",
    GHOSTED: "bg-violet-500",
}

export function isJobAppStatus(value: unknown): value is JobAppStatus {
    return typeof value === "string" && (JOB_APP_STATUSES as readonly string[]).includes(value)
}

// ==================
// Row shape
// ==================

/** One status transition, appended whenever a card moves lane (SEC 6.7). */
export type JobApplicationHistoryEntry = {
    /** epoch ms */
    at: number
    to: JobAppStatus
}

/** `{ filled, total }` lifted from the extension's FillReport (SEC 7.4). */
export type JobApplicationFillStats = {
    filled: number
    total: number
}

/** A `JobApplication` row as the sync API returns it. All timestamps are ISO strings. */
export type JobApplication = {
    id: string
    /** Extension-side row id. The idempotency key for every write (SEC 7.4). */
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

/** The subset of a row the dashboard is allowed to edit. */
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

/**
 * Narrows one untrusted API row to `JobApplication`. A row missing the identity fields is
 * dropped rather than half-rendered — the same discipline `toAiKeyPublic` uses.
 */
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

// ==================
// Derived values
// ==================

/**
 * When this application was actually sent, in epoch ms, or `null` if it never was.
 * Falls back to the first `APPLIED` history entry for rows the extension logged before
 * the observer confirmed a submission (SEC 6.7 status flip).
 */
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

/** Epoch ms of the first employer response, or `null` if none has landed. */
export function respondedAtMs(row: JobApplication): number | null {
    for (const entry of row.history) {
        if ((RESPONSE_STATUSES as readonly string[]).includes(entry.to)) return entry.at
    }
    return null
}

/** True once the application reached an interview or an offer. */
export function reachedInterview(row: JobApplication): boolean {
    if ((POSITIVE_RESPONSE_STATUSES as readonly string[]).includes(row.status)) return true
    return row.history.some((entry) => (POSITIVE_RESPONSE_STATUSES as readonly string[]).includes(entry.to))
}

/** Fill score as a 0–100 percentage, or `null` when the extension reported no stats. */
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

/** Pretty name for an ATS id, falling back to the raw string for adapters we do not ship. */
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

/** Host of a posting URL, for a compact link cell. `null` when the URL is unusable. */
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

/** Only http(s) postings are ever turned into a clickable anchor. */
export function isOpenableUrl(url: string | null): boolean {
    return safeHostname(url) !== null
}

/**
 * SEC 6.7: "drag between lanes appends to `history[]` with timestamp." This is the single
 * place that builds that append, so the table's status menu and the board's drag both
 * produce identical audit trails.
 */
export function appendHistory(
    row: JobApplication,
    to: JobAppStatus,
    at: number,
): JobApplicationHistoryEntry[] {
    return [...row.history, { at, to }]
}
