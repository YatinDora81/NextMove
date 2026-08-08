"use client"

/**
 * JF-001 SEC 8.2 / 8.5 — Connected Devices client.
 *
 * Pairing is a short-lived code exchange, never a credential handoff: the web app mints an
 * 8-character single-use code (Redis, 5-minute TTL) and the extension redeems it for its own
 * device-bound JWT. Nothing here ever sees the extension's token, and nothing here ever
 * touches a Gemini key — the two vaults never cross (SEC 15.8).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import toast from "react-hot-toast"
import { useAuth } from "@/hooks/useAuth"
import { DEVICE_PAIR_CODE, DEVICE_REVOKE, DEVICES } from "@/utils/url"

/** Mirrors `deviceRowSchema` in @repo/types/ExtensionTypes. */
export type DeviceRow = {
    id: string
    name: string | null
    lastSeen: string | null
    createdAt?: string
}

/** A minted pairing code plus the wall-clock instant it stops being redeemable. */
export type PairCode = {
    code: string
    expiresAt: number
}

type ApiEnvelope<T> = {
    success: boolean
    data: T
    message: string
}

type DevicesContextType = {
    devices: DeviceRow[]
    isLoading: boolean
    isMinting: boolean
    hasLoaded: boolean
    error: string | null
    /** The live pairing code, or null when none has been minted or the last one expired. */
    pairCode: PairCode | null
    /** Whole seconds left before `pairCode` expires; 0 when there is no live code. */
    secondsLeft: number
    fetchDevices: () => Promise<void>
    generatePairCode: () => Promise<PairCode | null>
    /** Drops a live code from the UI without waiting for it to time out. */
    clearPairCode: () => void
    revokeDevice: (id: string) => Promise<boolean>
}

const DevicesContext = createContext<DevicesContextType | null>(null)

/** How often we re-poll the device list while a pairing code is live. */
const PAIRING_POLL_MS = 6000

function toDeviceRow(raw: unknown): DeviceRow | null {
    if (typeof raw !== "object" || raw === null) return null
    const row = raw as Record<string, unknown>
    if (typeof row.id !== "string") return null
    const createdAt = typeof row.createdAt === "string" ? row.createdAt : undefined
    return {
        id: row.id,
        name: typeof row.name === "string" ? row.name : null,
        lastSeen: typeof row.lastSeen === "string" ? row.lastSeen : null,
        ...(createdAt !== undefined ? { createdAt } : {}),
    }
}

function errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message
    return fallback
}

