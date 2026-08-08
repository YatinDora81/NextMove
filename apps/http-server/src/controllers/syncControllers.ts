import type { Request, Response } from "express"
import logger from "@/config/logger.js"
import { touchPairedDevice } from "@/controllers/deviceControllers.js"
import syncRepo, { ProfileBlobVersionConflictError } from "@/repository/syncRepo.js"
import { profileBlobEnvelopeSchema, siteMappingsPutSchema } from "@repo/types/ExtensionTypes"

const VAULT_MAGIC = "JFS1"
const VAULT_FORMATS = new Set([1, 2])

function looksSealed(ciphertext: string): boolean {
    const header = Buffer.from(ciphertext.slice(0, 8), "base64")
    if (header.length < 6) return false
    if (header.subarray(0, 4).toString("ascii") !== VAULT_MAGIC) return false
    return VAULT_FORMATS.has(header[4]!)
}

class SyncControllers {
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
