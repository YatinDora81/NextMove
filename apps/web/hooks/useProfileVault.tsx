"use client"

/**
 * hooks/useProfileVault.tsx — the web app's copy of the profile vault (JF-001 SEC 7.4 / 8.3).
 *
 * One provider owns the whole round trip: mint or read the key, pull the ciphertext, decrypt it,
 * let the UI edit it locally, seal it, push it, and resolve the 409 when another device got there
 * first. The onboarding wizard and the extension-connect page both talk to this and to nothing
 * lower — neither of them should ever see an envelope or a `VaultError`.
 *
 * ── Merge policy ───────────────────────────────────────────────────────────────────────────────
 *
 * Last-write-wins **per profile**, keyed on `id` and decided by `updatedAt`. Identical to
 * `apps/extension/src/sync/profile.ts` on purpose: two ends of the same sync that disagree about
 * merging produce a vault that oscillates. Per field would be worse than either — merging a
 * half-typed work-history edit from one device into a finished one from another yields a profile
 * neither user wrote and neither can undo. Per profile, the loser is at least a coherent version of
 * something they typed, and the timestamp says which one they typed last.
 *
 * A profile present on only one side is kept, never deleted: treating absence as a delete lets a
 * device that has not pulled yet wipe the account.
 *
 * ── Save cadence ───────────────────────────────────────────────────────────────────────────────
 *
 * Nothing here is debounced and nothing auto-saves. `/api/sync`, `/api/devices` and
 * `/api/job-applications` share a 60 req/min/user budget, and sealing on every keystroke would eat
 * it in under a minute of typing. The wizard calls `save()` when a step is finished.
 */

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

/* ------------------------------------------------------------------------------------------------
 * Contract
 * ---------------------------------------------------------------------------------------------- */

/**
 * Why a failure happened, not just that one did.
 *
 * The distinction is not cosmetic. "We couldn't open your vault" and "we couldn't reach NextMove"
 * are the same state to the code and completely different events to the person reading them: the
 * first says your data may be unrecoverable, the second says your wifi dropped. Showing the first
 * when the second happened is how you make someone think they lost their profile.
 */
export type VaultFailureKind = "network" | "vault" | "auth" | "unknown"

export interface ProfileVaultState {
    status: "idle" | "loading" | "ready" | "error"
    /** The active profile, or a fresh empty one. Null only before the first `load()`. */
    profile: SharedProfile | null
    /** base64; null until `ensureVaultKey()` runs. Never sent to the server. */
    vaultKey: string | null
    /** Optimistic-concurrency version of the last GET/PUT. 0 means "no vault stored yet". */
    version: number
    error: string | null
    /** Null whenever `error` is null. */
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

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------------- */

/** Everything a save() needs to know, kept in a ref so async work never reads a stale render. */
interface VaultData {
    profiles: SharedProfile[]
    activeProfileId: string | null
    version: number
}

const DEFAULT_PROFILE_LABEL = "Default"

function newProfileId(): string {
    const c = globalThis.crypto
    if (typeof c?.randomUUID === "function") return c.randomUUID()
    // Non-secure origins have no `randomUUID`. The id is a merge key, not a secret, so any
    // collision-resistant value will do.
    return `profile-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
}

/** The profile a brand-new account starts from. `createEmptyProfile` leaves `isDefault` false. */
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

/**
 * Applies a patch one level deep: `{ personal: { email } }` keeps the rest of `personal`, while
 * arrays (`work`, `skills`, `answers`) are replaced wholesale — a per-element merge of a list the
 * user just reordered or trimmed would resurrect deleted rows.
 *
 * `id` is ignored. It is the profile's identity for the LWW merge, and letting a stale form patch
 * rewrite it silently forks the profile into two on the next sync.
 */
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
        // Written through Object.assign because TypeScript cannot prove `next[key] = merged` is
        // sound for a union-typed key, and the alternative is a cast to `any`.
        Object.assign(next, { [key]: merged })
    }
    // The edit just happened, so it is now the newest version of this profile — unless the caller
    // supplied a timestamp of its own (a resume import replaying an older extraction, say).
    if (patch.updatedAt === undefined) next.updatedAt = Date.now()
    return next
}

/**
 * Union of `local` and `remote` by profile id; newer `updatedAt` wins. Ties go to `local`, which in
 * practice means identical content and avoids a pointless rewrite.
 */
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

    // Exactly one profile may be the default. A merge easily produces two (each device marked a
    // different one) or none (the only default lived on the losing side), and the wrong count
    // silently changes which profile the extension autofills from.
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

/**
 * `fetch` rejects with a bare TypeError for DNS failure, connection refused, CORS and offline
 * alike — the message differs per browser ("Failed to fetch", "NetworkError when attempting to
 * fetch resource", "Load failed") and none of them are worth showing a user. What matters is that
 * none of them mean the vault is damaged.
 */
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

/* ------------------------------------------------------------------------------------------------
 * Provider
 * ---------------------------------------------------------------------------------------------- */

const ProfileVaultContext = createContext<ProfileVaultApi | null>(null)

export function ProfileVaultProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
    const { getToken } = useAuth()

    const [status, setStatus] = useState<ProfileVaultState["status"]>("idle")
    const [error, setError] = useState<string | null>(null)
    const [errorKind, setErrorKind] = useState<VaultFailureKind | null>(null)
    const [saving, setSaving] = useState(false)
    const [vaultKey, setVaultKey] = useState<string | null>(null)
    const [data, setData] = useState<VaultData>({ profiles: [], activeProfileId: null, version: 0 })

    // The refs, not the state, are the source of truth while async work is in flight: load() and
    // save() both await between reading and writing, and a closure over `data` would be a render
    // old by the time it lands.
    const dataRef = useRef<VaultData>(data)
    const keyRef = useRef<string | null>(null)
    const savingRef = useRef(false)

    const commit = useCallback((next: VaultData) => {
        dataRef.current = next
        setData(next)
    }, [])

    /**
     * Reads the key, or mints and persists one. Synchronous so `exportRecoveryKey()` can use it
     * too; `ensureVaultKey()` is the promised face of the same operation.
     */
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
            // Private mode, or site data blocked. The key still works for this tab, so the flow
            // continues — but it dies with the tab, and the user has to be told while they can act.
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
                // No vault on the account yet. That is the normal first-run state, so seed one
                // locally at version 0 — the first save() becomes the account's first write.
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
        // A vault we could not decrypt must never be overwritten: re-sealing with this browser's
        // key would replace the user's real profile with whatever this tab happens to hold.
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

            // 409. Re-sealing the same content would produce different bytes (fresh IV) at the same
            // version and 409 again, so the only way through is to pull what is actually stored,
            // merge it, and push once at the server's version + 1.
            const remote = await fetchProfileEnvelope(token)
            const remoteVault = remote === null ? null : await openVault(remote, key)
            const local = dataRef.current
            const merged = mergeProfileLists(local.profiles, remoteVault?.profiles ?? [])
            const activeId =
                pickActive(merged, local.activeProfileId ?? remoteVault?.activeProfileId ?? null)?.id ?? null
            // The GET is authoritative; `currentVersion` from the 409 is the floor in case the row
            // vanished between the two calls.
            const baseVersion = Math.max(remote?.version ?? 0, first.currentVersion)

            const retry = await putProfileEnvelope(
                token,
                await sealVault(merged, activeId, key, baseVersion + 1),
            )
            if (!retry.ok) {
                // Keep the merged result either way — it is strictly better information than what
                // we held before, and it means the user's next save starts from the truth.
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
