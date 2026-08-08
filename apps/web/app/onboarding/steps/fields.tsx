"use client"

import { useId, useState } from "react"
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2, X } from "lucide-react"
import type { SharedProfile } from "@repo/types/ProfileTypes"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export type FieldErrors = Record<string, string>

export type StepProps = {
    draft: SharedProfile
    errors: FieldErrors
    patch: (patch: Partial<SharedProfile>) => void
    onBlurField: (field: string, value: string) => void
}

export function StepHeader({ title, description }: { title: string; description: string }) {
    return (
        <header className="flex flex-col gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
        </header>
    )
}

export function SubSection({
    title,
    hint,
    children,
    className,
}: {
    title: string
    hint?: string
    children: React.ReactNode
    className?: string
}) {
    return (
        <section className={cn("flex flex-col gap-4", className)}>
            <div className="flex flex-col gap-1 border-b border-border pb-2">
                <h2 className="font-mono text-sm font-semibold">{title}</h2>
                {hint ? <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
            </div>
            {children}
        </section>
    )
}

export function FieldShell({
    label,
    htmlFor,
    hint,
    error,
    className,
    children,
}: {
    label: string
    htmlFor: string
    hint?: string
    error?: string
    className?: string
    children: React.ReactNode
}) {
    return (
        <div className={cn("flex flex-col gap-2", className)}>
            <Label htmlFor={htmlFor}>{label}</Label>
            {children}
            {error ? (
                <p id={`${htmlFor}-error`} role="alert" className="text-xs leading-relaxed text-destructive">
                    {error}
                </p>
            ) : hint ? (
                <p id={`${htmlFor}-hint`} className="text-xs leading-relaxed text-muted-foreground">
                    {hint}
                </p>
            ) : null}
        </div>
    )
}

export function TextField({
    label,
    value,
    onChange,
    onBlur,
    error,
    hint,
    placeholder,
    type = "text",
    autoComplete,
    inputMode,
    disabled,
    className,
}: {
    label: string
    value: string
    onChange: (value: string) => void
    onBlur?: () => void
    error?: string
    hint?: string
    placeholder?: string
    type?: string
    autoComplete?: string
    inputMode?: React.ComponentProps<"input">["inputMode"]
    disabled?: boolean
    className?: string
}) {
    const id = useId()

    return (
        <FieldShell label={label} htmlFor={id} hint={hint} error={error} className={className}>
            <Input
                id={id}
                type={type}
                value={value}
                placeholder={placeholder}
                autoComplete={autoComplete}
                inputMode={inputMode}
                disabled={disabled}
                aria-invalid={error !== undefined}
                aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
                onChange={(event) => onChange(event.target.value)}
                onBlur={onBlur}
            />
        </FieldShell>
    )
}

export function ChipInput({
    label,
    values,
    onChange,
    placeholder,
    hint,
    className,
}: {
    label: string
    values: readonly string[]
    onChange: (values: string[]) => void
    placeholder?: string
    hint?: string
    className?: string
}) {
    const id = useId()
    const [buffer, setBuffer] = useState("")

    const commit = (raw: string) => {
        const parts = raw
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part.length > 0 && !values.includes(part))
        if (parts.length > 0) onChange([...values, ...parts])
        setBuffer("")
    }

    return (
        <FieldShell label={label} htmlFor={id} hint={hint} className={className}>
            {values.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                    {values.map((value) => (
                        <li key={value}>
                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 py-1 pr-1 pl-3 text-xs">
                                {value}
                                <button
                                    type="button"
                                    aria-label={`Remove ${value}`}
                                    onClick={() => onChange(values.filter((item) => item !== value))}
                                    className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
                                >
                                    <X className="size-3" />
                                </button>
                            </span>
                        </li>
                    ))}
                </ul>
            ) : null}
            <Input
                id={id}
                value={buffer}
                placeholder={placeholder}
                autoComplete="off"
                onChange={(event) => setBuffer(event.target.value)}
                onBlur={() => commit(buffer)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                        event.preventDefault()
                        commit(buffer)
                        return
                    }
                    if (event.key === "Backspace" && buffer === "" && values.length > 0) {
                        onChange(values.slice(0, -1))
                    }
                }}
            />
        </FieldShell>
    )
}

export function ToggleChip({
    label,
    selected,
    onToggle,
    disabled,
}: {
    label: string
    selected: boolean
    onToggle: () => void
    disabled?: boolean
}) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={onToggle}
            className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                "disabled:cursor-not-allowed disabled:opacity-50",
                selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
            )}
        >
            {label}
        </button>
    )
}

export function RepeaterCard({
    title,
    subtitle,
    open,
    onToggle,
    onMoveUp,
    onMoveDown,
    onRemove,
    removeLabel,
    children,
}: {
    title: string
    subtitle: string
    open: boolean
    onToggle: () => void
    onMoveUp?: () => void
    onMoveDown?: () => void
    onRemove: () => void
    removeLabel: string
    children: React.ReactNode
}) {
    const bodyId = useId()

    return (
        <li className="rounded-lg border border-border bg-card">
            <div className="flex items-center gap-1 p-2 pl-3">
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={open}
                    aria-controls={bodyId}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
                >
                    <ChevronDown
                        className={cn(
                            "size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                            open && "rotate-180",
                        )}
                    />
                    <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
                    </span>
                </button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    disabled={onMoveUp === undefined}
                    onClick={onMoveUp}
                    aria-label={`Move ${title} up`}
                >
                    <ArrowUp className="size-3.5" />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    disabled={onMoveDown === undefined}
                    onClick={onMoveDown}
                    aria-label={`Move ${title} down`}
                >
                    <ArrowDown className="size-3.5" />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    onClick={onRemove}
                    aria-label={removeLabel}
                >
                    <Trash2 className="size-3.5" />
                </Button>
            </div>
            {open ? (
                <div id={bodyId} className="flex flex-col gap-4 border-t border-border p-4">
                    {children}
                </div>
            ) : null}
        </li>
    )
}

export function AddEntryButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <Button type="button" variant="outline" size="sm" onClick={onClick} className="self-start">
            <Plus className="size-3.5" />
            {label}
        </Button>
    )
}

export function EmptyRepeaterState({ title, body }: { title: string; body: string }) {
    return (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm font-medium">{title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
        </div>
    )
}

export function moveItem<T>(items: readonly T[], index: number, delta: number): T[] {
    const target = index + delta
    if (target < 0 || target >= items.length) return [...items]
    const next = [...items]
    const moved = next[index]
    const displaced = next[target]
    if (moved === undefined || displaced === undefined) return next
    next[index] = displaced
    next[target] = moved
    return next
}
