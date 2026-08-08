"use client"

import { Search, X } from "lucide-react"
import { Button } from "@/components/quiet/Button"
import { Input } from "@/components/ui/input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
    JOB_APP_STATUSES,
    STATUS_LABEL,
    formatAts,
    isJobAppStatus,
} from "@/components/applications/types"
import { JobApplicationFilters, isDefaultFilters } from "@/hooks/useJobApplications"

const CONTROL = cn(
    "h-[38px] rounded-lg border-hair2 bg-surface text-[13.5px] text-fg shadow-none md:text-[13.5px]",
    "dark:bg-surface dark:hover:bg-surface",
    "placeholder:text-fg3",
    "focus-visible:border-hair2 focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acc",
)

const SELECT_CONTROL = cn(CONTROL, "data-[size=default]:h-[38px] data-[placeholder]:text-fg3")

type Props = {
    filters: JobApplicationFilters
    onChange: (next: JobApplicationFilters) => void
    onReset: () => void
    atsOptions: readonly string[]

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
        <div className="flex w-full flex-col gap-2">
            <div className="flex w-full flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
                <div className="relative w-full lg:max-w-xs">
                    <Search
                        className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-fg3"
                        aria-hidden="true"
                    />
                    <Input
                        value={filters.search}
                        onChange={(event) => onChange({ ...filters, search: event.target.value })}
                        placeholder="Search company, role, notes…"
                        aria-label="Search applications"
                        className={cn(CONTROL, "pl-8")}
                    />
                </div>

                <Select
                    value={filters.status}
                    onValueChange={(value) =>
                        onChange({ ...filters, status: isJobAppStatus(value) ? value : "ALL" })
                    }
                >
                    <SelectTrigger className={cn(SELECT_CONTROL, "w-full lg:w-[9.5rem]")} aria-label="Filter by status">
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
                    <SelectTrigger className={cn(SELECT_CONTROL, "w-full lg:w-[10rem]")} aria-label="Filter by ATS">
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
                        className={cn(CONTROL, "tnum w-full lg:w-[10rem]")}
                    />
                    <span className="text-xs text-fg3">to</span>
                    <Input
                        type="date"
                        value={filters.to}
                        min={filters.from === "" ? undefined : filters.from}
                        onChange={(event) => onChange({ ...filters, to: event.target.value })}
                        aria-label="Applied on or before"
                        className={cn(CONTROL, "tnum w-full lg:w-[10rem]")}
                    />
                </div>

                {!isPristine && (
                    <Button variant="ghost" onClick={onReset} className="px-3 py-1.5 text-[13px]">
                        <X className="h-3.5 w-3.5" />
                        Clear filters
                    </Button>
                )}
            </div>

            <p className="tnum text-xs text-fg3">
                Showing {shownCount} of {totalCount} loaded application{totalCount === 1 ? "" : "s"}.
            </p>
        </div>
    )
}

export default ApplicationsFilters
