# NextMove Autofill (`apps/extension`)

Internal codename **JobFill / JF-001 Rev 3.0**. Store listing name: **NextMove Autofill**.

A Manifest V3 Chrome extension that fills job applications on any ATS in one click. It lives in
the NextMove monorepo but is a **separate runtime**: it must remain fully functional with the
NextMove backend switched off, deleted, or unreachable.

Built with **WXT + Vite + React 19 + Tailwind v4 + Zustand**, `chrome.storage.local` for small
records, **Dexie 4 / IndexedDB** for blobs and tracker rows, **WebCrypto** (AES-256-GCM + PBKDF2)
for at-rest encryption, **Zod** at every trust boundary, and **Gemini REST** called directly from
the service worker with the user's own free-tier API keys.

---

## The invariants

These are enforced in code, not just documented. If you are about to write something that
violates one, you are writing the wrong thing.

| ID | Invariant | What it means in this codebase |
|----|-----------|--------------------------------|
| **INV-1** | **Never auto-submit.** | No code path may call `.click()` or `.submit()` on a submit or "next step" control. Adapters *locate* and *highlight* them; the user presses the button. |
| **INV-2** | **AI is on-demand only.** | Every `AI_*` / `RESUME_PARSE` bus message must carry a fresh user-gesture nonce (5 s TTL, `GESTURE_TTL_MS`). The gated set is `GESTURE_REQUIRED` in `src/shared/messages.ts`. There is no background, scheduled, or speculative Gemini traffic — ever. |
| **INV-3** | **Local-first.** | v1 works fully logged-out and offline. Only `src/sync/**` may require the network. |
| **INV-4** | **Never guess-fill.** | score ≥ 70 → fill · 50–69 → suggest · < 50 → skip + flag (`FILL_THRESHOLD` / `SUGGEST_THRESHOLD`). |
| **INV-5** | **Keys are radioactive.** | A user's Gemini key is AES-GCM-encrypted at rest, decrypted only inside the service worker at call time, sent only to `generativelanguage.googleapis.com`. Never logged, never synced, never sent to the NextMove API, always masked in UI. |
| **INV-6** | **Extension AI never routes through the NextMove backend.** | `src/ai/**` may not import `API_BASE_URL`. The server's own `GEMINI_API_KEY` serves web features only. |

Three key lanes exist in this product and they never mix. This extension touches **lane 1 only**:
user keys, encrypted on-device, service worker → Google direct.

---

## Boundary rules (SEC 14.1)

| Rule | Statement |
|------|-----------|
| **R-1** | AI isolation. No extension route may reach `@google/genai` or the server's managed key. |
| **R-2** | Zero-account v1. Pairing unlocks Phase-2 sync and gates nothing else. |
| **R-3** | Import direction. The extension may import **only** `@repo/types`, `@repo/rotation`, `@repo/typescript-config`, `@repo/eslint-config`. **Never** `@repo/ui` (bundle size, store review), **never** `@repo/db` (Prisma is server-only), **never** `apps/web` or `apps/http-server` source. |
| **R-4** | Release isolation. The zip versions and ships on the Chrome Web Store's cadence; Vercel and API deploys never wait on it, and vice versa. |

R-3 and INV-6 are enforced by `no-restricted-imports` in `eslint.config.js` — CI fails on
violation, so the rule cannot rot into a comment.

---

## Commands

Run from the repo root:

```bash
pnpm turbo run dev  --filter=extension     # HMR against a scratch Chrome profile
pnpm turbo run build --filter=extension    # unpacked build in apps/extension/build/
pnpm turbo run zip  --filter=extension     # store-ready artifact in build/*.zip
pnpm turbo run check-types lint test       # whole monorepo — extension included, same gates
```

Or from `apps/extension/`: `pnpm dev` · `pnpm build` · `pnpm zip` · `pnpm check-types` ·
`pnpm test` · `pnpm lint`.

`postinstall` runs `wxt prepare`, which generates `.wxt/tsconfig.json` and the auto-import type
declarations that this package's `tsconfig.json` extends. If your editor cannot resolve
`defineBackground` or the `@/` alias, run `pnpm wxt prepare`.

To load a dev build: `chrome://extensions` → Developer mode → **Load unpacked** →
`apps/extension/build/chrome-mv3-dev`.

---

## Layout