export const DevicesProvider = ({ children }: { children: React.ReactNode }) => {
    const [devices, setDevices] = useState<DeviceRow[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [isMinting, setIsMinting] = useState(false)
    const [hasLoaded, setHasLoaded] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [pairCode, setPairCode] = useState<PairCode | null>(null)
    const [now, setNow] = useState<number>(() => Date.now())
    const { getToken, isSignedIn, isLoaded } = useAuth()

    const mountedRef = useRef(true)
    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [])

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        const token = await getToken()
        if (!token) throw new Error("You are signed out — sign in again to manage devices")
        return {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        }
    }, [getToken])

    const fetchDevices = useCallback(async () => {
        try {
            setIsLoading(true)
            const headers = await authHeaders()
            const res = await fetch(DEVICES, { method: "GET", headers })
            const body = (await res.json()) as ApiEnvelope<unknown>
            if (!body.success) throw new Error(body.message || "Could not load your devices")
            const rows = Array.isArray(body.data) ? body.data : []
            const parsed = rows
                .map(toDeviceRow)
                .filter((row): row is DeviceRow => row !== null)
            if (!mountedRef.current) return
            setDevices(parsed)
            setError(null)
        } catch (err) {
            if (!mountedRef.current) return
            setError(errorMessage(err, "Could not load your devices"))
        } finally {
            if (mountedRef.current) {
                setIsLoading(false)
                setHasLoaded(true)
            }
        }
    }, [authHeaders])

    /** POST /api/devices/pair-code — single-use, 5-minute TTL, resolved server-side to this user. */
    const generatePairCode = useCallback(async (): Promise<PairCode | null> => {
        try {
            setIsMinting(true)
            const headers = await authHeaders()
            const res = await fetch(DEVICE_PAIR_CODE, { method: "POST", headers })
            const body = (await res.json()) as ApiEnvelope<unknown>
            if (!body.success) throw new Error(body.message || "Could not create a pairing code")
            const data = (typeof body.data === "object" && body.data !== null)
                ? (body.data as Record<string, unknown>)
                : {}
            const code = typeof data.code === "string" ? data.code : ""
            if (!code) throw new Error("The server did not return a pairing code")
            const expiresInSec = typeof data.expiresInSec === "number" && data.expiresInSec > 0
                ? data.expiresInSec
                : 300
            const minted: PairCode = { code, expiresAt: Date.now() + expiresInSec * 1000 }
            if (mountedRef.current) {
                setPairCode(minted)
                setNow(Date.now())
                setError(null)
            }
            return minted
        } catch (err) {
            const message = errorMessage(err, "Could not create a pairing code")
            toast.error(message)
            if (mountedRef.current) setError(message)
            return null
        } finally {
            if (mountedRef.current) setIsMinting(false)
        }
    }, [authHeaders])

    const clearPairCode = useCallback(() => {
        setPairCode(null)
    }, [])

    /**
     * DELETE /api/devices/:id — deletes the Device row. The device's already-issued JWT keeps
     * working until it next refreshes, which is exactly what the panel tells the user.
     */
    const revokeDevice = useCallback(async (id: string): Promise<boolean> => {
        const snapshot = devices
        try {
            // Optimistic removal, restored below if the API refuses.
            setDevices((prev) => prev.filter((d) => d.id !== id))
            const headers = await authHeaders()
            const res = await fetch(DEVICE_REVOKE(id), { method: "DELETE", headers })
            const body = (await res.json()) as ApiEnvelope<unknown>
            if (!body.success) {
                if (mountedRef.current) setDevices(snapshot)
                toast.error(body.message || "Could not revoke that device")
                return false
            }
            toast.success(body.message || "Device revoked")
            return true
        } catch (err) {
            if (mountedRef.current) setDevices(snapshot)
            toast.error(errorMessage(err, "Could not revoke that device"))
            return false
        }
    }, [authHeaders, devices])

    useEffect(() => {
        if (!isLoaded || !isSignedIn) return
        void fetchDevices()
    }, [isLoaded, isSignedIn, fetchDevices])

    // One shared 1s tick drives the expiry countdown; it only runs while a code is live.
    useEffect(() => {
        if (!pairCode) return
        setNow(Date.now())
        const id = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(id)
    }, [pairCode])

    const secondsLeft = useMemo(() => {
        if (!pairCode) return 0
        return Math.max(0, Math.ceil((pairCode.expiresAt - now) / 1000))
    }, [pairCode, now])

    // A code that has run out is not redeemable any more — stop showing it.
    useEffect(() => {
        if (pairCode && secondsLeft <= 0) setPairCode(null)
    }, [pairCode, secondsLeft])

    // While a code is live the user is mid-pairing, so poll for the new device row.
    useEffect(() => {
        if (!pairCode) return
        const id = window.setInterval(() => {
            void fetchDevices()
        }, PAIRING_POLL_MS)
        return () => window.clearInterval(id)
    }, [pairCode, fetchDevices])

    const value = useMemo<DevicesContextType>(() => ({
        devices,
        isLoading,
        isMinting,
        hasLoaded,
        error,
        pairCode,
        secondsLeft,
        fetchDevices,
        generatePairCode,
        clearPairCode,
        revokeDevice,
    }), [
        devices, isLoading, isMinting, hasLoaded, error, pairCode, secondsLeft,
        fetchDevices, generatePairCode, clearPairCode, revokeDevice,
    ])

    return <DevicesContext.Provider value={value}>{children}</DevicesContext.Provider>
}

export const useDevices = () => {
    const context = useContext(DevicesContext)
    if (!context) {
        throw new Error("useDevices must be used within a DevicesProvider")
    }
    return context
}

/** `mm:ss` for the pair-code expiry and the SEC 5.6 cooldown copy. */
export function formatCountdown(totalSeconds: number): string {
    const safe = Math.max(0, Math.floor(totalSeconds))
    const minutes = Math.floor(safe / 60)
    const seconds = safe % 60
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

/** Human "last seen" for the device table; null timestamps read as "never". */
export function formatLastSeen(iso: string | null): string {
    if (!iso) return "Never"
    const parsed = Date.parse(iso)
    if (Number.isNaN(parsed)) return "Unknown"
    const deltaMs = Date.now() - parsed
    if (deltaMs < 60_000) return "Just now"
    const minutes = Math.floor(deltaMs / 60_000)
    if (minutes < 60) return `${minutes} min ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} hr ago`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`
    return new Date(parsed).toLocaleDateString()
}
