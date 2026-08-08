"use client"

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react"
import { createEmptyProfile } from "@repo/types/ProfileTypes"
import type { SharedProfile } from "@repo/types/ProfileTypes"
import { isVaultError } from "@repo/vault"
import { useAuth } from "@/hooks/useAuth"
import {
    downloadRecoveryKey,
    fetchProfileEnvelope,
    generateVaultKey,
    openVault,
    putProfileEnvelope,
    readVaultKey,
    sealVault,
    writeVaultKey,
} from "@/lib/vault"

export type VaultFailureKind = "network" | "vault" | "auth" | "unknown"

export interface ProfileVaultState {
    status: "idle" | "loading" | "ready" | "error"
    profile: SharedProfile | null
    vaultKey: string | null
    version: number
    error: string | null
    errorKind: VaultFailureKind | null
    saving: boolean
}

export interface ProfileVaultApi extends ProfileVaultState {
    load(): Promise<void>
    ensureVaultKey(): Promise<string>
    update(patch: Partial<SharedProfile>): void
    save(): Promise<boolean>
    exportRecoveryKey(): void
}

interface VaultData {
    profiles: SharedProfile[]
    activeProfileId: string | null
    version: number
}

const DEFAULT_PROFILE_LABEL = "Default"

function newProfileId(): string {
    const c = globalThis.crypto
    if (typeof c?.randomUUID === "function") return c.randomUUID()
    return `profile-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
}

function seedProfile(): SharedProfile {
    return { ...createEmptyProfile(newProfileId(), DEFAULT_PROFILE_LABEL, Date.now()), isDefault: true }
}

function pickActive(profiles: readonly SharedProfile[], activeId: string | null): SharedProfile | null {
    if (profiles.length === 0) return null
    if (activeId !== null) {
        const match = profiles.find((p) => p.id === activeId)
        if (match !== undefined) return match
    }
    return profiles.find((p) => p.isDefault) ?? profiles[0] ?? null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function applyPatch(base: SharedProfile, patch: Partial<SharedProfile>): SharedProfile {
    const next: SharedProfile = { ...base }
    for (const key of Object.keys(patch) as (keyof SharedProfile)[]) {
        if (key === "id") continue
        const incoming = patch[key]
        if (incoming === undefined) continue
        const current = base[key]
        const merged = isPlainObject(current) && isPlainObject(incoming)
            ? { ...current, ...incoming }
            : incoming
        Object.assign(next, { [key]: merged })
    }
    if (patch.updatedAt === undefined) next.updatedAt = Date.now()
    return next
}

export function mergeProfileLists(
    local: readonly SharedProfile[],
    remote: readonly SharedProfile[],
): SharedProfile[] {
    const byId = new Map<string, SharedProfile>()
    for (const profile of local) byId.set(profile.id, profile)
    for (const incoming of remote) {
        const existing = byId.get(incoming.id)
        if (existing === undefined || incoming.updatedAt > existing.updatedAt) {
            byId.set(incoming.id, incoming)
        }
    }

    const merged = [...byId.values()]
    const defaults = merged.filter((p) => p.isDefault)
    if (merged.length > 0 && defaults.length !== 1) {
        const pool = defaults.length > 1 ? defaults : merged
        const winner = pool.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
        return merged.map((p) => ({ ...p, isDefault: p.id === winner.id }))
    }
    return merged
}

interface Failure {
    kind: VaultFailureKind
    message: string
}

function isNetworkFailure(error: unknown): boolean {
    if (error instanceof TypeError) return true
    if (!(error instanceof Error)) return false
    return /failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(
        error.message,
    )
}

function classifyFailure(error: unknown, fallback: string): Failure {
    if (isVaultError(error)) {
        if (error.code === "decrypt-failed") {
            return {
                kind: "vault",
                message:
                    "This browser's vault key can't open the profile stored on your account. Restore the recovery key you downloaded, or start a new profile on this browser.",
            }
        }
        if (error.code === "unavailable") {
            return {
                kind: "vault",
                message:
                    "Your browser blocked the encryption API. NextMove needs an https:// page to seal your profile.",
            }
        }
        return { kind: "vault", message: error.message }
    }
    if (isNetworkFailure(error)) {
        return {
            kind: "network",
            message:
                "We couldn't reach NextMove. Your profile is safe — this is a connection problem, not a problem with your data.",
        }
    }
    if (error instanceof Error && /signed out|unauthor/i.test(error.message)) {
        return { kind: "auth", message: error.message }
    }
    if (error instanceof Error && error.message.length > 0) {
        return { kind: "unknown", message: error.message }
    }
    return { kind: "unknown", message: fallback }
}

const ProfileVaultContext = createContext<ProfileVaultApi | null>(null)

export function ProfileVaultProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
    const { getToken } = useAuth()

    const [status, setStatus] = useState<ProfileVaultState["status"]>("idle")
    const [error, setError] = useState<string | null>(null)
    const [errorKind, setErrorKind] = useState<VaultFailureKind | null>(null)
    const [saving, setSaving] = useState(false)
    const [vaultKey, setVaultKey] = useState<string | null>(null)
    const [data, setData] = useState<VaultData>({ profiles: [], activeProfileId: null, version: 0 })

    const dataRef = useRef<VaultData>(data)
    const keyRef = useRef<string | null>(null)
    const savingRef = useRef(false)

    const commit = useCallback((next: VaultData) => {
        dataRef.current = next
        setData(next)
    }, [])

    const materializeKey = useCallback((): string => {
        const existing = keyRef.current ?? readVaultKey()
        if (existing !== null) {
            if (keyRef.current !== existing) {
                keyRef.current = existing
                setVaultKey(existing)
            }
            return existing
        }

        const minted = generateVaultKey()
        keyRef.current = minted
        setVaultKey(minted)
        if (!writeVaultKey(minted)) {
            setError(
                "This browser won't let NextMove store your encryption key (private browsing, or site data is blocked). Download your recovery key before you close this tab, or it is gone.",
            )
            setErrorKind("vault")
        }
        return minted
    }, [])

    const ensureVaultKey = useCallback(async (): Promise<string> => {
        return materializeKey()
    }, [materializeKey])

    const requireToken = useCallback(async (): Promise<string> => {
        const token = await getToken()
        if (token === null || token.length === 0) {
            throw new Error("You're signed out — sign in again to sync your profile.")
        }
        return token
    }, [getToken])

    const load = useCallback(async (): Promise<void> => {
        setStatus("loading")
        setError(null)
        setErrorKind(null)
        try {
            const key = materializeKey()
            const token = await requireToken()
            const envelope = await fetchProfileEnvelope(token)

            if (envelope === null) {
                const seeded = seedProfile()
                commit({ profiles: [seeded], activeProfileId: seeded.id, version: 0 })
                setStatus("ready")
                return
            }

            const vault = await openVault(envelope, key)
            const profiles = vault.profiles.length > 0 ? vault.profiles : [seedProfile()]
            commit({
                profiles,
                activeProfileId: pickActive(profiles, vault.activeProfileId)?.id ?? null,
                version: envelope.version,
            })
            setStatus("ready")
        } catch (err) {
            const failure = classifyFailure(err, "Could not load your profile.")
            setError(failure.message)
            setErrorKind(failure.kind)
            setStatus("error")
        }
    }, [commit, materializeKey, requireToken])

    const update = useCallback((patch: Partial<SharedProfile>) => {
        const current = dataRef.current
        const profiles = current.profiles.length > 0 ? current.profiles : [seedProfile()]
        const active = pickActive(profiles, current.activeProfileId)
        if (active === null) return
        commit({
            ...current,
            profiles: profiles.map((p) => (p.id === active.id ? applyPatch(p, patch) : p)),
            activeProfileId: active.id,
        })
    }, [commit])

    const save = useCallback(async (): Promise<boolean> => {
        if (status === "error" && dataRef.current.version > 0) {
            setError(
                "NextMove won't overwrite a profile it can't read. Restore your recovery key first.",
            )
            setErrorKind("vault")
            return false
        }
        if (savingRef.current) return false
        savingRef.current = true
        setSaving(true)
        setError(null)
        setErrorKind(null)

        try {
            const key = materializeKey()
            const token = await requireToken()

            const before = dataRef.current
            const first = await putProfileEnvelope(
                token,
                await sealVault(before.profiles, before.activeProfileId, key, before.version + 1),
            )
            if (first.ok) {
                commit({ ...dataRef.current, version: first.version })
                return true
            }
            if (first.reason !== "conflict") {
                setError(first.message)
                setErrorKind(first.reason === "rejected" ? "vault" : "unknown")
                return false
            }

            const remote = await fetchProfileEnvelope(token)
            const remoteVault = remote === null ? null : await openVault(remote, key)
            const local = dataRef.current
            const merged = mergeProfileLists(local.profiles, remoteVault?.profiles ?? [])
            const activeId =
                pickActive(merged, local.activeProfileId ?? remoteVault?.activeProfileId ?? null)?.id ?? null
            const baseVersion = Math.max(remote?.version ?? 0, first.currentVersion)

            const retry = await putProfileEnvelope(
                token,
                await sealVault(merged, activeId, key, baseVersion + 1),
            )
            if (!retry.ok) {
                commit({ profiles: merged, activeProfileId: activeId, version: baseVersion })
                setError(retry.message)
                setErrorKind("unknown")
                return false
            }
            commit({ profiles: merged, activeProfileId: activeId, version: retry.version })
            return true
        } catch (err) {
            const failure = classifyFailure(err, "Could not save your profile.")
            setError(failure.message)
            setErrorKind(failure.kind)
            return false
        } finally {
            savingRef.current = false
            setSaving(false)
        }
    }, [commit, materializeKey, requireToken, status])

    const exportRecoveryKey = useCallback((): void => {
        downloadRecoveryKey(materializeKey())
    }, [materializeKey])

    const profile = useMemo(
        () => pickActive(data.profiles, data.activeProfileId),
        [data],
    )

    const value = useMemo<ProfileVaultApi>(() => ({
        status,
        profile,
        vaultKey,
        version: data.version,
        error,
        errorKind,
        saving,
        load,
        ensureVaultKey,
        update,
        save,
        exportRecoveryKey,
    }), [
        status, profile, vaultKey, data.version, error, errorKind, saving,
        load, ensureVaultKey, update, save, exportRecoveryKey,
    ])

    return <ProfileVaultContext.Provider value={value}>{children}</ProfileVaultContext.Provider>
}

export function useProfileVault(): ProfileVaultApi {
    const context = useContext(ProfileVaultContext)
    if (context === null) {
        throw new Error("useProfileVault must be used within a ProfileVaultProvider")
    }
    return context
}
