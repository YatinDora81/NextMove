"use client"

import type { FormEvent } from "react"
import { useState } from "react"
import { CheckCircle2, Loader2, XCircle } from "lucide-react"
import { Button } from "@/components/quiet/Button"
import { Field, Input } from "@/components/quiet/Field"
import { useAiKeys, type AiKeyVerdict } from "@/hooks/useAiKeys"
import { cn } from "@/lib/utils"

const MIN_KEY_LENGTH = 20
const MAX_KEY_LENGTH = 200
const MAX_LABEL_LENGTH = 40

export function AddAiKeyForm({
    onSaved,
    submitLabel = "Test & Save",
    className,
}: {
    onSaved?: (verdict: AiKeyVerdict) => void
    submitLabel?: string
    className?: string
}) {
    const { addKey, isMutating, keys } = useAiKeys()
    const [label, setLabel] = useState("")
    const [keyValue, setKeyValue] = useState("")
    const [verdict, setVerdict] = useState<AiKeyVerdict | null>(null)
    const [submitting, setSubmitting] = useState(false)

    const trimmedKey = keyValue.trim()
    const effectiveLabel = label.trim() || `Key ${keys.length + 1}`

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (submitting) return

        if (trimmedKey.length < MIN_KEY_LENGTH || trimmedKey.length > MAX_KEY_LENGTH) {
            setVerdict({
                ok: false,
                message: `That doesn't look like a Gemini API key — they are ${MIN_KEY_LENGTH}–${MAX_KEY_LENGTH} characters and start with "AIza".`,
            })
            return
        }

        setSubmitting(true)
        setVerdict(null)
        const result = await addKey(trimmedKey, effectiveLabel.slice(0, MAX_LABEL_LENGTH))
        setVerdict(result)
        if (result.ok) {
            setKeyValue("")
            setLabel("")
            onSaved?.(result)
        }
        setSubmitting(false)
    }

    const busy = submitting || isMutating

    return (
        <form onSubmit={handleSubmit} className={cn("flex flex-col", className)}>
            <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
                <Field label="Label" className="mt-0">
                    <Input
                        id="ai-key-label"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="Personal"
                        maxLength={MAX_LABEL_LENGTH}
                        autoComplete="off"
                        disabled={busy}
                    />
                </Field>
                <Field label="Gemini API key" className="mt-0">
                    <Input
                        id="ai-key-value"
                        type="password"
                        value={keyValue}
                        onChange={(e) => {
                            setKeyValue(e.target.value)
                            if (verdict) setVerdict(null)
                        }}
                        placeholder="Paste your key — it is never shown again"
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={MAX_KEY_LENGTH}
                        disabled={busy}
                        aria-invalid={verdict !== null && !verdict.ok}
                        className="font-mono aria-invalid:border-dan"
                    />
                </Field>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button type="submit" variant="acc" disabled={busy || trimmedKey.length === 0}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                    {busy ? "Checking with Google…" : submitLabel}
                </Button>
                <p className="text-xs text-fg2">
                    We call Google once to confirm the key works before storing it.
                </p>
            </div>

            {verdict ? (
                <div
                    role="status"
                    className={cn(
                        "mt-4 flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-[13px] leading-relaxed text-fg",
                        verdict.ok ? "bg-okbg" : "bg-danbg",
                    )}
                >
                    {verdict.ok ? (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" strokeWidth={1.5} />
                    ) : (
                        <XCircle className="mt-0.5 size-4 shrink-0 text-dan" strokeWidth={1.5} />
                    )}
                    <span>{verdict.message}</span>
                </div>
            ) : null}
        </form>
    )
}
