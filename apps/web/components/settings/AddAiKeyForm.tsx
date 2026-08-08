"use client"

/**
 * JF-001 SEC 15.7 — the paste-and-test field, shared by Settings → AI Keys and onboarding.
 *
 * One action, not two: "Test & Save" validates the key live against Google (cheapest possible
 * `models.list` call) and only stores it if Google accepts, so a broken key can never sit in the
 * vault pretending to be fine. The verdict is rendered inline, verbatim from the server, because
 * "API key not valid" and "this key is not restricted to the Gemini API" need completely
 * different fixes from the user.
 *
 * The input is `type="password"` and there is deliberately **no reveal control** — the vault is
 * write-only end to end (SEC 15.8), and a reveal button here would be the one place in the
 * product where a key is rendered back to a screen.
 */

import { useState } from "react"
import { CheckCircle2, Loader2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAiKeys, type AiKeyVerdict } from "@/hooks/useAiKeys"
import { cn } from "@/lib/utils"

/** Matches `addAiKeySchema` in @repo/types/AiKeyTypes so the client rejects before the round-trip. */
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

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
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
            // Plaintext lives exactly as long as the request. Clear it the moment it is sealed.
            setKeyValue("")
            setLabel("")
            onSaved?.(result)
        }
        setSubmitting(false)
    }

    const busy = submitting || isMutating

    return (
        <form onSubmit={handleSubmit} className={cn("flex flex-col gap-4", className)}>
            <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
                <div className="flex flex-col gap-2">
                    <Label htmlFor="ai-key-label">Label</Label>
                    <Input
                        id="ai-key-label"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="Personal"
                        maxLength={MAX_LABEL_LENGTH}
                        autoComplete="off"
                        disabled={busy}
                    />
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor="ai-key-value">Gemini API key</Label>
                    {/* type=password: the key is never echoed, and there is no reveal toggle. */}
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
                    />
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={busy || trimmedKey.length === 0}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                    {busy ? "Checking with Google…" : submitLabel}
                </Button>
                <p className="text-xs text-muted-foreground">
                    We call Google once to confirm the key works before storing it.
                </p>
            </div>

            {verdict ? (
                <div
                    role="status"
                    className={cn(
                        "flex items-start gap-2 rounded-lg border p-3 text-sm",
                        verdict.ok
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                            : "border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-200",
                    )}
                >
                    {verdict.ok ? (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                    ) : (
                        <XCircle className="mt-0.5 size-4 shrink-0" />
                    )}
                    <span className="leading-relaxed">{verdict.message}</span>
                </div>
            ) : null}
        </form>
    )
}
