import express from 'express'
import { config } from "dotenv"
import userRoutes from './routes/users.js'
import templatesRoutes from './routes/templates.js'
import rolesRoutes from './routes/roles.js'
import chatRoutes from './routes/chat.js'
import generateRoutes from './routes/generatedMessage.js'
import webhookRoutes from './routes/webhook.js'
import authRoutes from './routes/auth.js'
import cors from 'cors'
import cacheRoutes from './routes/cache.js'
import aiKeyRoutes from './routes/aiKeys.js'
import deviceRoutes from './routes/devices.js'
import syncRoutes from './routes/sync.js'
import jobApplicationRoutes from './routes/jobApplications.js'
import { isRedisReady } from './config/redis.js'
import logger from './config/logger.js'
import { installRedaction } from './utils/redaction.js'

const app = express()
config()

/* ---------------------------------------------------------------------------------------------
 * Boot guards (JF-001 SEC 15.4 / 15.8)
 *
 * These run before a single request is served. A server that boots half-configured is worse than
 * one that refuses to boot: it would either seal user API keys under a weak master or fail on the
 * first paying request, in production, at 3am.
 * ------------------------------------------------------------------------------------------- */

/**
 * SEC 15.8 "Write-only vault / no log line ever carries a plaintext key".
 *
 * `utils/keyVault.ts` already hardens the shared Winston logger at its own import time, but the
 * vault is only reachable through the `/api/ai-keys` chain. Installing it here as well makes the
 * guarantee unconditional and independent of import order — every transport on the shared logger
 * is redacted from the first line the process ever writes. `installRedaction` is idempotent, so
 * the second call is a no-op.
 */
installRedaction(logger)

/** How many raw bytes `KEY_VAULT_MASTER_KEY` must decode to — AES-256 takes a 32-byte key. */
const KEY_VAULT_MASTER_KEY_BYTES = 32

/**
 * SEC 15.4 — fail fast when the vault master key is missing or malformed, in the same shape as the
 * existing `JWT_SECRET` guard in `controllers/authControllers.ts`.
 *
 * `Buffer.from(x, 'base64')` silently drops characters it does not understand, so a truncated or
 * line-wrapped secret decodes to a *short* buffer rather than throwing. The length assertion is
 * what turns that silent weakening into a boot failure.
 *
 * SEC 15.8 "Separate secrets": `KEY_VAULT_MASTER_KEY !== JWT_SECRET !== INTERNAL_API_SECRET`.
 * The constant-time equality check against `JWT_SECRET` lives in `utils/keyVault.ts` (the one file
 * allowed to hold master key material); this guard deliberately only asserts shape, so the master
 * key never has to be read into this module.
 *
 * Note on ordering: ES module bodies evaluate after their imports, and `utils/keyVault.ts` runs the
 * equivalent assertion at *its* import time (reached via `./routes/aiKeys.js` above). Whichever
 * fires first, the process dies before `listen()` with the variable named in the message. This
 * guard is the backstop that keeps that guarantee even if the vault chain is ever lazy-loaded.
 */
const assertKeyVaultMasterKey = (): void => {
    const raw = process.env.KEY_VAULT_MASTER_KEY

    if (raw === undefined || raw.trim().length === 0) {
        throw new Error(
            "KEY_VAULT_MASTER_KEY is not configured in environment variables. " +
            "The web BYOK vault (JF-001 SEC 15) cannot seal or open user Gemini keys without it. " +
            `Generate one with: openssl rand -base64 ${KEY_VAULT_MASTER_KEY_BYTES}  ` +
            "— it MUST be a different value from JWT_SECRET (SEC 15.8: separate secrets)."
        )
    }

    const decodedBytes = Buffer.from(raw.trim(), "base64").byteLength
    if (decodedBytes !== KEY_VAULT_MASTER_KEY_BYTES) {
        throw new Error(
            `KEY_VAULT_MASTER_KEY must decode to exactly ${KEY_VAULT_MASTER_KEY_BYTES} bytes of base64, ` +
            `but it decoded to ${decodedBytes}. A truncated or line-wrapped secret decodes short and would ` +
            `weaken every sealed key. Regenerate with: openssl rand -base64 ${KEY_VAULT_MASTER_KEY_BYTES}`
        )
    }
}

