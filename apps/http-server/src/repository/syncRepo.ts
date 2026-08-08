import logger from "@/config/logger.js"
import { prismaClient } from "@repo/db/db"
import type { profileBlobEnvelopeSchemaType, siteMappingRowSchemaType } from "@repo/types/ExtensionTypes"

/**
 * JF-001 SEC 7.4 / 8.3 - the two server-side sync stores: the end-to-end-encrypted `ProfileBlob`
 * and the `SiteMapping` set.
 *
 * **The profile blob is opaque.** `ciphertext` and `nonce` are moved between base64 (wire) and
 * `Bytes` (Postgres) and nothing else. This file never parses, inspects, indexes or logs the
 * plaintext, because it cannot: the key is derived client-side from the user's passphrase and never
 * reaches the server (SEC 7.4 - "the server stores ciphertext it cannot read"). Any future code
 * here that tries to understand the blob is a bug.
 */

/**
 * Thrown when a `PUT /api/sync/profile` does not advance the version by exactly one.
 * The controller turns this into `409 { code: 'VERSION_CONFLICT' }`; `currentVersion` travels with
 * it so the client can merge and retry without a second round trip (SEC 8.3).
 */
export class ProfileBlobVersionConflictError extends Error {
    readonly code = "VERSION_CONFLICT" as const
    readonly currentVersion: number
    readonly expectedVersion: number
    readonly receivedVersion: number

    constructor(currentVersion: number, receivedVersion: number) {
        super(`Profile blob version conflict: expected ${currentVersion + 1}, received ${receivedVersion}`)
        this.name = "ProfileBlobVersionConflictError"
        this.currentVersion = currentVersion
        this.expectedVersion = currentVersion + 1
        this.receivedVersion = receivedVersion
    }
}

/** What a successful profile push reports back. */
export interface ProfileBlobWriteResult {
    version: number
    updatedAt: string
    /** `false` when the write was recognised as an idempotent replay and nothing was persisted. */
    stored: boolean
}

/** Composite-key string for in-payload dedupe of (domain, sigHash). */
const mappingKey = (domain: string, sigHash: string): string => `${domain}::${sigHash}`

/**
 * Prisma's known-request errors carry a `code` (`P2025` = "record to update not found"). Read
 * structurally rather than via `instanceof Prisma.PrismaClientKnownRequestError` so this file needs
 * no Prisma type imports and keeps working across client versions.
 */
const prismaErrorCode = (error: unknown): string | null => {
    if (typeof error !== "object" || error === null) return null
    const code = (error as { code?: unknown }).code
    return typeof code === "string" ? code : null
}

class SyncRepo {
    /**
     * Pull the stored envelope. `null` means this account has never pushed one - the extension
     * treats that as "nothing to merge, push mine".
     */
    async getProfileBlob(userId: string): Promise<profileBlobEnvelopeSchemaType | null> {
        try {
            const row = await prismaClient.profileBlob.findUnique({
                where: { userId },
                select: { ciphertext: true, nonce: true, version: true }
            })
            if (!row) return null
            return {
                ciphertext: Buffer.from(row.ciphertext).toString("base64"),
                nonce: Buffer.from(row.nonce).toString("base64"),
                version: row.version
            }
        } catch (error) {
            logger.error(`[REPO: getProfileBlob] Error fetching profile blob for user: ${userId}`, error)
            throw error
        }
    }

