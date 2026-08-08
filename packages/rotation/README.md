# `@repo/rotation`

Pure, dependency-free TypeScript implementing the **JF-001 SEC 5.4 key-rotation algorithm of
record** — least-recently-used round-robin over a pool of user-supplied (BYOK) Gemini API keys,
with a sliding per-minute ledger, a daily ledger that resets at Pacific midnight, exponential 429
backoff, and dead-key quarantine.

One algorithm, two hosts, zero drift:

| Host | Where the state lives |
| --- | --- |
| `apps/extension` (service worker) | `chrome.storage.local` → `jf.keys[].state` |
| `apps/http-server` (web BYOK vault, SEC 15.6) | Redis for the hot RPM/RPD counters, Postgres (`UserGeminiKey`) for durable status/strikes/cooldown |

The package holds **no secrets**: a `KeyState` is pure accounting, keyed by `id`. Ciphertext lives
with the host (`chrome.storage` for lane 1, the sealed vault row for lane 2).

## Design rules

- **Pure.** No I/O, no storage, no `Date.now()`. The caller always passes `now` (epoch ms), which is
  what makes the whole thing trivially testable and identical on both hosts.
- **Immutable.** `markLeased`, `applyOutcome` and `refreshStatus` return a **new** `KeyState`; the
  argument is never mutated (the test suite proves it against deep-frozen inputs).
- **Zero runtime dependencies, single file, no relative imports.** `src/index.ts` is consumed both
  by `tsc` with `moduleResolution: NodeNext` (which wants `.js` suffixes) and by Vite/WXT (which
  wants none), so it deliberately has nothing to import.
- The only platform API used is `Intl.DateTimeFormat` with `timeZone: 'America/Los_Angeles'`; the
  PST/PDT offset is **derived**, never hardcoded.

## Usage

```ts
import {
  AllKeysBusyError, DEFAULT_MODEL_BUDGETS, applyOutcome, markLeased, refreshStatus, selectKey,
  type KeyState, type ModelBudgets, type Outcome,
} from '@repo/rotation';

const budgets: ModelBudgets = remoteConfig.modelBudgets ?? DEFAULT_MODEL_BUDGETS;
const now = Date.now();                       // the host owns the clock

let pool: KeyState[] = await loadPool();
let leased: KeyState;
try {
  leased = selectKey(pool, model, budgets, now);
} catch (error) {
  if (error instanceof AllKeysBusyError) {
    // error.retryAt is epoch ms (Infinity when nothing recovers without user action)
    return showCountdown(error.retryAt);
  }
  throw error;
}

// Optimistic accounting happens BEFORE the call goes out.
pool = pool.map((k) => (k.id === leased.id ? markLeased(k, model, now) : k));
await savePool(pool);

const outcome: Outcome = await callGemini(leased.id);   // classify per SEC 2.3
const after = Date.now();
pool = pool.map((k) => (k.id === leased.id ? applyOutcome(k, model, outcome, after, budgets) : k));
await savePool(pool);
```

Call `refreshStatus(state, model, now)` when rendering key status or before persisting, so lapsed
cooldowns and rolled daily ledgers are normalised. `poolHealth(...)` gives a JSON-safe snapshot for
UI (`retryAt` is `null` — never `Infinity` — so it survives `JSON.stringify` across the message bus).

## API

| Export | Purpose |
| --- | --- |
| `selectKey(states, model, budgets, now)` | LRU over usable keys. Throws `AllKeysBusyError(nextAvailability(...))`. |
| `markLeased(state, model, now)` | Optimistic lease: stamp `lastUsedAt`, push the RPM timestamp, `+1` daily. |
| `applyOutcome(state, model, outcome, now, budgets)` | The result state machine (below). |
| `refreshStatus(state, model, now)` | Lazy recovery + RPM housekeeping. |
| `isUsable` / `keyAvailableAt` / `nextAvailability` | The usability filter and its "when instead?" counterparts. |
| `selectModel(states, budgets, now, chain?)` | First model in the fallback chain with a usable key, else `null`. |
| `poolHealth(states, model, budgets, now)` | `{ keyId, status, retryAt }[]` for UI. |
| `pruneRpm` / `rollDaily` / `newLedger` / `newKeyState` / `backoffMs` / `pacificMidnightAfter` | Ledger primitives. |
| `RPM_WINDOW_MS`, `BACKOFF_LADDER_MS`, `MAX_KEYS_PER_REQUEST`, `MODEL_FALLBACK_CHAIN`, `DEFAULT_MODEL_BUDGETS` | Tuning constants. |

## State machine

```
ACTIVE     → serve requests
ACTIVE     → COOLDOWN    on http_429       (60s → 5m → 30m by strike count, then capped)
ACTIVE     → EXHAUSTED   on quota_daily    (daily ledger pinned to the model ceiling)
ACTIVE     → DEAD        on key_invalid    (400 API_KEY_INVALID / 403 — user must fix or replace)
COOLDOWN   → ACTIVE      when cooldownUntil <= now
EXHAUSTED  → ACTIVE      at the next Pacific midnight (lazy: evaluated on read, no cron/alarm)
DEAD       → ACTIVE      only via an explicit successful re-test (outcome `ok`)
```

`net_or_5xx` is deliberately **not** a transition: a Google outage or a dropped socket is not the
key's fault, so the optimistic daily increment is refunded (floored at 0) and `status`/`strikes` are
left untouched. The RPM timestamp stays — the request really was sent and Google metered it.

`status` is a single field per key, not per model. That is intentional: the model-fallback path
(`selectModel`) relies on the per-model *ledgers*, so a key marked `EXHAUSTED` for
`gemini-2.5-flash-lite` still serves `gemini-2.5-flash` while its own ledger has room.

## Daily reset

Google resets free-tier daily quotas at **midnight America/Los_Angeles**. `pacificMidnightAfter(now)`
returns the next such instant as epoch ms, reading wall-clock parts through `Intl.DateTimeFormat` and
solving for the UTC offset — so it is correct in PST (UTC-8) and PDT (UTC-7), and across the 23-hour
spring-forward and 25-hour fall-back days. The boundary is evaluated lazily on read (`rollDaily`),
which is why neither host needs a cron job or a `chrome.alarms` timer to stay correct.

## Model budgets

`DEFAULT_MODEL_BUDGETS` reproduces the SEC 5.2 table:

| Model | ~RPM | ~RPD |
| --- | --- | --- |
| `gemini-2.5-flash-lite` | 15 | 1000 |
| `gemini-2.5-flash` | 10 | 250 |
| `gemini-2.0-flash` | 15 | 200 |

These numbers are **approximate**. Google revises free-tier limits without notice, so they are
treated as soft ceilings, are **overridable from remote config** (`modelBudgets` in
`adapters.json`), and must never be presented in UI copy as guaranteed. Always pass the resolved
budgets into these functions. A model with no entry in the caller's budgets falls back to the
shipped defaults, and a completely unknown model falls back to a conservative 10 RPM / 200 RPD
rather than being treated as unmetered.

## Tests

```sh
pnpm --filter @repo/rotation test          # vitest
pnpm --filter @repo/rotation check-types   # tsc --noEmit
```

The suite covers LRU fairness across three keys, the RPM pre-check that prevents a self-inflicted
429, the 429 backoff ladder, `quota_daily` pinning plus midnight recovery, the `net_or_5xx` ledger
refund, DEAD keys never being selected, `AllKeysBusyError.retryAt`, model fallback when a tier is
spent, mutator purity against deep-frozen inputs, and `pacificMidnightAfter` on PST dates, PDT dates
and both DST transition days.
