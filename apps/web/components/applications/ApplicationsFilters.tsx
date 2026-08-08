"use client"

/**
 * JF-001 SEC 6.7 "Quick filters: status, ATS, date range". The `profile` filter from the
 * extension spec has no web analogue — the cloud `JobApplication` model deliberately does
 * not carry `profileId` (profiles never leave the device, SEC 7.4).
 */

import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    JOB_APP_STATUSES,
    STATUS_LABEL,
    formatAts,
    isJobAppStatus,
} from "@/components/applications/types"
import { JobApplicationFilters, isDefaultFilters } from "@/hooks/useJobApplications"

type Props = {
    filters: JobApplicationFilters
    onChange: (next: JobApplicationFilters) => void
    onReset: () => void
    atsOptions: readonly string[]
    /** Rows currently visible / rows loaded, for the "showing x of y" line. */
    shownCount: number
    totalCount: number
}

export function ApplicationsFilters({
    filters,
    onChange,
    onReset,
    atsOptions,
    shownCount,
    totalCount,
}: Props) {
    const isPristine = isDefaultFilters(filters)

    return (
        <div className="flex w-full flex-col gap-3">
            <div className="flex w-full flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
                <div className="relative w-full lg:max-w-xs">
                    <Search
                        className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-zinc-400"
                        aria-hidden="true"
                    />
                    <Input
                        value={filters.search}
                        onChange={(event) => onChange({ ...filters, search: event.target.value })}
                        placeholder="Search company, role, notes…"
                        aria-label="Search applications"
                        className="pl-8"
                    />
                </div>

                <Select
                    value={filters.status}
                    onValueChange={(value) =>
                        onChange({ ...filters, status: isJobAppStatus(value) ? value : "ALL" })
                    }
                >
                    <SelectTrigger className="w-full lg:w-[9.5rem]" aria-label="Filter by status">
                        <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ALL">All statuses</SelectItem>
                        {JOB_APP_STATUSES.map((status) => (
                            <SelectItem key={status} value={status}>
                                {STATUS_LABEL[status]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select value={filters.ats} onValueChange={(value) => onChange({ ...filters, ats: value })}>
                    <SelectTrigger className="w-full lg:w-[10rem]" aria-label="Filter by ATS">
                        <SelectValue placeholder="ATS" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ALL">All sources</SelectItem>
                        {atsOptions.map((ats) => (
                            <SelectItem key={ats} value={ats}>
                                {formatAts(ats)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <div className="flex items-center gap-2">
                    <Input
                        type="date"
                        value={filters.from}
                        max={filters.to === "" ? undefined : filters.to}
                        onChange={(event) => onChange({ ...filters, from: event.target.value })}
                        aria-label="Applied on or after"
                        className="w-full lg:w-[10rem]"
                    />
                    <span className="text-xs text-zinc-500">to</span>
                    <Input
                        type="date"
                        value={filters.to}
                        min={filters.from === "" ? undefined : filters.from}
                        onChange={(event) => onChange({ ...filters, to: event.target.value })}
                        aria-label="Applied on or before"
                        className="w-full lg:w-[10rem]"
                    />
                </div>

                {!isPristine && (
                    <Button variant="ghost" size="sm" onClick={onReset} className="gap-1.5">
                        <X className="h-3.5 w-3.5" />
                        Clear filters
                    </Button>
                )}
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Showing {shownCount} of {totalCount} loaded application{totalCount === 1 ? "" : "s"}.
            </p>
        </div>
    )
}

export default ApplicationsFilters