    /**
     * Push an envelope under optimistic concurrency.
     *
     * Accepted:
     *  - `version === current + 1` - the normal advance.
     *  - `version === current` **and byte-identical content** - an idempotent replay of a request
     *    whose response the client lost. Nothing is written; the stored version is returned.
     *  - `version` of 0 or 1 when no row exists yet - the seed write, stored verbatim. Both are
     *    allowed because "one past nothing" is genuinely ambiguous, and being lenient about the
     *    very first write can only ever help a stricter client.
     *
     * Everything else throws `ProfileBlobVersionConflictError`, which the controller renders as 409.
     *
     * The read and the write share one interactive transaction and the `update` re-states the
     * expected version in its `where`, so two devices racing to advance the same version cannot
     * both win - the loser's precondition no longer matches.
     */
    async upsertProfileBlob(
        userId: string,
        envelope: profileBlobEnvelopeSchemaType
    ): Promise<ProfileBlobWriteResult> {
        const ciphertext = Buffer.from(envelope.ciphertext, "base64")
        const nonce = Buffer.from(envelope.nonce, "base64")

        try {
            return await prismaClient.$transaction(async (tx) => {
                const current = await tx.profileBlob.findUnique({
                    where: { userId },
                    select: { ciphertext: true, nonce: true, version: true, updatedAt: true }
                })

                if (!current) {
                    if (envelope.version !== 0 && envelope.version !== 1) {
                        throw new ProfileBlobVersionConflictError(0, envelope.version)
                    }
                    const created = await tx.profileBlob.create({
                        data: { userId, ciphertext, nonce, version: envelope.version },
                        select: { version: true, updatedAt: true }
                    })
                    return {
                        version: created.version,
                        updatedAt: created.updatedAt.toISOString(),
                        stored: true
                    }
                }

                if (envelope.version === current.version) {
                    const identical =
                        Buffer.from(current.ciphertext).equals(ciphertext) &&
                        Buffer.from(current.nonce).equals(nonce)
                    if (identical) {
                        return {
                            version: current.version,
                            updatedAt: current.updatedAt.toISOString(),
                            stored: false
                        }
                    }
                    throw new ProfileBlobVersionConflictError(current.version, envelope.version)
                }

                if (envelope.version !== current.version + 1) {
                    throw new ProfileBlobVersionConflictError(current.version, envelope.version)
                }

                try {
                    const updated = await tx.profileBlob.update({
                        where: { userId, version: current.version },
                        data: { ciphertext, nonce, version: envelope.version },
                        select: { version: true, updatedAt: true }
                    })
                    return {
                        version: updated.version,
                        updatedAt: updated.updatedAt.toISOString(),
                        stored: true
                    }
                } catch (error) {
                    // P2025: the `version` precondition no longer matched, i.e. another device
                    // advanced the row between our read and this write. That is a conflict, not a
                    // server fault. `currentVersion` is reported as the version we read, which is a
                    // lower bound - the client GETs and merges regardless, so it self-corrects.
                    if (prismaErrorCode(error) === "P2025") {
                        throw new ProfileBlobVersionConflictError(current.version, envelope.version)
                    }
                    throw error
                }
            })
        } catch (error) {
            if (error instanceof ProfileBlobVersionConflictError) throw error
            logger.error(`[REPO: upsertProfileBlob] Error writing profile blob for user: ${userId}`, error)
            throw error
        }
    }

    /** The user's full learn-from-correction memory (F-13), deterministically ordered. */
    async getMappings(userId: string): Promise<siteMappingRowSchemaType[]> {
        try {
            const rows = await prismaClient.siteMapping.findMany({
                where: { userId },
                select: { domain: true, sigHash: true, profilePath: true },
                orderBy: [{ domain: "asc" }, { sigHash: "asc" }]
            })
            return rows.map((row) => ({
                domain: row.domain,
                sigHash: row.sigHash,
                profilePath: row.profilePath
            }))
        } catch (error) {
            logger.error(`[REPO: getMappings] Error fetching site mappings for user: ${userId}`, error)
            throw error
        }
    }

    /**
     * Merge a mapping set, last-write-wins per (userId, domain, sigHash) - the composite primary
     * key dedupes naturally (SEC 7.5). Duplicates *within* one payload are collapsed first, keeping
     * the last occurrence, so the same rule holds inside a single request.
     *
     * This is a merge, not a truncate: mappings absent from the payload are left alone. A device
     * that has only ever seen three domains must not be able to erase the other twelve, and
     * deletion is not part of the SEC 8.3 contract.
     *
     * Runs as one batch transaction of upserts - the whole set lands or none of it does.
     */
    async replaceMappings(userId: string, mappings: readonly siteMappingRowSchemaType[]): Promise<number> {
        const deduped = new Map<string, siteMappingRowSchemaType>()
        for (const mapping of mappings) {
            deduped.set(mappingKey(mapping.domain, mapping.sigHash), mapping)
        }

        const rows = [...deduped.values()]
        if (rows.length === 0) return 0

        try {
            const operations = rows.map((row) =>
                prismaClient.siteMapping.upsert({
                    where: {
                        userId_domain_sigHash: {
                            userId,
                            domain: row.domain,
                            sigHash: row.sigHash
                        }
                    },
                    create: {
                        userId,
                        domain: row.domain,
                        sigHash: row.sigHash,
                        profilePath: row.profilePath
                    },
                    update: { profilePath: row.profilePath }
                })
            )
            await prismaClient.$transaction(operations)
            return rows.length
        } catch (error) {
            logger.error(`[REPO: replaceMappings] Error writing ${rows.length} site mappings for user: ${userId}`, error)
            throw error
        }
    }

    /** Count of stored mappings - cheap enough to report back alongside a PUT. */
    async countMappings(userId: string): Promise<number> {
        try {
            return await prismaClient.siteMapping.count({ where: { userId } })
        } catch (error) {
            logger.error(`[REPO: countMappings] Error counting site mappings for user: ${userId}`, error)
            throw error
        }
    }
}

export default new SyncRepo()
