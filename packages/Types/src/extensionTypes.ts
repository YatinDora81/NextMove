import { z } from 'zod';

/**
 * JF-001 — JobFill extension ↔ NextMove API shared contracts.
 *
 * These schemas are the single source of truth for every sync request/response body
 * (SEC 8.3 route additions, SEC 8.4 "shared contracts", SEC 14.3 reuse map). They are
 * imported by three runtimes — the Express controllers in `apps/http-server`, the
 * Next.js app in `apps/web`, and the extension's sync client in `apps/extension` — so
 * this module must stay self-contained: `zod` is the only import, and no Prisma type
 * is ever referenced here.
 */

// ==================
// Job Application Sync (SEC 8.3 · GET/POST/PATCH/DELETE /api/job-applications)
// ==================

/** Mirrors the `JobAppStatus` Prisma enum (SEC 7.4) without importing from @repo/db. */
export const jobAppStatusSchema = z.enum(['DRAFT', 'APPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'GHOSTED']);
export type jobAppStatusSchemaType = z.infer<typeof jobAppStatusSchema>;

// ==================
// Device Pairing (SEC 8.2 · POST /api/devices/pair-code · POST /api/devices/pair)
// ==================

/** Response of `POST /api/devices/pair-code` — 8-char single-use code held in Redis for 300s. */
export const pairCodeResponseSchema = z.object({
    code: z.string(),
    expiresInSec: z.number(),
});
export type pairCodeResponseSchemaType = z.infer<typeof pairCodeResponseSchema>;

/** Body of `POST /api/devices/pair` — public route, rate-limited 5/min/IP (SEC 8.3). */
export const pairRequestSchema = z.object({
    code: z.string({ error: "Pairing code is required" })
        .min(6, "Pairing code must be at least 6 characters")
        .max(12, "Pairing code must be less than 12 characters"),
    deviceName: z.string({ error: "Device name is required" })
        .min(1, "Device name is required")
        .max(60, "Device name must be less than 60 characters"),
});
export type pairRequestSchemaType = z.infer<typeof pairRequestSchema>;

/** A `Device` row as it crosses the wire — dates are serialised to ISO strings (SEC 8.3). */
export const deviceRowSchema = z.object({
    id: z.string(),
    name: z.string().nullable(),
    lastSeen: z.string().nullable(),
    createdAt: z.string().optional(),
});
export type deviceRowSchemaType = z.infer<typeof deviceRowSchema>;

/** Response of `POST /api/devices/pair` — device-bound 7-day JWT + the created row. */
export const pairResponseSchema = z.object({
    token: z.string(),
    device: deviceRowSchema,
});
export type pairResponseSchemaType = z.infer<typeof pairResponseSchema>;

// ==================
// E2E Profile Blob Sync (SEC 8.3 · GET/PUT /api/sync/profile)
// ==================

/**
 * The server-blind profile vault envelope. `ciphertext` and `nonce` are base64 strings
 * on the wire (Bytes in Postgres); `version` drives optimistic locking — a PUT carrying
 * a stale version is rejected with 409 VERSION_CONFLICT and the client merges (SEC 8.3).
 */
export const profileBlobEnvelopeSchema = z.object({
    ciphertext: z.string({ error: "Ciphertext is required" }).min(1, "Ciphertext is required"),
    nonce: z.string({ error: "Nonce is required" }).min(1, "Nonce is required"),
    version: z.number().int().nonnegative(),
});
export type profileBlobEnvelopeSchemaType = z.infer<typeof profileBlobEnvelopeSchema>;

// ==================
// Job Application Sync bodies (SEC 8.3 · idempotent on clientId)
// ==================

/**
 * A tracker row pushed up from the extension. `clientId` is the extension-side row id and
 * makes retries idempotent (SEC 7.4). All timestamps are ISO strings.
 */
export const jobApplicationRowSchema = z.object({
    clientId: z.string({ error: "clientId is required" }).min(1, "clientId is required"),
    company: z.string({ error: "Company is required" }).min(1, "Company is required"),
    role: z.string({ error: "Role is required" }).min(1, "Role is required"),
    url: z.string().nullable().optional(),
    ats: z.string().nullable().optional(),
    status: jobAppStatusSchema.default('APPLIED'),
    appliedAt: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    fillStats: z.object({ filled: z.number(), total: z.number() }).nullable().optional(),
    history: z.array(z.object({ at: z.number(), to: jobAppStatusSchema })).nullable().optional(),
});
export type jobApplicationRowSchemaType = z.infer<typeof jobApplicationRowSchema>;

/**
 * Body of `PATCH /api/job-applications/:clientId` — every field optional, clientId comes from the path.
 *
 * `status` is re-declared without the row schema's `.default('APPLIED')` on purpose: Zod's `.partial()`
 * wraps a defaulted field in `optional()` but does NOT strip the default, so a patch body that omits
 * `status` would still parse to `{ status: 'APPLIED' }` and silently reset an INTERVIEW/OFFER row.
 * A PATCH must only ever carry the keys the caller actually sent.
 */
export const jobApplicationPatchSchema = jobApplicationRowSchema
    .extend({ status: jobAppStatusSchema })
    .partial()
    .omit({ clientId: true });
export type jobApplicationPatchSchemaType = z.infer<typeof jobApplicationPatchSchema>;

// ==================
// Site Mapping Sync (SEC 8.3 · GET/PUT /api/sync/mappings)
// ==================

/** One learn-from-correction memory (F-13): a field signature hash on a domain → a profile path. */
export const siteMappingRowSchema = z.object({
    domain: z.string({ error: "Domain is required" }).min(1, "Domain is required"),
    sigHash: z.string({ error: "sigHash is required" }).min(1, "sigHash is required"),
    profilePath: z.string({ error: "Profile path is required" }).min(1, "Profile path is required"),
});
export type siteMappingRowSchemaType = z.infer<typeof siteMappingRowSchema>;

/** Body of `PUT /api/sync/mappings` — last-write-wins per (domain, sigHash). */
export const siteMappingsPutSchema = z.object({
    mappings: z.array(siteMappingRowSchema).max(5000, "At most 5000 mappings may be synced at once"),
});
export type siteMappingsPutSchemaType = z.infer<typeof siteMappingsPutSchema>;

// ==================
// Remote Adapter Config (F-14 · SEC 8.3)
// ==================

/**
 * Shape of the versioned selector/synonym/model-budget data served statically from
 * `apps/web/public/extension/adapters.json` on Vercel's CDN (F-14, SEC 8.3). The extension
 * polls it daily via an alarm and Zod-validates + semver-gates it before it is allowed to
 * replace the shipped seed. `modelBudgets` values are approximate, config-driven ceilings —
 * Google revises free-tier limits without notice, so nothing here is hardcoded (SEC 5.2).
 */
export const remoteAdapterConfigSchema = z.object({
    version: z.string({ error: "Config version is required" }).min(1, "Config version is required"),
    updatedAt: z.string({ error: "updatedAt is required" }).min(1, "updatedAt is required"),
    modelBudgets: z.record(z.string(), z.object({ rpm: z.number(), rpd: z.number() })).optional(),
    synonyms: z.record(z.string(), z.array(z.string())).optional(),
    adapters: z.record(z.string(), z.object({
        fieldMap: z.record(z.string(), z.string()).optional(),
        quirks: z.record(z.string(), z.unknown()).optional(),
        capture: z.object({
            company: z.array(z.string()).optional(),
            role: z.array(z.string()).optional(),
        }).optional(),
        confirmation: z.object({
            urlPatterns: z.array(z.string()).optional(),
            selectors: z.array(z.string()).optional(),
        }).optional(),
    })).optional(),
});
export type remoteAdapterConfigSchemaType = z.infer<typeof remoteAdapterConfigSchema>;

// ==================
// Sync Error Codes (SEC 8.3 / 8.4)
// ==================

/**
 * The machine-readable `code` the sync API returns inside the standard
 * `{ success, data, message }` envelope so the extension can react without string matching:
 * - `INVALID_OR_EXPIRED_CODE` — 401 from `POST /api/devices/pair` (SEC 8.2)
 * - `VERSION_CONFLICT`        — 409 from `PUT /api/sync/profile` on a stale version (SEC 8.3)
 * - `RATE_LIMITED`            — 429; pair 5/min/IP, authed sync 60/min/user (SEC 8.4)
 * - `AI_SETUP_REQUIRED`       — 402; free user with no vault key (SEC 15.5)
 * - `DEVICE_REVOKED`          — 401 after the device row was deleted in web Settings (SEC 8.5)
 */
export const syncErrorCodeSchema = z.enum([
    'INVALID_OR_EXPIRED_CODE',
    'VERSION_CONFLICT',
    'RATE_LIMITED',
    'AI_SETUP_REQUIRED',
    'DEVICE_REVOKED',
]);
export type syncErrorCodeSchemaType = z.infer<typeof syncErrorCodeSchema>;

// ==================
// Convenience aliases (short `xxxType` form used in JF-001 SEC 2.4 snippets)
// ==================

export type jobAppStatusType = jobAppStatusSchemaType;
export type pairCodeResponseType = pairCodeResponseSchemaType;
export type pairRequestType = pairRequestSchemaType;
export type deviceRowType = deviceRowSchemaType;
export type pairResponseType = pairResponseSchemaType;
export type profileBlobEnvelopeType = profileBlobEnvelopeSchemaType;
export type jobApplicationRowType = jobApplicationRowSchemaType;
export type jobApplicationPatchType = jobApplicationPatchSchemaType;
export type siteMappingRowType = siteMappingRowSchemaType;
export type siteMappingsPutType = siteMappingsPutSchemaType;
export type remoteAdapterConfigType = remoteAdapterConfigSchemaType;
export type syncErrorCodeType = syncErrorCodeSchemaType;
