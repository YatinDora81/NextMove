# NextMoveApp

> An AI-powered job application management platform that helps job seekers craft personalized recruiter messages, manage reusable templates, track applications, and accelerate the path to their next role.

**Live App:** https://nextmove-yatin.vercel.app/

**Visit the live application**: [https://nextmove-yatin.vercel.app/](https://nextmove-yatin.vercel.app/)
---

## Table of Contents

- [Project Overview](#project-overview)
- [Core Features (In Detail)](#core-features-in-detail)
- [Architecture at a Glance](#architecture-at-a-glance)
- [Tech Stack](#tech-stack)
- [Monorepo Layout](#monorepo-layout)
- [Database Schema](#database-schema)
- [Authentication System](#authentication-system)
- [API Reference](#api-reference)
- [Caching Strategy (Redis)](#caching-strategy-redis)
- [AI Integration (Google Gemini)](#ai-integration-google-gemini)
- [Frontend Architecture](#frontend-architecture)
- [Middleware & Authorization](#middleware--authorization)
- [Environment Variables](#environment-variables)
- [Local Development Setup](#local-development-setup)
- [Build, Lint, and Type-check](#build-lint-and-type-check)
- [Database Migrations & Seeding](#database-migrations--seeding)
- [Deployment Notes](#deployment-notes)
- [Project Complexity Breakdown](#project-complexity-breakdown)
- [Roadmap / Possible Improvements](#roadmap--possible-improvements)
- [Contributing](#contributing)
- [License](#license)

---

## Project Overview

NextMoveApp is a **full-stack TypeScript monorepo** built around the recurring pain points of an active job-seeker:

1. Writing personalized but professional outreach messages over and over again.
2. Keeping track of which templates work for which roles.
3. Maintaining a history of who they messaged, for what role, at which company.
4. Iterating on outreach with AI without losing the user's voice.

The app combines:

- A **Next.js 15 (App Router)** front end with custom-themed Tailwind 4 UI, motion animations, Radix UI primitives, and a fully custom marketing landing page.
- An **Express 5 + TypeScript** REST API on Node.js, secured with JWT and gated by tier (free vs. premium) and role (admin).
- A **PostgreSQL + Prisma** persistence layer modeled around Users, Templates, AI Templates, Generated Messages, Roles, Companies, and a Chat Room/Message structure.
- **Google Gemini (`@google/genai`)** for two distinct generative flows: per-message generation and full template generation.
- **Redis** for hot-path caching of premium status, generated messages, and shared / common templates.
- **Nodemailer + Gmail SMTP** wrapped behind an internal-secret-protected Next.js API route to deliver branded HTML OTP emails.
- A **Clerk → custom-JWT migration**: Clerk webhooks are still wired in, but the primary login/signup is now a self-hosted email + password + OTP flow with bcrypt hashing.

---

## Core Features (In Detail)

### 1. Custom Authentication (Email + Password + OTP)

A complete, self-hosted auth system built end-to-end:

- **Signup** — Zod-validated, bcrypt-hashed (12 rounds), JWT-signed (7-day expiry), automatic cookie issue.
- **Login** — Email + password with case-insensitive email matching and graceful messaging when a user originally signed up via social login (no password set).
- **Forgot Password / OTP Flow** — 3-step state machine:
  1. `POST /api/auth/forgot-password` → generates a 6-digit OTP, persists to `PasswordReset` with a 10-minute expiry, and emails a branded HTML OTP template.
  2. `POST /api/auth/verify-otp` → validates the OTP, returns a short-lived `resetToken` (5-minute expiry).
  3. `POST /api/auth/change-password` → consumes the `resetToken`, marks the row as `used`, and writes a new bcrypt hash.
- **Cookie strategy** — `nextmove_auth_token` (HttpOnly, Secure in prod, `sameSite: lax`, 7-day) for the JWT, plus `nextmove_user` (non-HttpOnly, JSON-serialized) for client-side UI hydration.
- **Route protection** — `apps/web/middleware.ts` matches on `/generate`, `/templates`, `/applied`, `/ai-chat`, `/dashboard`, `/forum`, `/on-boarding` and redirects unauthenticated visitors to `/?popup=login&redirect_url=…` so they can sign in inline and bounce back.
- **Popup-based UI** — All auth flows are URL-driven via `?popup=login|signup|forgot-password`, which means deep-linking, sharing, and back-button behavior all work.
- **Internal email API** — Backend never holds SMTP credentials directly; instead it calls the Next.js `/api/internal/send-email` route protected by a shared `INTERNAL_API_SECRET` header, keeping the email surface inside one runtime.
- **Clerk fallback** — Clerk is still installed (`@clerk/nextjs`, `@clerk/backend`) and the `/api/webhooks/clerk` route handles `user.created`, `user.updated`, and `user.deleted` events via Svix verification, so users provisioned through Clerk continue to sync into the local `Users` table.

### 2. AI Message Generation

- Built on **Google Gemini** through `@google/genai`.
- Prompt-engineered with a multi-section system prompt (`apps/http-server/src/utils/ai-chat-Instruction.ts`) that:
  - Forces strict JSON output (no markdown fences) for reliable parsing.
  - Distinguishes "Message" (single-paragraph LinkedIn DM) vs. "Email" (multi-paragraph) format.
  - Detects follow-ups by inspecting `predefinedMessages` and `previousMessages`, and rephrases instead of duplicating prior text.
  - Auto-derives a chat-room name (e.g. `"Ram Google Follow-up"`) and description on first turn.
  - Reformulates casual/typo'd user inputs ("what aboud hr round") into polished outreach.
- All generations are persisted in `GeneratedMessages`, linked to the originating `Templates`, `Role`, `Company`, and `Users` rows.
- Caching: list endpoint reads through `generated-{userId}` Redis key; the writer invalidates that key on every new generation.

### 3. AI Template Generator

- A second, distinct Gemini prompt (`template-instruction.ts`) tuned specifically for **referral / job-inquiry templates**:
  - Hard cap of 4–5 lines for `MESSAGE` type, 6–8 for `EMAIL`.
  - Allowed placeholders are strictly `[Recruiter Name]` and `[MY NAME]`. Any other "fill-in" placeholder is forbidden.
  - The model picks role-appropriate technologies inline (e.g. "React, Node.js, and PostgreSQL" for Full Stack, "Docker, Kubernetes, and AWS" for DevOps) — no `[mention tech]` blanks.
  - Returns `{ message, rules, templateName, templateDescription }` so the UI can immediately surface a context-aware name like "Friend Referral - Full Stack" or "Senior Referral - Frontend".
- Stored in a dedicated `AiTemplate` table with `prompt`, `history[]`, `roleName`, `roleNameId`, and `rules[]`, enabling iterative refinement (the user can keep typing follow-up prompts and the model sees the full history).
- Gated behind `isPremium` middleware.

### 4. Template Management

- CRUD endpoints under `/api/templates` for user-owned templates.
- Soft-delete via `isDeleted` flag (no row-level loss).
- `isCommon` flag for shared/common templates that any user can read; cached at `common-templates`.
- `createdBy` enum (`SELF` | `AI`) so the UI can badge AI-generated templates differently.
- `TemplateRules` 1-to-many sub-table for free-form rules attached to a template (used by the placeholder substitution UI).
- Bulk upload endpoint (`/add-template-bulk`, admin-only) used by the seed script.
- Filter, categorize by job role, and filter by type (`EMAIL` / `MESSAGE`).

### 5. Application Tracking ("Applied")

- Every generated message is effectively a tracked application: who you messaged, for which role, at which company, with which template, and on what date.
- The "Applied" page (`apps/web/app/applied/page.tsx`) is the read view over `GeneratedMessages` joined to `Role`, `Company`, and `Templates`.

### 6. AI Chat (Premium)

- Persistent conversation rooms (`Room`) with messages (`Message`) tagged by `MessageBy` (`AI` | `SELF`).
- Predefined message starters per room (`predefinedMessages: String[]`) so the user can fire off a "Follow Up" or "Generate" with one tap.
- Gated behind `authenticateUser` + `isPremium` middleware chain.

### 7. Roles & Companies

- `Role` is a first-class entity with name + description; admin-only create/delete (`isAdmin`).
- `Company` is auto-created per generation flow and tied back to the user who first added it.
- Both are reused as foreign keys across templates and generated messages so analytics/grouping is trivial.

### 8. Admin & Premium Tiers

- **Admin** is configured via the `ADMIN_EMAILS` env var — any email in that list passes `isAdmin`.
  Admin-only actions: bulk template insert, role create/delete, cache flush, user list, premium toggle.
- **Premium** is a per-user `isPaid` boolean. The `isPremium` middleware reads through Redis (`premium:{userId}`, 24-hour TTL), so toggling premium-only features stays cheap on the hot path.

### 9. Themed UI & Landing Page

- Marketing landing page with hero, animated background, dark/light product-screenshot GIFs, stats, feature grid, "How it works", use cases, testimonials, multiple CTAs, and a footer.
- Custom resizable navbar (`components/ui/resizable-navbar.tsx`) that collapses on scroll.
- Mobile-first, fully responsive (`text-3xl` on mobile → `text-7xl` on desktop, etc.).
- `next-themes` for dark/light mode with no flash on hydration.
- Geist + Geist Mono custom fonts.
- Toast notifications via `react-hot-toast`, theme-aware (`ThemeAwareToaster`).

---

## Architecture at a Glance

```
                      ┌────────────────────────────┐
                      │       Browser (User)       │
                      └──────────────┬─────────────┘
                                     │  HTTPS
                                     ▼
                ┌─────────────────────────────────────────┐
                │   Next.js 15 (App Router) — apps/web    │
                │   • Landing + protected pages           │
                │   • Auth modals via ?popup=… URLs       │
                │   • middleware.ts route guard           │
                │   • /api/internal/send-email (SMTP)     │
                └──────────────┬──────────────────────────┘
                               │  fetch + Bearer JWT
                               ▼
                ┌─────────────────────────────────────────┐
                │ Express 5 API — apps/http-server        │
                │   • /api/auth   (JWT + bcrypt + OTP)    │
                │   • /api/users  /templates  /roles      │
                │   • /api/generate  /chat  /cache        │
                │   • /api/webhooks/clerk (Svix verified) │
                │   • Middleware: authenticate / isAdmin  │
                │                  / isPremium            │
                └──┬──────────────────┬─────────────────┬─┘
                   │                  │                 │
                   ▼                  ▼                 ▼
        ┌───────────────────┐ ┌───────────────┐ ┌────────────────┐
        │  Postgres (Prisma)│ │  Redis cache  │ │  Google Gemini │
        │  Users, Templates │ │  premium:*    │ │  text-gen API  │
        │  GeneratedMessages│ │  generated-*  │ │                │
        │  Role, Company,   │ │  common-*     │ └────────────────┘
        │  Room, Message,   │ └───────────────┘
        │  AiTemplate, etc. │
        └───────────────────┘
```

---

## Tech Stack

### Frontend (`apps/web`)

| Concern              | Choice                                                                 |
| -------------------- | ---------------------------------------------------------------------- |
| Framework            | **Next.js 15.5.9** (App Router, Turbopack dev)                         |
| Language             | TypeScript 5.9.2                                                       |
| Styling              | Tailwind CSS 4.1, `tw-animate-css`, `class-variance-authority`, `clsx` |
| Component primitives | Radix UI (Dialog, DropdownMenu, Tabs, Popover, AlertDialog, …)         |
| Icons                | `lucide-react`, `@tabler/icons-react`, `react-icons`                   |
| Animation            | `motion` (Framer Motion successor)                                     |
| Forms                | Custom forms + Zod 4 schemas                                           |
| State                | React 19 hooks; small custom hooks (`useAuth`, `usePopUp`, `useAI`, …) |
| HTTP                 | `axios` 1.12                                                           |
| Theme                | `next-themes`                                                          |
| Toast                | `react-hot-toast`                                                      |
| Email (server route) | `nodemailer` 7                                                         |
| Auth UI              | `@clerk/nextjs` (legacy), custom AuthModal (primary)                   |
| Command UI           | `cmdk`                                                                 |

### Backend (`apps/http-server`)

| Concern         | Choice                                          |
| --------------- | ----------------------------------------------- |
| Runtime         | Node.js ≥ 18 (Dockerfile pins `node:24-alpine`) |
| Framework       | Express 5.1                                     |
| Language        | TypeScript 5 with `tsc-alias` path aliasing     |
| Auth            | `jsonwebtoken` 9, `bcrypt` 6 (12 rounds)        |
| Validation      | Zod 4 (shared via `@repo/types`)                |
| ORM             | Prisma 6.16 (Postgres)                          |
| Cache           | `redis` 5.8                                     |
| AI              | `@google/genai` 1.22 (Gemini)                   |
| Logging         | Winston 3                                       |
| Webhook signing | `svix` 1.77 (Clerk)                             |
| Dev runner      | `tsx` 4 + `tsc -b` build                        |

### Shared packages

- `@repo/db` — single Prisma client export consumed by every app.
- `@repo/types` — Zod schemas + inferred TS types (`createTemplateSchema`, `signUpSchema`, `authTokenSchemaType`, …) keeping FE/BE in lockstep.
- `@repo/ui` — common React components (`button`, `card`, `code`).
- `@repo/eslint-config`, `@repo/typescript-config` — shared lint and tsconfig presets.

### Tooling / Build

- **Monorepo:** Turborepo 2.5 + pnpm 10.17 workspaces.
- **Lint:** ESLint 9 (`next lint --max-warnings 0`).
- **Format:** Prettier 3.6.
- **Type-check:** `turbo run check-types` → `tsc --noEmit` per app.
- **Container:** `docker/Dockerfile.backend` (Alpine, Node 24).

---

## Monorepo Layout

```
NextMove/
├── apps/
│   ├── web/                          Next.js 15 frontend
│   │   ├── app/
│   │   │   ├── page.tsx              Marketing landing page
│   │   │   ├── layout.tsx            Root layout, ThemeProvider, Toaster
│   │   │   ├── ai-chat/              Premium AI chat rooms
│   │   │   ├── applied/              Application history
│   │   │   ├── generate/             Single-shot message generator
│   │   │   ├── templates/            Template library + AI generator
│   │   │   ├── api/
│   │   │   │   ├── auth/             (placeholder routes — kept for future)
│   │   │   │   └── internal/send-email/route.ts   Nodemailer endpoint
│   │   │   ├── not-found.tsx
│   │   │   └── globals.css           Tailwind 4 + custom CSS variables
│   │   ├── components/
│   │   │   ├── modals/               AuthModal, AlertModal, Gen_AI_Template, …
│   │   │   ├── ui/                   shadcn-style Radix wrappers
│   │   │   ├── NextMove_Navbar.tsx
│   │   │   ├── Roles_AutoComplete.tsx
│   │   │   ├── theme-provider.tsx
│   │   │   ├── ThemeAwareToaster.tsx
│   │   │   └── GetStartedButton.tsx
│   │   ├── hooks/                    useAuth, useAI, usePopUp, useTemplates, useDevice
│   │   ├── lib/                      auth.ts, auth-actions.ts, email.ts, toast.tsx, utils.ts
│   │   ├── ui-pages/                 Page-level container components
│   │   ├── utils/                    api_types.ts, url.ts, types.ts, strings.ts
│   │   ├── middleware.ts             Route guard
│   │   ├── next.config.js
│   │   └── postcss.config.mjs
│   │
│   └── http-server/                  Express 5 API
│       ├── src/
│       │   ├── index.ts              App bootstrap, CORS, route mounting
│       │   ├── config/               logger (Winston), redis client
│       │   ├── controllers/          auth, user, template, role, chat, generatedMessage, cache
│       │   ├── repository/           Prisma data-access per domain
│       │   ├── routes/               Express Routers (one per domain)
│       │   ├── services/             user.service.ts (Clerk-sync helpers)
│       │   ├── middleware/           authenticateUser, isAdmin, isPremium
│       │   └── utils/                ai-chat-Instruction, template-instruction, redisCommon, …
│       ├── logs/                     Winston rotating logs
│       └── tsconfig.json
│
├── packages/
│   ├── db/                           Prisma schema + generated client
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/           13 timestamped migrations
│   │   └── src/index.ts              Singleton PrismaClient export
│   ├── Types/                        Zod schemas + inferred types
│   ├── ui/                           Shared React components
│   ├── eslint-config/
│   └── typescript-config/
│
├── scripts/
│   └── seed-roles-templates.js       Generates role-specific templates via Gemini
├── docker/
│   └── Dockerfile.backend
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## Database Schema

PostgreSQL via Prisma 6. Source of truth: `packages/db/prisma/schema.prisma`.

### Models

| Model                | Purpose                                                                 | Key fields                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Users**            | Account, profile, premium flag, parent of every user-owned record.      | `id`, `email` (unique), `password?` (bcrypt), `firstName`, `lastName?`, `profilePic?`, `isPaid`, timestamps. Indexed on `(id, email)`.                          |
| **PasswordReset**    | Stateful OTP and reset-token flow.                                      | `userId`, `otp`, `resetToken?`, `expiresAt`, `used`. Cascading delete with `Users`. Indexed on `userId` and `otp`.                                              |
| **Templates**        | Reusable user templates (or AI-created).                                | `name`, `description?`, `type` (`MESSAGE` / `EMAIL`), `content`, `role` FK, `user` FK, `isDeleted`, `isCommon`, `createdBy` (`SELF` / `AI`), `TemplateRules[]`. |
| **TemplateRules**    | Free-form rules / placeholder hints attached to a template.             | `rule`, `templateId` FK.                                                                                                                                        |
| **AiTemplate**       | Iterative AI-generated drafts before the user saves to `Templates`.    | `message`, `rules[]`, `templateName`, `templateDescription?`, `history[]`, `prompt`, `roleName`, `roleNameId`, `userId`.                                        |
| **GeneratedMessages**| Every AI-generated outreach message, fully linked.                      | `recruiterName?`, `role` FK, `template` FK, `company` FK, `user` FK, `message`, `gender?`, `messageType` enum, timestamps.                                      |
| **Role**             | Job role taxonomy (e.g. "Frontend Developer").                          | `name`, `desc?`, plus relations to `Templates`, `Company`, `GeneratedMessages`.                                                                                 |
| **Company**          | Companies the user has reached out to.                                  | `name`, `createdBy` FK, `roles[]`.                                                                                                                              |
| **Resumes**          | Stored resume references per user.                                      | `name`, `link`, `userId` FK. Indexed on `userId`.                                                                                                               |
| **Room**             | Persistent AI chat conversation.                                        | `name`, `description`, `predefinedMessages[]`, `userId` FK.                                                                                                     |
| **Message**          | Individual chat turns.                                                  | `message`, `by` enum (`AI` / `SELF`), `userId`, `roomId`.                                                                                                       |

### Enums

- `MessageBy { AI, SELF }`
- `MessageType { EMAIL, MESSAGE }`
- `CreatedBy { AI, SELF }`

### Relationship summary

- A **User** owns many Resumes, Templates, AiTemplates, GeneratedMessages, Rooms, Messages, Companies, and PasswordResets.
- A **Template** belongs to a User and a Role, has many TemplateRules, and is referenced by many GeneratedMessages.
- A **GeneratedMessage** points at exactly one Template, Role, Company, and User — a fully traceable application record.

### Migration history (13 migrations)

Captures the project's evolution: initial schema → generated messages → soft-delete → AI templates → auth (Jan 2026).

---

## Authentication System

### Token model

- **JWT** signed with `JWT_SECRET`, 7-day expiry.
- Payload mirrors `authTokenSchemaType` (shared from `@repo/types`):
  ```
  { user_id, email, full_name, azp, iss, sub, image_url, phone_number }
  ```
- Authorization header: `Authorization: Bearer <token>`.
- Middleware (`authenticateUser`) verifies, attaches `req.user`, and returns `401` with explicit `TokenExpiredError` / `JsonWebTokenError` discrimination so the client can distinguish "session expired" from "tampered".

### Cookie model

| Cookie                | HttpOnly | Purpose                          | Expiry  |
| --------------------- | -------- | -------------------------------- | ------- |
| `nextmove_auth_token` | yes      | JWT, sent to backend             | 7 days  |
| `nextmove_user`       | no       | Hydrate UI without an extra fetch | 7 days  |

Cookies are flagged `secure` when `NODE_ENV === "production"` and use `sameSite: "lax"`.

### Validation rules (Zod)

| Field      | Rule                          |
| ---------- | ----------------------------- |
| firstName  | required, 1–50 chars          |
| lastName   | optional, ≤ 50 chars          |
| email      | required, valid email         |
| password   | required, 6–100 chars         |
| otp        | required, exactly 6 digits    |
| resetToken | required                      |

### Security posture

1. bcrypt with **12 rounds** (cost calibrated for ~250 ms/hash).
2. JWT secrets enforced at startup — `signup` throws if `JWT_SECRET` is missing.
3. OTP TTL 10 minutes; reset-token TTL 5 minutes.
4. `PasswordReset.used = true` after consumption (single-use).
5. `INTERNAL_API_SECRET` gate on the email API so only the backend can trigger SMTP.
6. CORS allowlist via `ORIGINS` env var, with credentials enabled.

---

## API Reference

> Base URL = `process.env.NEXT_PUBLIC_BASE_URL` (e.g. `http://localhost:3001`).
> All non-auth routes require `Authorization: Bearer <jwt>`.

### Auth — `/api/auth`

| Method | Path                | Auth   | Description                                                                       |
| ------ | ------------------- | ------ | --------------------------------------------------------------------------------- |
| POST   | `/signup`           | public | Create user. Returns `{ user, token }`.                                           |
| POST   | `/login`            | public | Email + password. Returns `{ user, token }`.                                      |
| POST   | `/forgot-password`  | public | Generate + email a 6-digit OTP.                                                   |
| POST   | `/verify-otp`       | public | Validate OTP, return short-lived `resetToken`.                                    |
| POST   | `/change-password`  | public | Consume `resetToken`, persist new bcrypt hash.                                    |

### Users — `/api/users`

| Method | Path                     | Auth         | Description                                  |
| ------ | ------------------------ | ------------ | -------------------------------------------- |
| POST   | `/create-user`           | JWT          | Idempotent local user provisioning.          |
| POST   | `/update-user-details`   | JWT          | Update profile.                              |
| GET    | `/is_premium`            | JWT          | Returns `isPaid` for current user.           |
| POST   | `/update-premium`        | JWT + admin  | Toggle premium status.                       |
| GET    | `/users`                 | JWT + admin  | List all users.                              |

### Templates — `/api/templates`

| Method | Path                      | Auth                | Description                                           |
| ------ | ------------------------- | ------------------- | ----------------------------------------------------- |
| GET    | `/get-templates`          | JWT                 | List user templates.                                  |
| POST   | `/add-template`           | JWT                 | Create.                                               |
| PUT    | `/update-template`        | JWT                 | Update.                                               |
| DELETE | `/delete-template`        | JWT                 | Soft-delete (`isDeleted = true`).                     |
| GET    | `/get-common-templates`   | JWT                 | List `isCommon = true` templates (cached).            |
| POST   | `/add-template-bulk`      | JWT + admin         | Used by the seed script.                              |
| POST   | `/ai-generate-template`   | JWT + premium       | Calls Gemini with `template-instruction.ts` prompt.   |

### Roles — `/api/roles`

| Method | Path           | Auth          | Description                |
| ------ | -------------- | ------------- | -------------------------- |
| GET    | `/get-roles`   | JWT           | List all roles.            |
| POST   | `/create-role` | JWT + admin   | Create role.               |
| DELETE | `/delete-role` | JWT + admin   | Delete role.               |

### Generate — `/api/generate`

| Method | Path                      | Auth | Description                                          |
| ------ | ------------------------- | ---- | ---------------------------------------------------- |
| POST   | `/generate-message`       | JWT  | Calls Gemini, persists `GeneratedMessages` row.      |
| GET    | `/get-generated-messages` | JWT  | List, cached at `generated-{userId}`.                |

### Chat — `/api/chat` (premium)

| Method | Path             | Auth             | Description                  |
| ------ | ---------------- | ---------------- | ---------------------------- |
| GET    | `/get-all-chats` | JWT + premium    | List user rooms.             |
| POST   | `/create-chat`   | JWT + premium    | Create room + first message. |

### Cache — `/api/cache`

| Method | Path               | Auth          | Description                    |
| ------ | ------------------ | ------------- | ------------------------------ |
| DELETE | `/clear-all-cache` | JWT + admin   | Flush all Redis keys (ops only). |

### Webhooks — `/api/webhooks`

| Method | Path     | Description                                                                 |
| ------ | -------- | --------------------------------------------------------------------------- |
| POST   | `/clerk` | Svix-verified Clerk webhook handling `user.created` / `updated` / `deleted`. |

### Internal (Next.js) — `/api/internal`

| Method | Path          | Auth                  | Description                       |
| ------ | ------------- | --------------------- | --------------------------------- |
| POST   | `/send-email` | `x-internal-secret`   | Sends OTP or generic email via SMTP. |

---

## Caching Strategy (Redis)

Wrappers in `utils/redisCommon.ts` (`getRedis`, `setRedis`, `clearRedis`) all swallow errors and log via Winston so a Redis outage degrades gracefully (cache miss → DB hit) instead of breaking the request.

| Key                          | Value                              | TTL      | Invalidation                            |
| ---------------------------- | ---------------------------------- | -------- | --------------------------------------- |
| `premium:{userId}`           | `{ isPaid }` JSON                  | 24 h     | TTL only.                               |
| `generated-{userId}`         | List of generated messages         | n/a      | Cleared on every new generation.        |
| `common-templates`           | Common templates payload           | n/a      | Admin via `/clear-all-cache`.           |

---

## AI Integration (Google Gemini)

Two carefully separated prompts:

1. **`ai-chat-Instruction.ts`** — outreach **message** generator.
   - Forces strict-JSON `{ new_message, name?, description? }`.
   - Distinguishes "Generate / Follow Up" intent.
   - Reformulates colloquial user input into recruiter-ready prose.
   - Auto-generates short, structured room names like `"Sarah Google Application"`.

2. **`template-instruction.ts`** — reusable **template** generator.
   - Forces strict-JSON `{ message, rules, templateName, templateDescription }`.
   - Hard length limits, role-aware tech-stack inlining, only `[Recruiter Name]` and `[MY NAME]` placeholders allowed.
   - History-aware iterative refinement.

Both prompts are designed for **deterministic JSON parsing** — no markdown fences — and the controllers fail fast with a `400` if the model returns malformed JSON.

---

## Frontend Architecture

### Page surface

| Path        | Layout                       | Notes                                                                |
| ----------- | ---------------------------- | -------------------------------------------------------------------- |
| `/`         | Public marketing             | Hero, stats, features, demo, "How it works", testimonials, CTAs.     |
| `/generate` | Authenticated                | Single-shot generator (paste job + role + recruiter → message).      |
| `/templates`| Authenticated                | Template library, filters, AI template modal.                        |
| `/ai-chat`  | Authenticated + premium      | Multi-turn AI conversation with persistent rooms.                    |
| `/applied`  | Authenticated                | Read view of `GeneratedMessages` joined to role/company/template.    |

### Hooks

- **`useAuth`** — `signIn`, `signUp`, `signOut`, `getToken`, plus a `useUser` companion (`isSignedIn`, `isLoaded`, `user`).
- **`usePopUp`** — URL-param-driven modal state (`?popup=login|signup|forgot-password`) with `redirect_url` support so deep-link flows survive auth.
- **`useAI`** — wraps Gemini-backed endpoints with loading/error state.
- **`useTemplates`** — fetch + mutate templates with optimistic cache busting.
- **`useDevice`** — viewport and pointer detection for the resizable navbar.

### UI primitives

`components/ui/` contains shadcn-style wrappers around Radix UI: `dialog`, `dropdown-menu`, `tabs`, `popover`, `alert-dialog`, `accordion`, `select`, `radio-group`, `checkbox`, `switch`, `progress`, `command`, `card`, `button`, `input`, `label`, `textarea`, `table`, `resizable-navbar`, plus a `shadcn-io/` namespace.

### Modals

- `AuthModal.tsx` — login / signup / forgot-password / OTP / change-password as a single mounted component driven by `?popup=…`.
- `Gen_AI_Template.tsx` — premium AI template generation with prompt history and iterative refinement.
- `TemplateOpeartion.tsx` — create/edit/delete template flows.
- `ShowMessage.tsx` — view a generated message with copy-to-clipboard.
- `EditName.tsx`, `AutoCompleteSearch.tsx`, `AlertModal.tsx`.

---

## Middleware & Authorization

Three layered middlewares in `apps/http-server/src/middleware/`:

1. **`authenticateUser`** — decodes JWT, attaches `req.user`. Differentiates between expired/invalid/server errors.
2. **`isAdmin`** — checks `user.email ∈ ADMIN_EMAILS`.
3. **`isPremium`** — read-through Redis (`premium:{userId}`, 24 h) before falling back to Postgres.

Route mounting in `index.ts` keeps the chains explicit, e.g. `router.post('/ai-generate-template', authenticateUser, isPremium, …)`.

CORS is allowlisted via `process.env.ORIGINS` and accepts only configured origins (with credentials).

---

## Environment Variables

### `apps/web/.env`

```env
# Frontend → Backend
NEXT_PUBLIC_BASE_URL=http://localhost:3001

# Internal email API
INTERNAL_API_SECRET=<generate via: openssl rand -hex 32>

# SMTP (Gmail App Password)
MAIL_USER=your-email@gmail.com
MAIL_PASS=your-app-password

# Clerk (legacy, optional)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/
```

### `apps/http-server/.env`

```env
# Server
PORT=3001
ORIGINS=http://localhost:3000,https://nextmove-yatin.vercel.app

# Postgres
DATABASE_URL=postgresql://user:pass@host:5432/nextmove

# JWT
JWT_SECRET=<generate via: openssl rand -hex 32>

# Internal email API (must match the value in apps/web)
NEXTJS_URL=http://localhost:3000
INTERNAL_API_SECRET=<same secret as apps/web>

# Redis
REDIS_URL=redis://localhost:6379

# Gemini
GEMINI_API_KEY=...

# Clerk (legacy webhook + SDK)
CLERK_SECRET_KEY=...
CLERK_WEBHOOK_SECRET=...

# Authorization
ADMIN_EMAILS=admin@example.com,owner@example.com
```

### `packages/db/.env`

```env
DATABASE_URL=postgresql://user:pass@host:5432/nextmove
```

---

## Local Development Setup

### Prerequisites

- Node.js ≥ 18 (Docker uses Node 24).
- pnpm ≥ 10.17.
- Postgres ≥ 14.
- Redis ≥ 6.
- Gmail account with an app password (for SMTP).
- Google AI Studio API key (Gemini).

### One-time

```bash
git clone <repo-url> NextMove
cd NextMove
pnpm install
```

### Database

```bash
cd packages/db
pnpm dlx prisma migrate dev   # apply 13 migrations
pnpm dlx prisma generate
cd ../..
```

### Run the apps

```bash
# from repo root — runs every workspace's `dev` task in parallel
pnpm dev
```

Or run each individually:

```bash
# Backend (port 3001)
cd apps/http-server
pnpm dev          # tsc build + node ./dist/index.js

   # Start frontend server
   cd apps/web
   pnpm dev
   ```

6. **Access the Application**
   - **Live Application**: [https://nextmove-yatin.vercel.app/](https://nextmove-yatin.vercel.app/)
   - **Local Development**:
     - Frontend: http://localhost:3000
     - Backend API: http://localhost:3001

## 📚 API Documentation

### Authentication Endpoints
- `POST /api/users/create-user` - Create new user
- `POST /api/users/update-user-details` - Update user profile

### Template Management
- `GET /api/templates` - Get user templates
- `POST /api/templates` - Create new template
- `PUT /api/templates/:id` - Update template
- `DELETE /api/templates/:id` - Delete template
- `POST /api/templates/ai-generate` - Generate template using AI

### Message Generation
- `POST /api/generated-messages` - Generate AI message
- `GET /api/generated-messages` - Get user's generated messages

### Role Management (Admin)
- `GET /api/roles` - Get all roles
- `POST /api/roles` - Create new role
- `DELETE /api/roles` - Delete role

## 🗄 Database Schema

### Core Models

**Users**
- User authentication and profile information
- Relationships with applications, templates, and generated messages

**Templates**
- Message templates for different scenarios
- Categorized by type (Email, Message)
- User-specific templates

**GeneratedMessages**
- AI-generated messages with context
- Links to templates, roles, and companies
- User tracking and history

**Role**
- Job roles and positions
- Used for message generation context

**Company**
- Company information for applications
- Integration with message generation

### Relationships
- Users can have multiple templates, messages, and applications
- Templates can be used to generate multiple messages
- Messages are linked to specific roles and companies
- Role-based access control for admin features

## 🎨 Frontend & UI Components

### Landing Page

The application features a modern, fully responsive landing page (`apps/web/app/page.tsx`) with:
- Hero section with compelling messaging and CTAs
- Product showcase with dark/light mode images
- Key metrics and statistics
- Features section
- How it works process
- Use cases for different job seekers
- Testimonials
- Call-to-action sections
- Footer with navigation

### Design System

The application uses a comprehensive design system built on Radix UI primitives:

- **Layout**: Responsive navigation with mobile support
- **Forms**: Accessible form components with validation
- **Modals**: Flexible modal system for various interactions
- **Tables**: Data display with sorting and filtering
- **Theme**: Dark/light mode with smooth transitions
- **Icons**: Lucide React icons throughout
- **Typography**: Custom fonts (Geist) with responsive sizing
- **Animations**: Smooth transitions and hover effects

### Responsive Design

The landing page is fully optimized for mobile devices with:
- Mobile-first approach
- Responsive text sizing (text-3xl on mobile → text-7xl on desktop)
- Flexible grid layouts
- Touch-friendly buttons and interactions
- Optimized images and assets

## 🔧 Development

### Code Style
- TypeScript for type safety
- ESLint for code quality
- Prettier for code formatting
- Conventional commits for version control

### Testing
- Unit tests for utilities and components
- Integration tests for API endpoints
- End-to-end tests for critical user flows

### Performance
- Next.js optimization features
- Image optimization
- Code splitting and lazy loading
- Redis caching for API responses

## 🤝 Contributing

1. Fork and create a feature branch (`git checkout -b feat/<area>`).
2. Follow the existing TypeScript/ESLint conventions.
3. Use shared Zod schemas in `packages/Types` for any new request bodies — never duplicate validation across FE/BE.
4. Add or update a Prisma migration for any schema change; do not edit existing migrations.
5. Run `pnpm lint && pnpm check-types && pnpm build` before opening a PR.
6. Open a PR with a description of intent and screenshots/curl examples for any user-facing change.

---

## License

MIT — see `LICENSE`.

---

**NextMoveApp** - Making job applications smarter, faster, and more effective. 🚀