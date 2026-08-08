"use client"

/**
 * JF-001 SEC 15.5 / 15.7 — client for the write-only Gemini key vault.
 *
 * The vault is write-only by design: the only plaintext key that ever exists on this side
 * is the string sitting in the "Test & Save" password field for the duration of one POST.
 * Nothing in this module stores, caches, echoes or logs a key — every piece of state below
 * is the masked `AiKeyPublic` shape (id, label, last4, status). There is no reveal call
 * because no reveal route exists (SEC 15.8).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import toast from "react-hot-toast"
import { useAuth } from "@/hooks/useAuth"
import { AI_KEYS, AI_KEY_DELETE, AI_KEY_TEST } from "@/utils/url"

/** Mirrors `aiKeyStatusSchema` in @repo/types/AiKeyTypes and the `AiKeyStatus` Prisma enum. */
export type AiKeyStatus = "ACTIVE" | "COOLDOWN" | "EXHAUSTED" | "DEAD"

/** Mirrors `aiKeyPublicSchema` — the ONLY shape the API is allowed to return. */
export type AiKeyPublic = {
    id: string
    label: string
    last4: string
    status: AiKeyStatus
    lastUsedAt: string | null
    createdAt: string
}

/** Mirrors `aiKeyTestResultSchema`. `message` carries Google's verdict verbatim (SEC 15.7). */
export type AiKeyTestResult = {
    id: string
    status: AiKeyStatus
    ok: boolean
    message: string
}

/** Outcome of a mutation, shaped for an inline verdict line rather than a toast alone. */
export type AiKeyVerdict = {
    ok: boolean
    message: string
}

type ApiEnvelope<T> = {
    success: boolean
    data: T
    message: string
}

type AiKeysContextType = {
    keys: AiKeyPublic[]
    isLoading: boolean
    /** True while an add/test/delete round-trip is in flight. */
    isMutating: boolean
    /** Ids currently being re-validated against Google, for per-row spinners. */
    testingIds: string[]
    /** Last transport/auth failure of the list call, so panels can show a retry affordance. */
    error: string | null
    /** True once a list call has settled at least once — distinguishes "empty" from "not loaded". */
    hasLoaded: boolean
    /** Any key Google has rejected — drives the SEC 15.7 "DEAD key → badge + banner" surface. */
    deadKeys: AiKeyPublic[]
    /** Keys that can serve a request right now. */
    activeKeyCount: number
    fetchKeys: () => Promise<void>
    addKey: (key: string, label: string) => Promise<AiKeyVerdict>
    testKey: (id: string) => Promise<AiKeyVerdict>
    deleteKey: (id: string) => Promise<boolean>
}

const AiKeysContext = createContext<AiKeysContextType | null>(null)

const STATUS_VALUES: readonly AiKeyStatus[] = ["ACTIVE", "COOLDOWN", "EXHAUSTED", "DEAD"]

function isAiKeyStatus(value: unknown): value is AiKeyStatus {
    return typeof value === "string" && (STATUS_VALUES as readonly string[]).includes(value)
}

/**
 * Narrows an untrusted API row to `AiKeyPublic`. A row that carries anything unexpected is
 * dropped rather than rendered — a masked list must never render a half-parsed record.
 */
function toAiKeyPublic(raw: unknown): AiKeyPublic | null {
    if (typeof raw !== "object" || raw === null) return null
    const row = raw as Record<string, unknown>
    if (typeof row.id !== "string" || typeof row.label !== "string") return null
    if (typeof row.last4 !== "string" || !isAiKeyStatus(row.status)) return null
    return {
        id: row.id,
        label: row.label,
        last4: row.last4,
        status: row.status,
        lastUsedAt: typeof row.lastUsedAt === "string" ? row.lastUsedAt : null,
        createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
    }
}

function toTestResult(raw: unknown, fallbackId: string): AiKeyTestResult | null {
    if (typeof raw !== "object" || raw === null) return null
    const row = raw as Record<string, unknown>
    if (!isAiKeyStatus(row.status)) return null
    return {
        id: typeof row.id === "string" ? row.id : fallbackId,
        status: row.status,
        ok: row.ok === true,
        message: typeof row.message === "string" ? row.message : "",
    }
}

function errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message
    return fallback
}

