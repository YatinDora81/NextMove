import type { Request, Response } from "express"
import logger from "@/config/logger.js"
import { touchPairedDevice } from "@/controllers/deviceControllers.js"
import syncRepo, { ProfileBlobVersionConflictError } from "@/repository/syncRepo.js"
import { profileBlobEnvelopeSchema, siteMappingsPutSchema } from "@repo/types/ExtensionTypes"

/**
 * The magic bytes every sealed profile vault starts with, and the two envelope formats
 * `packages/vault` knows how to write (1 = passphrase-derived key, 2 = raw 256-bit key).
 */
const VAULT_MAGIC = "JFS1"
const VAULT_FORMATS = new Set([1, 2])

/**
 * Cheap structural proof that a body went through the client-side sealing codec.
 *
 * The server cannot verify the ciphertext — being unable to is the entire point of SEC 7.4. What it
 * *can* do is refuse a body that is obviously not ciphertext at all, which turns "a future client
 * forgot to seal the profile" from a silent, permanent plaintext-PII leak into a 400 on the very
 * first request.
 *
 * Only the 6-byte header is decoded, never the body: a vault can be megabytes, and decoding it here
 * would be both wasteful and a step toward the server knowing something about its contents.
 * `Buffer.from(base64)` is lenient about trailing garbage, which is fine — a valid header is
 * necessary, not sufficient, and sufficiency is AES-GCM's job on the client.
 */
function looksSealed(ciphertext: string): boolean {
    // 8 base64 chars decode to exactly 6 bytes: magic(4) + format(1) + saltLen(1).
    const header = Buffer.from(ciphertext.slice(0, 8), "base64")
    if (header.length < 6) return false
    if (header.subarray(0, 4).toString("ascii") !== VAULT_MAGIC) return false
    return VAULT_FORMATS.has(header[4]!)
}

class SyncControllers {
    /**
     * `GET /api/sync/profile` - pull the stored envelope.
     *
     * Responds 200 with `data: null` when the account has never pushed one. An empty vault is a
     * normal state for a freshly paired device, not an error, and a 404 here would force every
     * client to special-case its own first sync.
     */
    async getProfileBlob(req: Request, res: Response) {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    data: null,
                    message: "Unauthorized"
                })
                return
            }

            touchPairedDevice(req)

            const blob = await syncRepo.getProfileBlob(req.user.user_id)
            res.status(200).json({
                success: true,
                data: blob,
                message: blob ? "Profile blob fetched successfully" : "No profile blob has been synced yet"
            })
        } catch (error) {
            logger.error(`[CONTROLLER: getProfileBlob] Error fetching profile blob for user: ${req.user?.user_id}`, error)
            res.status(500).json({
                success: false,
                data: null,
                message: "Internal Server Error"
            })
        }
    }

    /**
     * `PUT /api/sync/profile` - push an envelope under optimistic locking.
     *
     * A version that does not advance the stored one by exactly 1 is a 409 carrying
     * `VERSION_CONFLICT` and the server's `currentVersion`, which is everything the client needs to
     * pull, merge and retry in one more round trip (SEC 8.3).
     */
    async putProfileBlob(req: Request, res: Response) {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    data: null,
                    message: "Unauthorized"
                })
                return
            }

            const parsedData = profileBlobEnvelopeSchema.safeParse(req.body)
            if (!parsedData.success) {
                res.status(400).json({
                    success: false,
                    data: parsedData.error,
                    message: "Invalid data"
                })
                return
            }

            if (!looksSealed(parsedData.data.ciphertext)) {
                // Deliberately not logged with the body attached: if this ever fires, the body is
                // exactly the plaintext PII we are refusing to store.
                logger.warn(
                    `[CONTROLLER: putProfileBlob] Rejected an unsealed profile blob for user: ${req.user.user_id}`
                )
                res.status(400).json({
                    success: false,
                    data: { code: "NOT_SEALED" },
                    message:
                        "The profile blob is not end-to-end encrypted. Refusing to store it — the server must never hold a readable profile."
                })
                return
            }

            touchPairedDevice(req)

            const result = await syncRepo.upsertProfileBlob(req.user.user_id, parsedData.data)
            res.status(200).json({
                success: true,
                data: { version: result.version, updatedAt: result.updatedAt },
                message: result.stored
                    ? "Profile blob synced successfully"
                    : "Profile blob already up to date"
            })
        } catch (error) {
            if (error instanceof ProfileBlobVersionConflictError) {
                logger.warn(
                    `[CONTROLLER: putProfileBlob] Version conflict for user: ${req.user?.user_id} (stored ${error.currentVersion}, received ${error.receivedVersion})`
                )
                res.status(409).json({
                    success: false,
                    data: {
                        code: error.code,
                        currentVersion: error.currentVersion,
                        expectedVersion: error.expectedVersion
                    },
                    message: "This profile was updated on another device. Pull the latest version, merge, and push again."
                })
                return
            }

            logger.error(`[CONTROLLER: putProfileBlob] Error writing profile blob for user: ${req.user?.user_id}`, error)
            res.status(500).json({
                success: false,
                data: null,
                message: "Internal Server Error"
            })
        }
    }

    /** `GET /api/sync/mappings` - the user's whole learn-from-correction set (F-13). */
    async getMappings(req: Request, res: Response) {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    data: null,
                    message: "Unauthorized"
                })
                return
            }

            touchPairedDevice(req)

            const mappings = await syncRepo.getMappings(req.user.user_id)
            res.status(200).json({
                success: true,
                data: { mappings },
                message: "Site mappings fetched successfully"
            })
        } catch (error) {
            logger.error(`[CONTROLLER: getMappings] Error fetching site mappings for user: ${req.user?.user_id}`, error)
            res.status(500).json({
                success: false,
                data: null,
                message: "Internal Server Error"
            })
        }
    }

    /**
     * `PUT /api/sync/mappings` - merge a mapping set, last-write-wins per (domain, sigHash).
     *
     * A merge, not a replace-all: rows the payload does not mention survive. The 5000-row ceiling
     * lives in the shared schema, so it is enforced identically here and in the extension client.
     */
    async putMappings(req: Request, res: Response) {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    data: null,
                    message: "Unauthorized"
                })
                return
            }

            const parsedData = siteMappingsPutSchema.safeParse(req.body)
            if (!parsedData.success) {
                res.status(400).json({
                    success: false,
                    data: parsedData.error,
                    message: "Invalid data"
                })
                return
            }

            touchPairedDevice(req)

            const written = await syncRepo.replaceMappings(req.user.user_id, parsedData.data.mappings)
            const total = await syncRepo.countMappings(req.user.user_id)

            res.status(200).json({
                success: true,
                data: { written, total },
                message: "Site mappings synced successfully"
            })
        } catch (error) {
            logger.error(`[CONTROLLER: putMappings] Error writing site mappings for user: ${req.user?.user_id}`, error)
            res.status(500).json({
                success: false,
                data: null,
                message: "Internal Server Error"
            })
        }
    }
}

export default new SyncControllers()