```
apps/extension/
├─ wxt.config.ts          entrypoints + manifest generation (SEC 10)
├─ src/
│  ├─ entrypoints/        background.ts · content.ts · main-world.ts · popup/ · options/
│  ├─ core/               scanner · signature · matcher · synonyms · fill/strategies/ · observer · adapters/
│  ├─ ai/                 gemini-client · rotation · vault · prompts/     ← INV-6 applies here
│  ├─ platform/           bus · storage · db (Dexie) · crypto
│  ├─ tracker/            service · detectors
│  ├─ answers/            answer bank (F-17)
│  ├─ sync/               Phase-2 client — the only network-dependent module (INV-3)
│  ├─ ui/                 popup/options React surface — standalone, never @repo/ui (R-3)
│  └─ shared/             types.ts · messages.ts · constants.ts · schema.ts
├─ config/                adapters.seed.json — shipped defaults; the CDN JSON overrides it
├─ fixtures/              saved, sanitized ATS HTML — the ground truth for every matcher test
└─ tests/                 unit/ (vitest + happy-dom) · e2e/ (playwright)
```

### `src/shared/` is the spine

Everything else is built on these four files. Change them only with the design doc open.

- **`types.ts`** — SEC 6.2 core contracts (`FieldSignature`, `FieldNode`, `ProfilePath`,
  `MatchResult`, `FillReport`), the SEC 7.2 `Profile` vault shape, and every stored record
  (`GeminiKeyRecord`, `ApplicationRow`, `AnswerRecord`, `ResumeRecord`, `Settings`, `SyncState`,
  `RemoteConfig`). `FieldNode.el` is deliberately `unknown` so storage contracts stay DOM-free.
- **`messages.ts`** — the SEC 6.6 bus protocol. `MessageContracts` is a payload/reply map, so a
  handler returning the wrong shape is a compile error. `GESTURE_REQUIRED` is the closed
  INV-2 set: `AI_GENERATE_ANSWER`, `AI_GENERATE_COVER`, `AI_DISAMBIGUATE`, `RESUME_PARSE`.
- **`constants.ts`** — storage keys, `SCHEMA_VERSION`, matcher thresholds, answer-similarity
  cutoffs, fill/typeahead jitter, the Gemini timeout, `CONFIG_URL`, `API_BASE_URL`.
- **`schema.ts`** — Zod mirrors, pinned to the TypeScript interfaces by compile-time drift guards.
  `profileSchema` is the contract `resume_extract.v1` must satisfy.

---

## Storage map (SEC 7.1)

| Store | Key / table | Contents |
|-------|-------------|----------|
| `chrome.storage.local` | `jf.meta` | `{schemaVersion, installId, createdAt}` — drives migrations |
| | `jf.profiles` | `Profile[]`, encrypted |
| | `jf.settings` | UX prefs, thresholds, model prefs, feature flags |
| | `jf.keys` | `GeminiKeyRecord[]` — ciphertext + rotation ledgers |
| | `jf.mappings` | `{ [domain]: { [sigHash]: ProfilePath } }` |
| | `jf.sync` | Phase-2 pairing state; the device JWT is stored encrypted |
| IndexedDB (`jobfill`) | `resumes` · `applications` · `parseCache` · `answerBank` | blobs, tracker rows, parse cache, answer memory |

Never synced, in any phase: **API keys** and the **Answer Bank**.

---

## Manifest notes (SEC 10)

`minimum_chrome_version` 116. Permissions: `storage`, `scripting`, `alarms`, `contextMenus` —
no `activeTab`, because the content scripts are declarative. Host permissions are exactly two
origins: Google's generative-language API (lane 1) and the NextMove origin that serves
`adapters.json` from Vercel's CDN. **No `web_accessible_resources`** — nothing here is reachable
from a page. Two content scripts are generated from the entrypoints: the ISOLATED-world worker
and a MAIN-world helper that exists *solely* for native-setter fills (SEC 6.4) and exposes
nothing else. Phase-2 sync adds **zero** new permissions; the API allowlists
`chrome-extension://<id>` in its existing CORS `ORIGINS` instead.

The extension carries **no env secrets**. BYOK means there is nothing to leak.

---

## Testing (SEC 11)

Unit and component tests run on Vitest + happy-dom against saved, sanitized ATS HTML in
`fixtures/<ats>/<variant>.html` — real forms, so no real applications get submitted while
debugging. Playwright drives the e2e layer against an unpacked build with Gemini stubbed via
request interception, and asserts INV-1 (no submit click ever fired).
