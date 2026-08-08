import logger from "@/config/logger.js"
import aiKeyRepo from "@/repository/aiKeyRepo.js"
import { openVaultKey } from "@/services/keyLane.service.js"
import { validateGeminiKey } from "@/services/geminiRest.service.js"
import { forgetKey } from "@/services/rotationStore.service.js"
import { sealKey } from "@/utils/keyVault.js"
import { addAiKeySchema, type aiKeyStatusSchemaType, type aiKeyTestResultSchemaType } from "@repo/types/AiKeyTypes"
import { Request, Response } from "express"

/**
 * JF-001 SEC 15.5 — the write-only vault API.
 *
 *   POST   /api/ai-keys          validate live against Google → seal → insert → masked row back
 *   GET    /api/ai-keys          masked list only
 *   POST   /api/ai-keys/:id/test re-validate on demand, flip DEAD ↔ ACTIVE
 *   DELETE /api/ai-keys/:id      hard delete, ciphertext shredded immediately
 *
 * **No route in this file returns a key, and no reveal endpoint exists** — that is the product
 * decision, not an oversight (SEC 15.5 / 15.8). The plaintext appears in exactly one local variable
 * in `addKey`, lives for the length of that request, and is never logged, cached or echoed back.
 * Everything else in here speaks only in `id / label / last4 / status`.
 *
 * The controller never calls `openKey`: the test route reaches plaintext through
 * `keyLane.service.openVaultKey`, which keeps the decrypt site singular (SEC 15.8).
 */

/**
 * Per-user cap. Rotation gives real throughput up to a handful of keys; beyond that it is a way to
 * fill the table, and this route is not behind a rate limiter. Generous enough that no genuine user
 * will meet it, low enough to bound abuse.
 */
const MAX_KEYS_PER_USER = 10

class AiKeyControllers {

