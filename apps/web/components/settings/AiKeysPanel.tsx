"use client"

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
import { Button } from "@/components/quiet/Button"
import { Card, Well } from "@/components/quiet/Card"
import { AddAiKeyForm } from "@/components/settings/AddAiKeyForm"
import { AuthKeyNotice } from "@/components/settings/AuthKeyNotice"
import { DeadKeyBanner } from "@/components/settings/DeadKeyBanner"
import { HonestLimitsNotice } from "@/components/settings/HonestLimitsNotice"
import { KeyStatusBadge, STATUS_HELP } from "@/components/settings/KeyStatusBadge"
import { formatLastSeen } from "@/hooks/useDevices"
import { maskedKeyDisplay, useAiKeys, type AiKeyPublic } from "@/hooks/useAiKeys"

const ROTATION_EXPLAINER =
    "NextMove rotates across every key you add — more keys = more free quota."

const ROW_BUTTON = "px-2.5 py-1.5 text-[12.5px]"

function AiKeyRow({ row }: { row: AiKeyPublic }) {
    const { testKey, deleteKey, testingIds } = useAiKeys()
    const [deleting, setDeleting] = useState(false)
    const testing = testingIds.includes(row.id)

    const handleDelete = async () => {
        setDeleting(true)
        await deleteKey(row.id)
        setDeleting(false)
    }

    return (
        <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hair px-4 py-3.5 last:border-b-0">
            <KeyRound className="size-4 shrink-0 text-fg2" strokeWidth={1.5} />

            <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[13px] text-fg">
                    {maskedKeyDisplay(row.last4)}
                </div>
                <div className="truncate text-xs text-fg2">
                    {row.label}
                    <span className="mx-1.5 text-fg3">·</span>
                    last used {formatLastSeen(row.lastUsedAt).toLowerCase()}
                </div>
            </div>

            <KeyStatusBadge status={row.status} />

            <div className="flex shrink-0 items-center gap-1">
                <Button
                    variant="ghost"
                    className={ROW_BUTTON}
                    onClick={() => void testKey(row.id)}
                    disabled={testing || deleting}
                >
                    {testing ? (
                        <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                        <RefreshCw className="size-3.5" strokeWidth={1.5} />
                    )}
                    Test
                </Button>

                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button
                            variant="danger"
                            className={ROW_BUTTON}
                            disabled={deleting}
                            aria-label={`Delete ${row.label}`}
                        >
                            <Trash2 className="size-3.5" strokeWidth={1.5} />
                            Delete
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="rounded-xl border-hair bg-surface shadow-qmd">
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-[16px] tracking-[-0.01em] text-fg">
                                Delete {row.label}?
                            </AlertDialogTitle>
                            <AlertDialogDescription className="text-[13px] leading-relaxed text-fg2">
                                The stored ciphertext for {maskedKeyDisplay(row.last4)} is destroyed
                                immediately and cannot be recovered — we never had a copy you could get
                                back. The key itself still exists in your Google account; delete it there
                                too if you want it gone for good.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel className="rounded-lg border-hair2 bg-surface text-[13.5px] font-medium text-fg shadow-qsm hover:bg-well hover:text-fg">
                                Keep it
                            </AlertDialogCancel>
                            <AlertDialogAction
                                className="rounded-lg border border-dan/40 bg-danbg text-[13.5px] font-medium text-dan shadow-none hover:bg-dan/15"
                                onClick={() => void handleDelete()}
                            >
                                Delete key
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>

            {row.status !== "ACTIVE" ? (
                <p className="basis-full text-xs text-fg2">{STATUS_HELP[row.status]}</p>
            ) : null}
        </li>
    )
}

export function AiKeysPanel() {
    const { keys, isLoading, hasLoaded, error, deadKeys, fetchKeys } = useAiKeys()
    const [addOpen, setAddOpen] = useState(false)

    const hasKeys = keys.length > 0
    const showForm = !hasKeys || addOpen

    return (
        <div className="max-w-[600px]">
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[20px] font-[650] tracking-[-0.02em] text-fg">AI keys</h1>
                {hasKeys ? (
                    <Button
                        variant="sec"
                        className="ml-auto px-3 py-1.5 text-[13px]"
                        onClick={() => setAddOpen((v) => !v)}
                    >
                        <Plus className="size-3.5" strokeWidth={1.5} />
                        Add another key
                    </Button>
                ) : null}
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-fg2">{ROTATION_EXPLAINER}</p>

            <DeadKeyBanner deadKeys={deadKeys} className="mt-4" />

            {error ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dan/40 bg-danbg px-4 py-3 text-[13px] text-fg">
                    <span>{error}</span>
                    <Button variant="sec" className="px-3 py-1.5 text-[12.5px]" onClick={() => void fetchKeys()}>
                        Try again
                    </Button>
                </div>
            ) : null}

            {isLoading && !hasLoaded ? (
                <Well className="mt-4 flex items-center gap-2 px-4 py-3.5 text-[13px] text-fg2">
                    <Loader2 className="size-4 animate-spin" />
                    Loading your keys…
                </Well>
            ) : null}

            {hasKeys ? (
                <Card className="mt-4 overflow-hidden">
                    <ul>
                        {keys.map((row) => (
                            <AiKeyRow key={row.id} row={row} />
                        ))}
                    </ul>
                </Card>
            ) : hasLoaded && !error ? (
                <Well className="mt-4 flex flex-col items-center gap-2 px-4 py-8 text-center">
                    <KeyRound className="size-4 text-fg2" strokeWidth={1.5} />
                    <p className="text-[13.5px] font-semibold text-fg">No keys yet</p>
                    <p className="max-w-[46ch] text-[13px] leading-relaxed text-fg2">
                        AI features stay switched off until you add one. It is free, it takes about
                        two minutes, and you can remove it whenever you like.
                    </p>
                </Well>
            ) : null}

            {showForm ? (
                <Card className="mt-4 p-5">
                    <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">
                        {hasKeys ? "Add another key" : "Add your first key"}
                    </h2>
                    <p className="mt-1 text-[13px] leading-relaxed text-fg2">
                        Free-tier limits are set by Google, are approximate, and change without
                        notice — a second key roughly doubles the headroom you get.
                    </p>

                    <AuthKeyNotice className="mt-4" />

                    <AddAiKeyForm className="mt-4" onSaved={() => setAddOpen(false)} />

                    <HonestLimitsNotice className="mt-4" />
                </Card>
            ) : null}
        </div>
    )
}
