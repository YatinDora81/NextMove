"use client"

/**
 * JF-001 SEC 15.7 — Settings → AI Keys.
 *
 * The whole panel is built on one rule: the vault is write-only. Rows render `AIza…9F2k` and a
 * status badge, and that is the complete display surface — there is no reveal control anywhere
 * in this file, because no route exists that could feed one (SEC 15.5 / 15.8).
 */

import { useState } from "react"
import { KeyRound, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { AddAiKeyForm } from "@/components/settings/AddAiKeyForm"
import { AuthKeyNotice } from "@/components/settings/AuthKeyNotice"
import { DeadKeyBanner } from "@/components/settings/DeadKeyBanner"
import { HonestLimitsNotice } from "@/components/settings/HonestLimitsNotice"
import { KeyStatusBadge, STATUS_HELP } from "@/components/settings/KeyStatusBadge"
import { formatLastSeen } from "@/hooks/useDevices"
import { maskedKeyDisplay, useAiKeys, type AiKeyPublic } from "@/hooks/useAiKeys"

/** SEC 15.6 — the pool is rotated LRU, so every extra key is extra free throughput. */
const ROTATION_EXPLAINER =
    "NextMove rotates across every key you add — more keys = more free quota."

function AiKeyRow({ row }: { row: AiKeyPublic }) {
    const { testKey, deleteKey, testingIds } = useAiKeys()
    const [deleting, setDeleting] = useState(false)
    const testing = testingIds.includes(row.id)

    const handleDelete = async () => {
        setDeleting(true)
        await deleteKey(row.id)
        // The row unmounts on success; on failure it is restored and the button must be usable.
        setDeleting(false)
    }

    return (
        <li className="flex flex-col gap-3 border-b border-border px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold tracking-tight">
                        {maskedKeyDisplay(row.last4)}
                    </span>
                    <KeyStatusBadge status={row.status} />
                </div>
                <p className="truncate text-sm text-muted-foreground">
                    {row.label}
                    <span className="mx-2 text-border">·</span>
                    last used {formatLastSeen(row.lastUsedAt).toLowerCase()}
                </p>
                {row.status !== "ACTIVE" ? (
                    <p className="text-xs text-muted-foreground">{STATUS_HELP[row.status]}</p>
                ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void testKey(row.id)}
                    disabled={testing || deleting}
                >
                    {testing ? (
                        <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                        <RefreshCw className="size-3.5" />
                    )}
                    Test
                </Button>

                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" disabled={deleting} aria-label={`Delete ${row.label}`}>
                            <Trash2 className="size-3.5" />
                            Delete
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete {row.label}?</AlertDialogTitle>
                            <AlertDialogDescription>
                                The stored ciphertext for {maskedKeyDisplay(row.last4)} is destroyed
                                immediately and cannot be recovered — we never had a copy you could get
                                back. The key itself still exists in your Google account; delete it there
                                too if you want it gone for good.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Keep it</AlertDialogCancel>
                            <AlertDialogAction onClick={() => void handleDelete()}>
                                Delete key
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </li>
    )
}

export function AiKeysPanel() {
    const { keys, isLoading, hasLoaded, error, deadKeys, fetchKeys } = useAiKeys()
    const [addOpen, setAddOpen] = useState(false)

    const hasKeys = keys.length > 0
    const showForm = !hasKeys || addOpen

    return (
        <div className="flex w-full flex-col gap-6">
            <DeadKeyBanner deadKeys={deadKeys} />

            <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
                <header className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                        <h2 className="font-mono text-lg font-semibold">Your Gemini keys</h2>
                        <p className="text-sm text-muted-foreground">{ROTATION_EXPLAINER}</p>
                    </div>
                    {hasKeys ? (
                        <Button size="sm" variant="outline" onClick={() => setAddOpen((v) => !v)}>
                            <Plus className="size-3.5" />
                            Add another key
                        </Button>
                    ) : null}
                </header>

                {error ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-800 dark:text-red-200">
                        <span>{error}</span>
                        <Button size="sm" variant="outline" onClick={() => void fetchKeys()}>
                            Try again
                        </Button>
                    </div>
                ) : null}

                {isLoading && !hasLoaded ? (
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        Loading your keys…
                    </div>
                ) : null}

                {hasKeys ? (
                    <ul className="divide-border overflow-hidden rounded-lg border border-border">
                        {keys.map((row) => (
                            <AiKeyRow key={row.id} row={row} />
                        ))}
                    </ul>
                ) : hasLoaded && !error ? (
                    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
                        <span className="flex size-10 items-center justify-center rounded-xl border border-border bg-muted">
                            <KeyRound className="size-5 text-muted-foreground" />
                        </span>
                        <p className="font-mono text-sm font-semibold">No keys yet</p>
                        <p className="max-w-sm text-sm text-muted-foreground">
                            AI features stay switched off until you add one. It is free, it takes about
                            two minutes, and you can remove it whenever you like.
                        </p>
                    </div>
                ) : null}
            </section>

            {showForm ? (
                <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
                    <header className="flex flex-col gap-1">
                        <h2 className="font-mono text-lg font-semibold">
                            {hasKeys ? "Add another key" : "Add your first key"}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            Free-tier limits are set by Google, are approximate, and change without
                            notice — a second key roughly doubles the headroom you get.
                        </p>
                    </header>

                    <AuthKeyNotice />

                    <AddAiKeyForm onSaved={() => setAddOpen(false)} />

                    <HonestLimitsNotice />
                </section>
            ) : null}
        </div>
    )
}
