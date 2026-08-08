import logger from "@/config/logger.js"
import type { SealedKey } from "@/utils/keyVault.js"
import { prismaClient } from "@repo/db/db"
import type { aiKeyPublicSchemaType, aiKeyStatusSchemaType } from "@repo/types/AiKeyTypes"

/**
 * JF-001 SEC 15.3 / 15.5 — Prisma CRUD over `UserGeminiKey`.
 *
 * Two rules govern every method below:
 *
 *  1. **The masked list never touches ciphertext.** `listMasked` uses an explicit `select` of
 *     id / label / last4 / status / lastUsedAt / createdAt. A `select` — not an `omit`, not a
 *     post-hoc `delete row.ciphertext` — so that adding a column to the schema can never silently
 *     widen what the API returns (SEC 15.5: *no route ever returns a key*).
 *
 *  2. **Nothing sensitive is cached.** Unlike the other repositories in this app, there is no
 *     `setRedis` call here. Redis holds *ledgers about* keys (`aikey:rpm:*`, `aikey:rpd:*`, owned
 *     by `services/rotationStore.service.ts`) and never key material — SEC 15.8: *"Redis holds
 *     ledgers about keys, never keys."* Sealed rows are cheap to read and are read at most once
 *     per generation, so there is nothing to gain and a vault to lose.
 *
 * Every mutating method is scoped by `userId` in its `where` clause, so a guessed row id from
 * another tenant matches nothing.
 */

/**
 * A full vault row, sealed material included. Handed to `keyLane.service.ts`, which is the only
 * consumer allowed to open it. Prisma returns `Bytes` columns as `Uint8Array`.
 */
export interface VaultKeyRow {
    id: string
    userId: string
    label: string
    ciphertext: Uint8Array
    iv: Uint8Array
    authTag: Uint8Array
    keyVersion: number
    last4: string
    status: aiKeyStatusSchemaType
    strikes: number
    cooldownUntil: Date | null
    lastUsedAt: Date | null
    createdAt: Date
}

/** Durable rotation fields persisted after a call outcome (SEC 15.3, 15.6). */
export interface RotationStatePatch {
    status?: aiKeyStatusSchemaType
    strikes?: number
    /** `null` clears an active cooldown. */
    cooldownUntil?: Date | null
    lastUsedAt?: Date | null
}

/** Columns that make up the masked public view. Single source of truth for the `select`. */
const MASKED_SELECT = {
    id: true,
    label: true,
    last4: true,
    status: true,
    lastUsedAt: true,
    createdAt: true,
} as const

interface MaskedRow {
    id: string
    label: string
    last4: string
    status: aiKeyStatusSchemaType
    lastUsedAt: Date | null
    createdAt: Date
}

/** Shape a masked row into the wire contract from `@repo/types/AiKeyTypes`. */
const toPublic = (row: MaskedRow): aiKeyPublicSchemaType => ({
    id: row.id,
    label: row.label,
    last4: row.last4,
    status: row.status,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
})

class AiKeyRepo {
    /**
     * Insert an already-sealed key. This repository never sees plaintext: the controller validates
     * it against Google, `keyVault.sealKey` turns it into bytes, and only the bytes arrive here.
     * Returns the masked public view — the create response, like every other response, carries no key.
     */
    async create(userId: string, label: string, sealed: SealedKey): Promise<aiKeyPublicSchemaType> {
        try {
            const row = await prismaClient.userGeminiKey.create({
                data: {
                    userId,
                    label,
                    ciphertext: sealed.ciphertext,
                    iv: sealed.iv,
                    authTag: sealed.authTag,
                    keyVersion: sealed.keyVersion,
                    last4: sealed.last4,
                },
                select: MASKED_SELECT,
            })

            logger.info(`[REPO: create] Vault key stored for user: ${userId} (id=${row.id}, last4=${row.last4})`)
            return toPublic(row)
        } catch (error) {
            logger.error(`[REPO: create] Error storing vault key for user: ${userId}`, error)
            throw new Error(`Failed to store AI key in DB , ${error}`)
        }
    }

    /**
     * The masked list behind `GET /api/ai-keys` — id, label, last4, status, lastUsedAt, createdAt.
     * **Never ciphertext, iv, authTag or keyVersion.** Newest first, matching the Settings panel.
     */
    async listMasked(userId: string): Promise<aiKeyPublicSchemaType[]> {
        try {
            const rows = await prismaClient.userGeminiKey.findMany({
                where: { userId },
                select: MASKED_SELECT,
                orderBy: { createdAt: "desc" },
            })

            return rows.map(toPublic)
        } catch (error) {
            logger.error(`[REPO: listMasked] Error listing vault keys for user: ${userId}`, error)
            throw new Error(`Failed to list AI keys in DB , ${error}`)
        }
    }

