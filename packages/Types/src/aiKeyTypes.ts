import { z } from 'zod';

/**
 * JF-001 — Web BYOK key-vault contracts (SEC 15.5).
 *
 * The vault is write-only: `POST /api/ai-keys` takes a plaintext key, live-validates it
 * against Google, seals it with AES-256-GCM and drops the plaintext; every other route
 * speaks only in the masked shapes below. **No schema in this file ever carries a key** —
 * `last4` is the entire display surface, and there is no reveal route (SEC 15.8).
 *
 * Shared by the Express controllers in `apps/http-server` and the Settings → AI Keys panel
 * in `apps/web` (SEC 15.7), so it imports nothing but `zod` and never references Prisma.
 */

// ==================
// AI Key Vault Schemas (SEC 15.5)
// ==================

/** Durable rotation status of a vaulted key — mirrors the `AiKeyStatus` Prisma enum (SEC 15.3). */
export const aiKeyStatusSchema = z.enum(['ACTIVE', 'COOLDOWN', 'EXHAUSTED', 'DEAD']);
export type aiKeyStatusSchemaType = z.infer<typeof aiKeyStatusSchema>;

/**
 * Body of `POST /api/ai-keys`. `key` is request-scoped plaintext: it is validated, sealed
 * and discarded, and must never be logged or echoed back (SEC 15.5 / 15.8).
 */
export const addAiKeySchema = z.object({
    key: z.string({ error: "API key is required" })
        .min(20, "API key must be at least 20 characters")
        .max(200, "API key must be less than 200 characters"),
    label: z.string({ error: "Label is required" })
        .min(1, "Label is required")
        .max(40, "Label must be less than 40 characters"),
});
export type addAiKeySchemaType = z.infer<typeof addAiKeySchema>;

/**
 * The only shape `GET /api/ai-keys` (and the create response) may return — masked list only:
 * id, label, `last4`, status, lastUsedAt. Never the key itself (SEC 15.5).
 */
export const aiKeyPublicSchema = z.object({
    id: z.string(),
    label: z.string(),
    last4: z.string(),
    status: aiKeyStatusSchema,
    lastUsedAt: z.string().nullable(),
    createdAt: z.string(),
});
export type aiKeyPublicSchemaType = z.infer<typeof aiKeyPublicSchema>;

/**
 * Response of `POST /api/ai-keys/:id/test` — an on-demand re-validation against Google that
 * flips DEAD ↔ ACTIVE. `message` surfaces Google's rejection reason verbatim (SEC 15.5 / 15.7).
 */
export const aiKeyTestResultSchema = z.object({
    id: z.string(),
    status: aiKeyStatusSchema,
    ok: z.boolean(),
    message: z.string(),
});
export type aiKeyTestResultSchemaType = z.infer<typeof aiKeyTestResultSchema>;

// ==================
// Convenience aliases (short `xxxType` form used in JF-001 SEC 2.4 snippets)
// ==================

export type aiKeyStatusType = aiKeyStatusSchemaType;
export type addAiKeyType = addAiKeySchemaType;
export type aiKeyPublicType = aiKeyPublicSchemaType;
export type aiKeyTestResultType = aiKeyTestResultSchemaType;
