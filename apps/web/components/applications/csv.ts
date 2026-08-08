/**
 * JF-001 SEC 6.7 "Export" — one-click CSV of the tracker.
 *
 * Runs entirely in the browser: the rows are already in memory, so the export needs no
 * round-trip and works with the API down. This also doubles as the SEC 9.2 data-export
 * affordance ("export = one-click JSON/CSV").
 */

import {
    JobApplication,
    STATUS_LABEL,
    fillScorePct,
    formatAts,
} from "@/components/applications/types"

const HEADERS = [
    "Company",
    "Role",
    "Status",
    "ATS",
    "Applied",
    "Fill score",
    "Link",
    "Notes",
    "Last updated",
] as const

/**
 * Quote every cell and neutralise spreadsheet formula injection: Excel and Sheets execute a
 * cell that opens with `=`, `+`, `-` or `@`, and an ATS-supplied company name is untrusted
 * text (SEC 9.2 injection surface). Prefixing with an apostrophe keeps the value readable.
 */
function csvCell(value: string | number | null): string {
    const raw = value === null ? "" : String(value)
    const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
    return `"${guarded.replace(/"/g, '""')}"`
}

function isoDay(iso: string | null): string {
    if (iso === null) return ""
    const parsed = Date.parse(iso)
    if (Number.isNaN(parsed)) return ""
    return new Date(parsed).toISOString().slice(0, 10)
}

export function applicationsToCsv(rows: readonly JobApplication[]): string {
    const lines: string[] = [HEADERS.map(csvCell).join(",")]

    for (const row of rows) {
        const score = fillScorePct(row)
        lines.push(
            [
                csvCell(row.company),
                csvCell(row.role),
                csvCell(STATUS_LABEL[row.status]),
                csvCell(row.ats === null ? "" : formatAts(row.ats)),
                csvCell(isoDay(row.appliedAt)),
                csvCell(score === null ? "" : `${score}%`),
                csvCell(row.url),
                csvCell(row.notes),
                csvCell(isoDay(row.updatedAt)),
            ].join(","),
        )
    }

    return lines.join("\r\n")
}

export function csvFilename(now: Date = new Date()): string {
    return `nextmove-applications-${now.toISOString().slice(0, 10)}.csv`
}

/** UTF-8 byte-order mark so Excel opens non-ASCII company names correctly. */
const BOM = "\uFEFF"

/** Triggers a browser download of `csv`. Safe to call only from a client component. */
export function downloadCsv(filename: string, csv: string): void {
    if (typeof document === "undefined") return
    const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = href
    anchor.download = filename
    anchor.rel = "noopener"
    anchor.style.display = "none"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(href)
}