export const AiKeysProvider = ({ children }: { children: React.ReactNode }) => {
    const [keys, setKeys] = useState<AiKeyPublic[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [isMutating, setIsMutating] = useState(false)
    const [testingIds, setTestingIds] = useState<string[]>([])
    const [error, setError] = useState<string | null>(null)
    const [hasLoaded, setHasLoaded] = useState(false)
    const { getToken, isSignedIn, isLoaded } = useAuth()

    // Guards against a state update landing after the provider has unmounted (settings panels
    // are behind tab routes, so this happens routinely when a user tabs away mid-request).
    const mountedRef = useRef(true)
    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [])

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        const token = await getToken()
        if (!token) throw new Error("You are signed out — sign in again to manage your keys")
        return {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        }
    }, [getToken])

    const fetchKeys = useCallback(async () => {
        try {
            setIsLoading(true)
            const headers = await authHeaders()
            const res = await fetch(AI_KEYS, { method: "GET", headers })
            const body = (await res.json()) as ApiEnvelope<unknown>
            if (!body.success) {
                throw new Error(body.message || "Could not load your keys")
            }
            const rows = Array.isArray(body.data) ? body.data : []
            const parsed = rows
                .map(toAiKeyPublic)
                .filter((row): row is AiKeyPublic => row !== null)
            if (!mountedRef.current) return
            setKeys(parsed)
            setError(null)
        } catch (err) {
            if (!mountedRef.current) return
            setError(errorMessage(err, "Could not load your keys"))
        } finally {
            if (mountedRef.current) {
                setIsLoading(false)
                setHasLoaded(true)
            }
        }
    }, [authHeaders])

    /**
     * POST /api/ai-keys — the server live-validates against Google, seals with AES-256-GCM and
     * drops the plaintext. `key` is never held in this module beyond this call frame, and the
     * response carries only the masked row.
     */
    const addKey = useCallback(async (key: string, label: string): Promise<AiKeyVerdict> => {
        try {
            setIsMutating(true)
            const headers = await authHeaders()
            const res = await fetch(AI_KEYS, {
                method: "POST",
                headers,
                body: JSON.stringify({ key, label }),
            })
            const body = (await res.json()) as ApiEnvelope<unknown>
            if (!body.success) {
                // Google's rejection reason is surfaced verbatim — "unrestricted standard key"
                // and "API key not valid" read very differently to a user (SEC 15.7).
                const message = body.message || "Google rejected that key"
                toast.error(message)
                return { ok: false, message }
            }
            const row = toAiKeyPublic(body.data)
            if (row && mountedRef.current) {
                setKeys((prev) => [...prev.filter((k) => k.id !== row.id), row])
            } else if (mountedRef.current) {
                // Unexpected payload shape — fall back to a re-list so the UI is never stale.
                void fetchKeys()
            }
            const message = body.message || "Key verified and saved"
            toast.success(message)
            return { ok: true, message }
        } catch (err) {
            const message = errorMessage(err, "Could not save that key")
            toast.error(message)
            return { ok: false, message }
        } finally {
            if (mountedRef.current) setIsMutating(false)
        }
    }, [authHeaders, fetchKeys])

    /** POST /api/ai-keys/:id/test — re-validates on demand and flips DEAD ↔ ACTIVE. */
    const testKey = useCallback(async (id: string): Promise<AiKeyVerdict> => {
        try {
            setIsMutating(true)
            setTestingIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
            const headers = await authHeaders()
            const res = await fetch(AI_KEY_TEST(id), { method: "POST", headers })
            const body = (await res.json()) as ApiEnvelope<unknown>
            const result = toTestResult(body.data, id)
            if (result && mountedRef.current) {
                setKeys((prev) =>
                    prev.map((k) => (k.id === id ? { ...k, status: result.status } : k)),
                )
            }
            const ok = body.success && (result?.ok ?? false)
            const message = result?.message || body.message || (ok ? "Key is working" : "Key failed validation")
            if (ok) toast.success(message)
            else toast.error(message)
            return { ok, message }
        } catch (err) {
            const message = errorMessage(err, "Could not reach the key vault")
            toast.error(message)
            return { ok: false, message }
        } finally {
            if (mountedRef.current) {
                setIsMutating(false)
                setTestingIds((prev) => prev.filter((testingId) => testingId !== id))
            }
        }
    }, [authHeaders])

    /** DELETE /api/ai-keys/:id — hard delete; the ciphertext row is shredded server-side. */
    const deleteKey = useCallback(async (id: string): Promise<boolean> => {
        const snapshot = keys
        try {
            setIsMutating(true)
            // Optimistic: the row disappears immediately, and is restored below if the API says no.
            setKeys((prev) => prev.filter((k) => k.id !== id))
            const headers = await authHeaders()
            const res = await fetch(AI_KEY_DELETE(id), { method: "DELETE", headers })
            const body = (await res.json()) as ApiEnvelope<unknown>
            if (!body.success) {
                if (mountedRef.current) setKeys(snapshot)
                toast.error(body.message || "Could not delete that key")
                return false
            }
            toast.success(body.message || "Key deleted")
            return true
        } catch (err) {
            if (mountedRef.current) setKeys(snapshot)
            toast.error(errorMessage(err, "Could not delete that key"))
            return false
        } finally {
            if (mountedRef.current) setIsMutating(false)
        }
    }, [authHeaders, keys])

    useEffect(() => {
        if (!isLoaded || !isSignedIn) return
        void fetchKeys()
    }, [isLoaded, isSignedIn, fetchKeys])

    const deadKeys = useMemo(() => keys.filter((k) => k.status === "DEAD"), [keys])
    const activeKeyCount = useMemo(() => keys.filter((k) => k.status === "ACTIVE").length, [keys])

    const value = useMemo<AiKeysContextType>(() => ({
        keys,
        isLoading,
        isMutating,
        testingIds,
        error,
        hasLoaded,
        deadKeys,
        activeKeyCount,
        fetchKeys,
        addKey,
        testKey,
        deleteKey,
    }), [
        keys, isLoading, isMutating, testingIds, error, hasLoaded,
        deadKeys, activeKeyCount, fetchKeys, addKey, testKey, deleteKey,
    ])

    return <AiKeysContext.Provider value={value}>{children}</AiKeysContext.Provider>
}

export const useAiKeys = () => {
    const context = useContext(AiKeysContext)
    if (!context) {
        throw new Error("useAiKeys must be used within an AiKeysProvider")
    }
    return context
}

/**
 * Display form for a vaulted key: `AIza…9F2k` (SEC 15.7).
 * `AIza` is the fixed public prefix of every Google API key — it is not secret material, and
 * `last4` is the entire rest of the display surface the vault will ever hand out.
 */
export function maskedKeyDisplay(last4: string): string {
    return `AIza…${last4}`
}
