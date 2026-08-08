# NextMove API (`apps/http-server`)

Express 5 · TypeScript (ESM, `NodeNext`) · Prisma/Postgres via `@repo/db` · Redis · Winston.

This is the **only** backend service. JF-001 Rev 3.0 added two tracks to it — the **web BYOK vault**
(SEC 15) and the **Phase-2 extension sync surface** (SEC 08) — and neither one added a service, a
container, or a runtime dependency. What runs in production is exactly what ran before.

Operator quick start:

```bash
cp .env.example .env          # then fill it in — the server refuses to boot without the required vars
pnpm --filter @repo/db exec prisma migrate deploy
pnpm --filter http-server run dev
```

---

## 1. Layering

`routes/ → controllers/ → repository/`. Controllers and repositories are classes exported as a
singleton instance. Every controller method is wrapped in try/catch and returns the one envelope:

```jsonc
{ "success": true, "data": {}, "message": "" }
```

Relative and `@/`-aliased imports carry a **`.js` suffix** (real ESM). Workspace imports do not.

---

## 2. Route table

### 2.1 Pre-existing

| Route | Auth | Purpose |
|---|---|---|
| `/api/webhooks` | signature | Mounted **before** `cors` and `express.json()` — Svix needs the raw body. Do not move it. |
| `/api/auth` | — / JWT | Register, login, OTP reset. |
| `/api/users` | JWT | Profile, premium status. |
| `/api/templates` | JWT | Message templates. |
| `/api/roles` | JWT | Role catalogue. |
| `/api/chat` | JWT | AI chat. |
| `/api/generate` | JWT | Recruiter-message generation. |
| `/api/cache` | admin | Cache inspection / bust. |
| `GET /` | — | Health probe: `{ status, timestamp, redis, message }`. |

### 2.2 Web BYOK vault — SEC 15.5 (`/api/ai-keys`)

A **write-only** vault. No route returns a key. There is no reveal button, and no
`GET /api/ai-keys/:id`; adding one would defeat the entire section.

| Route | Auth | Behaviour |
|---|---|---|
| `POST /api/ai-keys` | JWT | `{ key, label }` → live-validate against Google (cheapest `models.list` call) → `sealKey` → insert → returns `{ id, label, last4, status }`. Plaintext is request-scoped and never logged. |
| `GET /api/ai-keys` | JWT | Masked list only: `id, label, last4, status, lastUsedAt`. |
| `POST /api/ai-keys/:id/test` | JWT | Re-validate on demand; flips `DEAD ↔ ACTIVE`. |
| `DELETE /api/ai-keys/:id` | JWT | Hard delete — the ciphertext row is shredded immediately. |

Every query is scoped by `req.user.user_id`, so a guessed row id from another tenant resolves to
nothing.

### 2.3 Extension pairing + Phase-2 sync — SEC 8.3

| Route | Auth | Limit | Behaviour |
|---|---|---|---|
| `POST /api/devices/pair-code` | JWT | 60/min/user | Mint an 8-char single-use code into Redis `pair:{code}`, TTL 300 s. Alphabet excludes `0 O 1 I L`; generated with `node:crypto` `randomInt`. |
| `POST /api/devices/pair` | **code** | **5/min/IP** | The only unauthenticated route here — it *is* the auth step. Resolves + deletes the code, creates a `Device` row, returns a device-bound 7-day JWT. |
| `GET /api/devices` | JWT | 60/min/user | List paired installs with last-seen. |
| `DELETE /api/devices/:id` | JWT | 60/min/user | Revoke one. |
| `GET /api/sync/profile` | JWT | 60/min/user | `ProfileBlob` ciphertext down. |
| `PUT /api/sync/profile` | JWT | 60/min/user | Ciphertext up with optimistic `version` → **409** on clash; the client merges and retries. |
| `GET /api/sync/mappings` | JWT | 60/min/user | `SiteMapping` set down. |
| `PUT /api/sync/mappings` | JWT | 60/min/user | Last-write-wins per `(domain, sigHash)`. |
| `GET /api/job-applications` | JWT | 60/min/user | Cursor pagination — `?cursor=&limit=&status=`. |
| `POST /api/job-applications` | JWT | 60/min/user | Create-or-replace, **idempotent on `clientId`**. |
| `PATCH /api/job-applications/:clientId` | JWT | 60/min/user | Partial update. |
| `DELETE /api/job-applications/:clientId` | JWT | 60/min/user | Delete. |

