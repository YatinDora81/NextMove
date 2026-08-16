# NextMove

Apply to every job. Type your name once.

NextMove is a job-hunt copilot: a Chrome extension that fills any ATS
application in one click, and a web app for AI outreach, templates and a
synced application tracker — with your data encrypted client-side.

**Live app:** https://nextmove-yatin.vercel.app/

## Quick Links
- [Getting started](#getting-started)
- [Architecture](#architecture-at-a-glance)
- [API reference](#api-surface)
- [Contributing](#contributing)

## Monorepo (pnpm + Turborepo)

| Path                       | What |
|----------------------------|------|
| `apps/web`                 | Next.js 15 app — landing, generate, templates, applied tracker, AI chat, settings |
| `apps/http-server`         | Express 5 API — auth (JWT+OTP), sync, devices, Prisma/Postgres, Redis |
| `apps/extension`           | WXT MV3 extension — autofill overlay, popup, options, on-device AI keys |
| `packages/db`              | Prisma schema + client |
| `packages/Types`           | Shared types (`SharedProfile`, sync payloads) |
| `packages/vault`           | Client-side crypto (E2E profile blobs, key handling) |
| `packages/rotation`        | AI key rotation / budget helpers |
| `packages/ui`              | Shared React components |
| `packages/eslint-config`   | Flat ESLint presets (`base`, `next-js`, `react-internal`) |
| `packages/typescript-config` | Shared `tsconfig` bases |

## Product invariants (do not break)
1. The extension **never auto-submits** an application.
2. AI runs only on an explicit user gesture.
3. Local-first: guest mode is fully offline.
4. Fill >=70 confidence · suggest 50–69 · skip <50.
5. **Gemini keys never leave the device** (`GEMINI_KEY_PATTERN` + `assertSyncSafe`).

## Getting started

### Prerequisites
- Node.js >= 18 (the backend Dockerfile pins `node:24-alpine`)
- pnpm >= 10.17 (`packageManager` is pinned in the root `package.json`)
- Postgres >= 14
- Redis >= 6 (optional — cache helpers degrade to a DB hit when Redis is down)
- A Google AI Studio key (Gemini) and, for OTP email, a Gmail app password

### Install and run
    pnpm install
    pnpm dev            # turbo run dev
    pnpm check-types && pnpm lint && pnpm test && pnpm build

### Database
    cd packages/db
    pnpm dlx prisma migrate dev
    pnpm dlx prisma generate

`pnpm install` runs `@prisma/client`'s `postinstall`, which is what generates
`.prisma/client`. pnpm 10 blocks dependency lifecycle scripts by default, so the
packages that need one are allowlisted under `onlyBuiltDependencies` in
`pnpm-workspace.yaml` — removing an entry there breaks `check-types` on a clean
checkout.

### Extension dev
    pnpm --filter extension dev     # WXT dev server
    pnpm --filter extension build   # writes apps/extension/build/chrome-mv3

Load `apps/extension/build/chrome-mv3` as an unpacked extension. The `key` in
`wxt.config.ts` pins the extension id, which is what `externally_connectable`
and the web app's `NEXT_PUBLIC_EXTENSION_ID` handshake rely on — do not change it.

## Environment

Every app ships a committed `.env.example`. Copy it to `.env` and fill it in;
`.env` files are git-ignored and must stay untracked.

| App | Template | Needs |
|-----|----------|-------|
| `apps/web` | `apps/web/.env.example` | `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_EXTENSION_ID`, `NEXT_PUBLIC_CHROME_STORE_URL`, `INTERNAL_API_SECRET`, `MAIL_USER`, `MAIL_PASS` |
| `apps/http-server` | `apps/http-server/.env.example` | `PORT`, `DATABASE_URL`, `REDIS_*`, `JWT_SECRET`, `INTERNAL_API_SECRET`, `KEY_VAULT_MASTER_KEY`, `GEMINI_API_KEY`, `ORIGINS`, `ADMIN_EMAILS` |
| `packages/db` | — | `DATABASE_URL` |

Anything prefixed `NEXT_PUBLIC_` is inlined into the browser bundle at build
time. Never put a secret behind that prefix. `KEY_VAULT_MASTER_KEY`,
`JWT_SECRET`, `INTERNAL_API_SECRET` and `ADMIN_SECRET` are deliberately separate
values — rotating one must never require touching the others.

The env vars each task is allowed to read are declared per-task in `turbo.json`;
a new variable must be added there or Turborepo will not include it in the cache key.

## Architecture at a glance

```
   ┌──────────────────────────┐        ┌──────────────────────────────┐
   │  Chrome extension (MV3)  │        │        Browser (user)        │
   │  autofill · popup ·      │        └───────────────┬──────────────┘
   │  options · on-device keys│                        │ HTTPS
   └────────────┬─────────────┘                        ▼
                │ externally_connectable  ┌─────────────────────────────┐
                └────────────────────────▶│  Next.js 15 — apps/web      │
                                          │  pages · route guard ·      │
                                          │  /api/internal/send-email   │
                                          └───────────────┬─────────────┘
                                                          │ fetch + Bearer JWT
                                                          ▼
                                    ┌──────────────────────────────────────┐
                                    │  Express 5 API — apps/http-server    │
                                    │  auth · users · templates · roles    │
                                    │  generate · chat · cache · webhooks  │
                                    │  ai-keys · devices · sync ·          │
                                    │  job-applications                    │
                                    │  mw: authenticateUser/isAdmin/       │
                                    │      isPremium/rateLimit             │
                                    └──┬──────────────┬─────────────────┬──┘
                                       ▼              ▼                 ▼
                             ┌──────────────┐ ┌─────────────┐ ┌────────────────┐
                             │ Postgres     │ │ Redis cache │ │ Google Gemini  │
                             │ (Prisma)     │ │ premium:*   │ │ text-gen API   │
                             └──────────────┘ └─────────────┘ └────────────────┘
```

## API surface

Base URL = `NEXT_PUBLIC_BASE_URL`. Everything except `/api/auth/*` and
`/api/webhooks/*` requires `Authorization: Bearer <jwt>`. Mount points are in
`apps/http-server/src/index.ts`; each router in `src/routes/` is the source of
truth for its own paths.

| Mount | Purpose |
|-------|---------|
| `/api/auth` | Signup, login, forgot-password, verify-otp, change-password |
| `/api/users` | Profile, premium status, admin user list |
| `/api/templates` | Template CRUD, common templates, AI template generation (premium) |
| `/api/roles` | Role taxonomy; create/delete are admin-only |
| `/api/generate` | Gemini message generation + history |
| `/api/chat` | Persistent AI chat rooms (premium) |
| `/api/cache` | Redis flush (admin only) |
| `/api/ai-keys` | Bring-your-own Gemini keys, stored via `packages/vault` |
| `/api/devices` | Device pairing codes, listing, revocation |
| `/api/sync` | Encrypted profile + field-mapping sync (2 MB JSON limit) |
| `/api/job-applications` | Application tracker records |
| `/api/webhooks` | Svix-verified Clerk webhooks (legacy provisioning) |
| `/api/internal/send-email` | Next.js route, gated by `x-internal-secret`, sends OTP/SMTP mail |

## Auth model

- **JWT** signed with `JWT_SECRET`, 7-day expiry, payload shaped by
  `authTokenSchemaType` in `@repo/types`.
- `authenticateUser` distinguishes `TokenExpiredError` from `JsonWebTokenError`
  so the client can tell "session expired" from "tampered".
- Cookies: `nextmove_auth_token` (HttpOnly, 7 days, carries the JWT) and
  `nextmove_user` (readable, hydrates the UI without an extra fetch). Both are
  `secure` in production with `sameSite: lax`.
- Passwords are bcrypt-hashed at 12 rounds. OTPs live 10 minutes, reset tokens
  5 minutes, and a `PasswordReset` row is single-use.
- `apps/web/middleware.ts` guards the authenticated routes and redirects to
  `/?popup=login&redirect_url=…` so sign-in happens inline.
- CORS is allowlisted from `ORIGINS`, with credentials enabled.

## Caching

`utils/redisCommon.ts` wraps `getRedis` / `setRedis` / `clearRedis`; all three
swallow errors and log through Winston, so a Redis outage degrades to a DB hit
rather than a failed request.

| Key | TTL | Invalidation |
|-----|-----|--------------|
| `premium:{userId}` | 24 h | TTL only |
| `generated-{userId}` | — | Cleared on every new generation |
| `common-templates` | — | Admin `DELETE /api/cache/clear-all-cache` |

## Database

Postgres via Prisma 6. `packages/db/prisma/schema.prisma` is the source of truth.
Core models: `Users`, `PasswordReset`, `Templates`, `TemplateRules`,
`AiTemplate`, `GeneratedMessages`, `Role`, `Company`, `Resumes`, `Room`,
`Message`, plus the device/sync/job-application tables. Enums: `MessageBy`,
`MessageType`, `CreatedBy`.

A `GeneratedMessage` points at exactly one Template, Role, Company and User, which
is what makes the applied tracker a fully traceable record.

Never edit an existing migration — add a new one.

## Quality gate

    pnpm --filter web check-types && pnpm --filter web lint
    pnpm --filter extension check-types && pnpm --filter extension lint && pnpm --filter extension test
    pnpm --filter http-server check-types

Linting is the ESLint 9 flat-config CLI (`eslint .`) in every workspace —
`next lint` is deprecated and removed in Next 16. Warnings are fatal:
`@repo/eslint-config` loads `eslint-plugin-only-warn`, so every rule reports as a
warning and `--max-warnings 0` is the entire strictness of the gate. Do not drop
that flag.

## Design system

Quiet Precision — see `docs/DESIGN_SYSTEM.md`. Grayscale first, one cobalt accent
(`#4353e8` light / `#8492ff` dark) at most four times per screen, hierarchy from
weight rather than colour, 40 px grid heroes, the black-N logo chip. No gradients,
glassmorphism, glow shadows or 800-weight display type.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `pnpm install` fails with Prisma errors | Ensure `onlyBuiltDependencies` lists packages needing postinstall in `pnpm-workspace.yaml` |
| Extension doesn't load in Chrome | Verify `extension id` in `wxt.config.ts` matches `NEXT_PUBLIC_EXTENSION_ID` in web `.env` |
| Redis connection timeout | Redis is optional; cache layer degrades to DB reads — check `REDIS_URL` if intentionally using Redis |
| Type errors in `@repo/types` | Run `pnpm --filter db generate` to regenerate Prisma client after schema changes |
| `GEMINI_API_KEY` errors in extension | Check that key is stored via `/api/ai-keys` vault; keys never leave the device |
| Migrations failing on dev | Ensure PostgreSQL is running and `DATABASE_URL` is correct; never edit existing migrations |

## Contributing

1. Branch as `feat/<area>` or `fix/<area>`.
2. Match the conventions of the app you are in — `apps/web` is 4-space, no
   semicolons, double quotes; `apps/extension` is 2-space, semicolons, single quotes.
3. Put any new request body in a shared Zod schema in `packages/Types`. Never
   duplicate validation across frontend and backend.
4. Add a new Prisma migration for any schema change.
5. Run the quality gate above before opening a PR.
6. Describe intent in the PR, with screenshots or curl examples for anything
   user-facing.

## License

MIT
