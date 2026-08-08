"use client"

import { useId, useState } from "react"
import type { ComponentProps, ReactNode } from "react"
import { ArrowDown, ArrowUp, Check, ChevronDown, Plus, Trash2, X } from "lucide-react"
import type { SharedProfile } from "@repo/types/ProfileTypes"
import { Button } from "@/components/quiet/Button"
import { Chip } from "@/components/quiet/Chip"
import { Input } from "@/components/quiet/Field"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export type FieldErrors = Record<string, string>

export type StepProps = {
    draft: SharedProfile
    errors: FieldErrors
    patch: (patch: Partial<SharedProfile>) => void
    onBlurField: (field: string, value: string) => void
}

export const labelClass = "text-[13px] font-medium text-fg"

const linkButtonBase =
    "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[13.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"

export const linkButton = {
    acc: cn(
        linkButtonBase,
        "bg-acc text-on-acc shadow-[inset_0_1px_0_rgba(255,255,255,.14),var(--qp-sh-sm)] hover:bg-acc-strong",
    ),
    sec: cn(linkButtonBase, "border border-hair2 bg-surface text-fg shadow-qsm hover:bg-well"),
}

export function StepHeader({ title, description }: { title: string; description: string }) {
    return (
        <header className="flex flex-col gap-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg">{title}</h1>
            <p className="text-[13px] leading-relaxed text-fg2">{description}</p>
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
    children: ReactNode
    className?: string
}) {
    return (
        <section className={cn("flex flex-col gap-4", className)}>
            <div className="flex flex-col gap-1 border-b border-hair pb-2">
                <h2 className={labelClass}>{title}</h2>
                {hint ? <p className="text-xs leading-relaxed text-fg2">{hint}</p> : null}
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
    children: ReactNode
}) {
    return (
        <div className={cn("flex flex-col gap-1.5", className)}>
            <Label htmlFor={htmlFor} className={labelClass}>
                {label}
            </Label>
            {children}
            {error ? (
                <p id={`${htmlFor}-error`} role="alert" className="text-xs leading-relaxed text-dan">
                    {error}
                </p>
            ) : hint ? (
                <p id={`${htmlFor}-hint`} className="text-xs leading-relaxed text-fg2">
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
    inputMode?: ComponentProps<"input">["inputMode"]
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
                className={cn(error !== undefined && "border-dan")}
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
                            <Chip tone="mut" dot={false} className="py-1 pr-1">
                                {value}
                                <button
                                    type="button"
                                    aria-label={`Remove ${value}`}
                                    onClick={() => onChange(values.filter((item) => item !== value))}
                                    className="rounded-full p-0.5 text-fg3 transition-colors hover:bg-surface hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acc"
                                >
                                    <X className="size-3" />
                                </button>
                            </Chip>
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
                "inline-flex items-center gap-1.5 rounded-full border border-hair2 px-3 py-1 text-xs transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc",
                "disabled:cursor-not-allowed disabled:opacity-50",
                selected
                    ? "bg-well2 font-medium text-fg"
                    : "bg-surface text-fg2 hover:bg-well hover:text-fg",
            )}
        >
            {selected ? <Check aria-hidden className="size-3 shrink-0 text-ok" /> : null}
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
    children: ReactNode
}) {
    const bodyId = useId()

    return (
        <li className="rounded-[10px] bg-well">
            <div className="flex items-center gap-1 p-2 pl-3">
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={open}
                    aria-controls={bodyId}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
                >
                    <ChevronDown
                        className={cn(
                            "size-4 shrink-0 text-fg3 transition-transform duration-150 motion-reduce:transition-none",
                            open && "rotate-180",
                        )}
                    />
                    <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-medium text-fg">{title}</span>
                        <span className="block truncate text-xs text-fg2">{subtitle}</span>
                    </span>
                </button>
                <Button
                    type="button"
                    variant="ghost"
                    className="size-8 shrink-0 p-0"
                    disabled={onMoveUp === undefined}
                    onClick={onMoveUp}
                    aria-label={`Move ${title} up`}
                >
                    <ArrowUp className="size-3.5" />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    className="size-8 shrink-0 p-0"
                    disabled={onMoveDown === undefined}
                    onClick={onMoveDown}
                    aria-label={`Move ${title} down`}
                >
                    <ArrowDown className="size-3.5" />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    className="size-8 shrink-0 p-0 hover:bg-danbg hover:text-dan"
                    onClick={onRemove}
                    aria-label={removeLabel}
                >
                    <Trash2 className="size-3.5" />
                </Button>
            </div>
            {open ? (
                <div id={bodyId} className="flex flex-col gap-4 border-t border-hair p-4">
                    {children}
                </div>
            ) : null}
        </li>
    )
}

export function AddEntryButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <Button
            type="button"
            variant="sec"
            onClick={onClick}
            className="self-start px-3 py-1.5 text-[12.5px]"
        >
            <Plus className="size-3.5" />
            {label}
        </Button>
    )
}

export function EmptyRepeaterState({ title, body }: { title: string; body: string }) {
    return (
        <div className="rounded-[10px] border border-dashed border-hair2 p-6 text-center">
            <p className="text-[13px] font-medium text-fg">{title}</p>
            <p className="mt-1 text-xs leading-relaxed text-fg2">{body}</p>
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