    /**
     * Add a key: **validate first, seal second, insert third.** A key that Google will not accept
     * never reaches the database, so a DEAD row can only ever be a key that worked once and stopped.
     *
     * On rejection Google's own wording is returned verbatim — that is what tells a user their AI
     * Studio key is an old *unrestricted* one that Gemini no longer accepts (SEC 5.2 / 15.7). Any
     * paraphrase here strands the user.
     */
    async addKey(req: Request, res: Response) {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    data: null,
                    message: "Unauthorized"
                })
                return
            }

            const parsedData = addAiKeySchema.safeParse(req.body)
            if (!parsedData.success) {
                res.status(400).json({
                    success: false,
                    data: null,
                    message: parsedData.error.issues[0]?.message || "Invalid data"
                })
                return
            }

            const userId = req.user.user_id
            const label = parsedData.data.label.trim()

            // Request-scoped plaintext. From here to `sealKey` is the whole of its life.
            const plaintext = parsedData.data.key.trim()

            const existingCount = await aiKeyRepo.countForUser(userId)
            if (existingCount >= MAX_KEYS_PER_USER) {
                res.status(400).json({
                    success: false,
                    data: null,
                    message: `You can store up to ${MAX_KEYS_PER_USER} Gemini keys. Delete one before adding another.`
                })
                return
            }

            const verdict = await validateGeminiKey(plaintext)
            if (!verdict.ok) {
                // Verbatim from Google — never rewritten (SEC 15.7).
                res.status(400).json({
                    success: false,
                    data: { ok: false, message: verdict.message },
                    message: verdict.message
                })
                return
            }

            const sealed = sealKey(plaintext, userId)
            const created = await aiKeyRepo.create(userId, label, sealed)

            // Note what is logged: the row id and the display tail. Never the key.
            logger.info(`[CONTROLLER: addKey] Vault key added for user: ${userId} (id=${created.id})`)

            res.status(201).json({
                success: true,
                data: created,
                message: "API key verified and saved"
            })
        } catch (error) {
            logger.error(`[CONTROLLER: addKey] Error adding AI key for user: ${req.user?.user_id}`, error)
            res.status(500).json({
                success: false,
                data: null,
                message: "Internal Server Error"
            })
        }
    }

    /**
     * The masked list — id, label, last4, status, lastUsedAt, createdAt. The repository enforces
     * this with an explicit Prisma `select`, so ciphertext cannot leak in even if the model grows
     * new columns.
     */
    async listKeys(req: Request, res: Response) {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    data: null,
                    message: "Unauthorized"
                })
                return
            }

            const keys = await aiKeyRepo.listMasked(req.user.user_id)

            res.status(200).json({
                success: true,
                data: keys,
                message: "AI keys fetched successfully"
            })
        } catch (error) {
            logger.error(`[CONTROLLER: listKeys] Error listing AI keys for user: ${req.user?.user_id}`, error)
            res.status(500).json({
                success: false,
                data: null,
                message: "Internal Server Error"
            })
        }
    }

    /**
     * Re-validate a stored key on demand and flip its status accordingly:
     *
     *   Google accepts it            → ACTIVE, strikes cleared, cooldown cleared
     *   Google rejects the key       → DEAD  (only the user can revive it)
     *   429 / 5xx / network problem  → status untouched — a Google outage must not kill a good key
     *
     * The key is opened through the key lane (the single decrypt site) and dropped immediately.
     */
    async testKey(req: Request, res: Response) {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    data: null,
                    message: "Unauthorized"
                })
                return
            }

            const userId = req.user.user_id
            const id = req.params.id
            if (typeof id !== "string" || id.length === 0) {
                res.status(400).json({
                    success: false,
                    data: null,
                    message: "Key id is required"
                })
                return
            }

            // Masked read: the controller learns the current status without ever holding ciphertext.
            const known = (await aiKeyRepo.listMasked(userId)).find(row => row.id === id)
            if (known === undefined) {
                res.status(404).json({
                    success: false,
                    data: null,
                    message: "API key not found"
                })
                return
            }

            const leased = await openVaultKey(userId, id)
            if (leased === null) {
                // The row exists but will not decrypt; `openVaultKey` has already retired it as DEAD.
                const result: aiKeyTestResultSchemaType = {
                    id,
                    status: "DEAD",
                    ok: false,
                    message: "This stored key could not be read and has been marked dead. Please delete it and add the key again."
                }
                res.status(200).json({
                    success: true,
                    data: result,
                    message: result.message
                })
                return
            }

            const verdict = await validateGeminiKey(leased.apiKey)

            let status: aiKeyStatusSchemaType = known.status
            if (verdict.ok) {
                status = "ACTIVE"
                await aiKeyRepo.updateRotationState(userId, id, {
                    status: "ACTIVE",
                    strikes: 0,
                    cooldownUntil: null
                })
            } else if (verdict.outcome.kind === "key_invalid") {
                status = "DEAD"
                await aiKeyRepo.updateRotationState(userId, id, { status: "DEAD" })
            }
            // 429 / quota / network: leave the durable status exactly as it was.

            const result: aiKeyTestResultSchemaType = {
                id,
                status,
                ok: verdict.ok,
                // Google's wording, unedited, is the whole point of the Test button.
                message: verdict.ok ? "Key is working" : verdict.message
            }

            logger.info(`[CONTROLLER: testKey] Key ${id} tested for user ${userId}: ok=${verdict.ok} status=${status}`)

            res.status(200).json({
                success: true,
                data: result,
                message: result.message
            })
        } catch (error) {
            logger.error(`[CONTROLLER: testKey] Error testing AI key for user: ${req.user?.user_id}`, error)
            res.status(500).json({
                success: false,
                data: null,
                message: "Internal Server Error"
            })
        }
    }

    /**
     * Hard delete — the ciphertext row is shredded on the spot (SEC 15.5), and the key's Redis
     * ledgers go with it so no counter can outlive the key it was counting.
     */
    async deleteKey(req: Request, res: Response) {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    data: null,
                    message: "Unauthorized"
                })
                return
            }

            const userId = req.user.user_id
            const id = req.params.id
            if (typeof id !== "string" || id.length === 0) {
                res.status(400).json({
                    success: false,
                    data: null,
                    message: "Key id is required"
                })
                return
            }

            const deleted = await aiKeyRepo.hardDelete(userId, id)
            if (!deleted) {
                res.status(404).json({
                    success: false,
                    data: null,
                    message: "API key not found"
                })
                return
            }

            // Ledgers are not secret, but a stranded counter would mislead the next key (SEC 15.6).
            await forgetKey(userId, id)

            res.status(200).json({
                success: true,
                data: { id },
                message: "API key deleted"
            })
        } catch (error) {
            logger.error(`[CONTROLLER: deleteKey] Error deleting AI key for user: ${req.user?.user_id}`, error)
            res.status(500).json({
                success: false,
                data: null,
                message: "Internal Server Error"
            })
        }
    }
}

export default new AiKeyControllers()