assertKeyVaultMasterKey()

/**
 * Webhooks stay mounted BEFORE `cors` and BEFORE `express.json()` on purpose: Svix signature
 * verification needs the raw, unparsed body, and the sender is a server (no browser, no Origin
 * header, no preflight). Do not move this line.
 */
app.use('/api/webhooks', webhookRoutes)

/* ---------------------------------------------------------------------------------------------
 * CORS allowlist (SEC 8.2 / SEC 10)
 *
 * Phase-2 extension sync ships with ZERO new manifest permissions precisely because the extension's
 * `chrome-extension://<id>` origin is allowlisted here instead of being granted host permissions in
 * the manifest. Add the published extension id to `ORIGINS` and sync works; that is the whole
 * mechanism.
 *
 * `ORIGINS` used to be read straight out of the environment as a raw string and matched with
 * `String.prototype.includes`, which "worked" only by accident: `"https://a.com,https://b.com"`
 * .includes(origin) is a SUBSTRING test, so it also accepted `https://a.co`, `a.com,https://b.com`,
 * and any attacker-controlled origin that happened to be a substring of the list. It is parsed into
 * a real array below, and matched exactly. Existing, correctly spelled origins keep working.
 * ------------------------------------------------------------------------------------------- */

/**
 * Origins compare case-insensitively on scheme and host, and a trailing slash is not part of an
 * origin — normalise both away so a cosmetic difference in the env var is not a production outage.
 */
const normaliseOrigin = (value: string): string => value.trim().replace(/\/+$/, '').toLowerCase()

/**
 * Parse `ORIGINS` into a real array. Both shapes an operator might reasonably write are accepted:
 * a JSON array (`["https://a.com","chrome-extension://abc"]`) and the plain comma-separated list
 * this deployment currently uses. A malformed JSON array falls through to comma-splitting rather
 * than throwing — a typo in an allowlist must not take the API offline.
 */
const parseOrigins = (raw: string | undefined): string[] => {
    if (raw === undefined) return []

    const trimmed = raw.trim()
    if (trimmed.length === 0) return []

    if (trimmed.startsWith('[')) {
        try {
            const parsed: unknown = JSON.parse(trimmed)
            if (Array.isArray(parsed)) {
                return parsed
                    .filter((entry): entry is string => typeof entry === 'string')
                    .map(normaliseOrigin)
                    .filter((entry) => entry.length > 0)
            }
            logger.warn('[CORS] ORIGINS looked like JSON but is not an array — falling back to comma-splitting.')
        } catch {
            logger.warn('[CORS] ORIGINS starts with "[" but is not valid JSON — falling back to comma-splitting.')
        }
    }

    return trimmed
        .split(',')
        .map(normaliseOrigin)
        .filter((entry) => entry.length > 0)
}

/** Chrome extension ids are exactly 32 characters from the alphabet `a`–`p`. */
const CHROME_EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/

const allowedOrigins: string[] = parseOrigins(process.env.ORIGINS)

// SEC 8.2 — surface allowlist problems at boot, where an operator sees them, instead of as a
// mysterious CORS failure in the extension's service worker with no console to read.
for (const entry of allowedOrigins) {
    if (!entry.startsWith('chrome-extension://')) continue
    if (!CHROME_EXTENSION_ORIGIN.test(entry)) {
        logger.warn(
            `[CORS] ORIGINS entry "${entry}" is not a well-formed chrome-extension origin ` +
            '(expected chrome-extension://<32 chars a-p>, no trailing path). The extension will be blocked.'
        )
    }
}