Rows are addressed by the **`clientId` the extension minted**, not the server row id, so an offline
device can build a request without a round trip first.

`/api/sync` gets a 2 MB JSON body limit (base64 ciphertext expands ~4/3, and a mappings PUT carries
up to 5000 rows). Every other route keeps the 100 kb default.

Not served from here: **`adapters.json`** — the remote selector/synonym/budget config is a static
versioned file at `apps/web/public/extension/adapters.json` on Vercel's CDN. It needs no backend.

### 2.4 CORS — how sync ships with zero new permissions

`ORIGINS` is the allowlist, parsed into a real array and matched **exactly** (no wildcards, no
prefix matching). Adding the published extension's origin is the entire integration:

```
ORIGINS=https://nextmove-yatin.vercel.app,chrome-extension://<32-char-id>
```

That is SEC 8.2 / SEC 10: the extension is allowlisted **server-side** instead of being granted host
permissions client-side, so Phase-2 sync adds **zero** new entries to the manifest. Malformed
`chrome-extension://` entries are warned about at boot rather than failing silently in a service
worker with no console to read.

> `ORIGINS` was previously read as a raw string and matched with `String.prototype.includes`. That
> is a substring test — `"https://a.com,https://b.com".includes("https://a.co")` is `true`. It is
> now split on commas (a JSON array is also accepted) and compared for equality.

### 2.5 Rate limiting and `TRUST_PROXY`

The limiter (`src/middleware/rateLimit.ts`) is a Redis token bucket that **fails open**: during a
Redis outage it logs and lets traffic through, because a throttle that becomes an outage amplifier
is worse than no throttle.

The per-IP bucket keys on `req.ip`, which is only trustworthy once Express knows how many proxies
sit in front of it. `TRUST_PROXY` is therefore **off by default** — set it to the hop count only
when a real proxy exists, or clients can forge `X-Forwarded-For` and walk around the limiter.

---

## 3. The three key lanes — SEC 15.1

> *The key lives where the call is made.*

| Lane | Who | Key lives | Spent by |
|---|---|---|---|
| **1 · Extension BYOK** | all extension users | the device — `chrome.storage`, AES-GCM | extension service worker → Google **direct** |
| **2 · Web BYOK** | free-tier web users | Postgres — `UserGeminiKey`, envelope-sealed | this server → Google |
| **3 · Managed** | premium web users | server env — `GEMINI_API_KEY` | this server → Google |

Selection happens in exactly one place, `src/services/keyLane.service.ts`:

```
keyLane(userId, model)
  premium?  → lane 3, the managed env key (unchanged path)
  free?     → lane 2, lease from the vault via packages/rotation
  no key?   → WEB_BYOK_REQUIRED=false → fall back to managed (grandfather window)
              WEB_BYOK_REQUIRED=true  → 402 { code: 'AI_SETUP_REQUIRED' }
```

`WEB_BYOK_REQUIRED` is the SEC 15.7 rollout switch. Ship the vault and UI with it `false`, run the
30-day grandfather banner, then flip it. Premium is untouched throughout.

**Rotation** is the same math as the extension — `packages/rotation`, imported by both hosts: LRU
over healthy keys, sliding 60 s RPM window, RPD ledger with lazy Pacific-midnight reset, 429 backoff
60 s → 5 m → 30 m, `DEAD` on an invalid key. Only the storage adapters differ. Durable, low-frequency
state (`status`, `strikes`, `cooldownUntil`) lives in Postgres; hot per-minute counters live in Redis
under `aikey:rpm:{userId}:{keyId}:{model}` and `aikey:rpd:{…}`, through the fail-safe `redisCommon`
helpers — a Redis outage degrades to DB-only checks instead of failing generation.

Model budgets are **approximate** (Google revises free-tier limits without notice) and overridable
via `WEB_MODEL_BUDGETS` without a deploy.

