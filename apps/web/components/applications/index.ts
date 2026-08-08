/**
 * JF-001 SEC 8.5 — public surface of the web Applications dashboard (SEC 6.7 ported).
 */

export { default as ApplicationsDashboard, ApplicationsDashboard as Dashboard } from "@/components/applications/ApplicationsDashboard"
export { default as ApplicationsTable } from "@/components/applications/ApplicationsTable"
export { default as ApplicationsBoard } from "@/components/applications/ApplicationsBoard"
export { default as ApplicationsStats } from "@/components/applications/ApplicationsStats"
export { default as ApplicationsFilters } from "@/components/applications/ApplicationsFilters"
export { default as ApplicationRowActions } from "@/components/applications/ApplicationRowActions"
export { default as PairDeviceEmptyState } from "@/components/applications/PairDeviceEmptyState"
export { default as StatusBadge } from "@/components/applications/StatusBadge"
export {
    DeleteApplicationDialog,
    EditApplicationDialog,
    NoteDialog,
} from "@/components/applications/ApplicationDialogs"
export { applicationsToCsv, csvFilename, downloadCsv } from "@/components/applications/csv"
export { computeApplicationStats, EMPTY_APPLICATION_STATS } from "@/components/applications/stats"
export type { ApplicationStats } from "@/components/applications/stats"
export * from "@/components/applications/types"