if (allowedOrigins.length === 0) {
    logger.warn('[CORS] ORIGINS is empty — every cross-origin browser request will be rejected.')
} else {
    const extensionOrigins = allowedOrigins.filter((entry) => entry.startsWith('chrome-extension://')).length
    logger.info(
        `[CORS] ${allowedOrigins.length} allowed origin(s) loaded ` +
        `(${extensionOrigins} chrome-extension, ${allowedOrigins.length - extensionOrigins} web).`
    )
}

/**
 * Exact-match membership test.
 *
 * `chrome-extension://<id>` needs no special case here — once `ORIGINS` is a real array, a browser
 * that sends `Origin: chrome-extension://abc…` matches its allowlist entry like any other origin.
 * The special case is the *absence* of one: no wildcards, no prefix matching, no
 * `startsWith('chrome-extension://')` escape hatch that would allowlist every extension ever
 * installed in the user's browser.
 */
const isAllowedOrigin = (origin: string): boolean => allowedOrigins.includes(normaliseOrigin(origin))

app.use(cors({
  origin: (origin, callback) => {
    // Same-origin requests, server-to-server calls and some extension service-worker fetches send
    // no Origin header at all. Preserved from the original implementation.
    if (!origin) return callback(null, true);
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    } else {
      logger.warn(`[CORS] Rejected origin: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));

/**
 * Sync payloads are legitimately larger than the 100 kb body-parser default: an E2E-encrypted
 * profile blob is base64 (≈4/3 expansion) and `siteMappingsPutSchema` allows up to 5000 mapping
 * rows in one PUT (SPINE 2.4). Scoping the larger limit to `/api/sync` keeps every pre-existing
 * route on the original default — body-parser is a no-op once `req.body` has been populated, so
 * the global parser below simply skips a request this one already handled.
 */
app.use('/api/sync', express.json({ limit: '2mb' }))

app.use(express.json())
const PORT = process.env.PORT

/**
 * `rateLimit`'s per-IP bucket (SEC 8.4, `POST /api/devices/pair` at 5/min/IP) keys on `req.ip`,
 * which is only trustworthy once Express knows how many proxies sit in front of it. Left OFF by
 * default — enabling `trust proxy` on a directly exposed server lets any client forge
 * `X-Forwarded-For` and walk straight around the limiter. Set `TRUST_PROXY` to the number of hops
 * (`1` behind a single load balancer) only when there really is a proxy.
 */
const trustProxy = (process.env.TRUST_PROXY ?? '').trim()
if (trustProxy.length > 0) {
    const hops = Number.parseInt(trustProxy, 10)
    app.set('trust proxy', Number.isNaN(hops) ? trustProxy : hops)
    logger.info(`[BOOT] trust proxy enabled: ${trustProxy}`)
}

app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/templates', templatesRoutes)
app.use('/api/roles', rolesRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/generate', generateRoutes)
app.use('/api/cache', cacheRoutes)

// JF-001 SEC 15.5 — write-only Gemini key vault (web BYOK, lane 2).
app.use('/api/ai-keys', aiKeyRoutes)
// JF-001 SEC 8.2/8.3 — extension pairing + Phase-2 sync surface.
app.use('/api/devices', deviceRoutes)
app.use('/api/sync', syncRoutes)
app.use('/api/job-applications', jobApplicationRoutes)

app.get('/', (_, res) => {
    res.status(200).json({
        status: "Ok",
        timestamp: new Date().toISOString(),
        redis: isRedisReady() ? "connected" : "disconnected",
        message: "Next Move Server is Up!!!"
    })
})

process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled promise rejection: ${reason}`)
})

process.on('uncaughtException', (error) => {
    logger.error(`Uncaught exception: ${error?.stack || error}`)
})

app.listen(PORT, () => {
    console.log(`App is running on ${PORT} PORT`)
})