    /**
     * Every key that could still serve a request — i.e. everything except DEAD, which only the
     * user can revive by fixing or replacing the key. COOLDOWN and EXHAUSTED rows are included on
     * purpose: `@repo/rotation` recovers them lazily (a cooldown that has elapsed, a daily ledger
     * that has rolled past Pacific midnight) without any write happening first.
     *
     * Ordered oldest-first so that the LRU tie-break in `selectKey` — which breaks ties on pool
     * order — is stable and favours the key the user added first.
     */
    async findActiveForUser(userId: string): Promise<VaultKeyRow[]> {
        try {
            const rows = await prismaClient.userGeminiKey.findMany({
                where: { userId, status: { not: "DEAD" } },
                orderBy: { createdAt: "asc" },
            })

            return rows as VaultKeyRow[]
        } catch (error) {
            logger.error(`[REPO: findActiveForUser] Error loading vault keys for user: ${userId}`, error)
            throw new Error(`Failed to load AI keys in DB , ${error}`)
        }
    }

    /**
     * One row by id, scoped to its owner — a foreign id resolves to `null` rather than another
     * tenant's key. Used by the test route and by outcome reporting.
     */
    async findById(userId: string, id: string): Promise<VaultKeyRow | null> {
        try {
            const row = await prismaClient.userGeminiKey.findFirst({
                where: { id, userId },
            })

            return row as VaultKeyRow | null
        } catch (error) {
            logger.error(`[REPO: findById] Error loading vault key ${id} for user: ${userId}`, error)
            throw new Error(`Failed to load AI key in DB , ${error}`)
        }
    }

    /**
     * Persist the durable half of the rotation state — status, strike count, cooldown deadline and
     * last-used stamp (SEC 15.3). The hot per-minute and per-day counters deliberately do **not**
     * live here; they are Redis ledgers owned by `rotationStore.service.ts` (SEC 15.6).
     *
     * `updateMany` rather than `update` so a row that has been deleted mid-request (or belongs to
     * someone else) is a no-op instead of a thrown `P2025` that would fail an otherwise successful
     * generation. Returns whether a row actually changed.
     */
    async updateRotationState(userId: string, id: string, patch: RotationStatePatch): Promise<boolean> {
        try {
            const data: RotationStatePatch = {}
            if (patch.status !== undefined) data.status = patch.status
            if (patch.strikes !== undefined) data.strikes = patch.strikes
            if (patch.cooldownUntil !== undefined) data.cooldownUntil = patch.cooldownUntil
            if (patch.lastUsedAt !== undefined) data.lastUsedAt = patch.lastUsedAt

            if (Object.keys(data).length === 0) return false

            const result = await prismaClient.userGeminiKey.updateMany({
                where: { id, userId },
                data,
            })

            return result.count > 0
        } catch (error) {
            logger.error(`[REPO: updateRotationState] Error updating rotation state for key ${id}`, error)
            throw new Error(`Failed to update AI key rotation state in DB , ${error}`)
        }
    }

    /**
     * Hard delete — the ciphertext row is shredded immediately, no soft-delete tombstone (SEC 15.5).
     * A vault the user cannot empty is not a vault. Returns `false` when nothing matched.
     */
    async hardDelete(userId: string, id: string): Promise<boolean> {
        try {
            const result = await prismaClient.userGeminiKey.deleteMany({
                where: { id, userId },
            })

            if (result.count > 0) {
                logger.info(`[REPO: hardDelete] Vault key ${id} deleted for user: ${userId}`)
            }
            return result.count > 0
        } catch (error) {
            logger.error(`[REPO: hardDelete] Error deleting vault key ${id} for user: ${userId}`, error)
            throw new Error(`Failed to delete AI key in DB , ${error}`)
        }
    }

    /** How many keys this user has vaulted. Backs the per-user cap in the add-key controller. */
    async countForUser(userId: string): Promise<number> {
        try {
            return await prismaClient.userGeminiKey.count({ where: { userId } })
        } catch (error) {
            logger.error(`[REPO: countForUser] Error counting vault keys for user: ${userId}`, error)
            throw new Error(`Failed to count AI keys in DB , ${error}`)
        }
    }
}

export default new AiKeyRepo()