**Lane 1 never touches this server.** INV-6: the extension's AI path goes browser → Google directly
and may not reference the API base URL. `GEMINI_API_KEY` serves web features only.

---

## 4. Migration order

Prisma Migrate, forward-only. Apply in filename order:

| # | Migration | Adds |
|---|---|---|
| … | `20260115160103_adding_auth` | last pre-JF-001 migration |
| 14 | `20260807000001_jobfill_sync_models` | `ProfileBlob`, `JobApplication` + `enum JobAppStatus`, `SiteMapping`, `Device`, and the back-relation arrays on `Users` |
| 15 | `20260807000002_web_byok_vault` | `UserGeminiKey` + `enum AiKeyStatus` |

```bash
pnpm --filter @repo/db exec prisma migrate deploy   # production
pnpm --filter @repo/db exec prisma generate         # after any schema change
```

Order matters only in that both depend on `Users` already existing. Deploying the vault migration
without setting `KEY_VAULT_MASTER_KEY` first will leave the API unable to boot — set the env var in
the same release.

Nightly `pg_dump` is unchanged. A dump on its own decrypts nothing: the master key is not in the
database.

---

## 5. Security rules — SEC 15.8 (non-negotiable)

1. **Write-only vault.** No endpoint, log line, JWT claim, cookie, or Redis value ever carries a
   plaintext key. Redis holds ledgers *about* keys, never keys. `last4` exists so the UI never has
   to touch ciphertext.
2. **One decrypt site.** `openKey` lives in `src/utils/keyVault.ts` and is called from exactly one
   place — the key-lane service — once per request, in memory, then dropped. Grep-auditable:
   `grep -rn "openKey" src/` must return the definition and that single call site.
3. **Redaction is tested, not promised.** `src/utils/redaction.ts` installs a Winston format that
   masks `AIza…` patterns and drops the values of sensitive field names before any transport sees
   the record. It is attached at boot in `src/index.ts` *and* at `keyVault.ts` import time, so the
   guarantee does not depend on import order. `scrubSecrets` is exported standalone precisely so a
   CI test can push a fake key through it and assert the key cannot survive serialization.
4. **Separate secrets.** `KEY_VAULT_MASTER_KEY` ≠ `JWT_SECRET` ≠ `INTERNAL_API_SECRET`. Rotating any
   one never touches the others. The boot sequence asserts the first two differ and that the master
   decodes to exactly 32 bytes — a truncated base64 secret decodes short and would silently weaken
   every sealed key.
5. **Vaults never sync.** Extension keys never reach this server (INV-5); web-vault keys never
   download to the extension. A user who wants both pastes twice — by design.

Crypto details: AES-256-GCM, fresh 12-byte CSPRNG IV per encryption (never derived, never
counter-based, never reused), **AAD = `userId`** so a leaked row decrypted in another user's context
fails authentication instead of silently succeeding, `authTag` stored separately, and a `keyVersion`
per row so the master can be rotated with lazy re-sealing and no downtime. Decrypt failures raise a
Winston error and bump a counter — they mean tampering, corruption, or a bug.

**Honest limit.** A fully compromised *live* server can read keys at call time. That is true of every
server-side BYOK product; it is mitigated (master key outside the DB with a KMS upgrade path, AAD
binding, write-only API, decrypt-failure alerts, log-redaction tests) rather than eliminated. Say so
on the setup page. The zero-trust alternative is lane 1 — the extension, where the key never leaves
the device.

---

## 6. Boot guards

`src/index.ts` fails fast, before `listen()`, on:

- `KEY_VAULT_MASTER_KEY` missing, blank, or not decoding to 32 base64 bytes.
- `KEY_VAULT_MASTER_KEY === JWT_SECRET` (asserted in `utils/keyVault.ts`, constant-time).

It warns, but starts, on: an empty `ORIGINS`, a malformed `chrome-extension://` entry, a
non-JSON-array `GEMINI_API_KEY_NAMES`, and a missing managed `GEMINI_API_KEY`.

Redis being down is **not** a boot failure — the app serves normally with caching, rate limiting and
hot rotation counters degraded. See `GET /`'s `redis` field.
