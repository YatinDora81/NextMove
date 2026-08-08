/**
 * `@repo/rotation` — the JF-001 SEC 5.4 "algorithm of record" for rotating a pool of
 * user-supplied (BYOK) Gemini API keys.
 *
 * Two hosts run this exact code:
 *   - the browser extension service worker, whose ledgers live in `chrome.storage.local`
 *   - `apps/http-server`, whose ledgers live in Redis (hot counters) + Postgres (durable status)
 *
 * To make that possible this module is:
 *   - **pure** — no I/O, no storage, no clock. The caller always passes `now` (epoch ms).
 *   - **immutable** — every "mutator" (`markLeased`, `applyOutcome`, `refreshStatus`) returns a
 *     brand-new `KeyState`; the argument is never touched.
 *   - **dependency-free** — zero runtime deps, and a single file with no relative imports so that
 *     both a NodeNext `tsc` build and a Vite/WXT bundler can consume the TypeScript source directly.
 *
 * The only platform API used is `Intl.DateTimeFormat` with the `America/Los_Angeles` time zone,
 * which is how the Pacific-midnight quota reset is derived (never a hardcoded UTC offset).
 */

/* ------------------------------------------------------------------------- *
 * Types
 * ------------------------------------------------------------------------- */

/**
 * ACTIVE    → serves requests
 * COOLDOWN  → timed rest after an HTTP 429 (60s → 5m → 30m by strike count)
 * EXHAUSTED → daily (RPD) budget spent; recovers by itself at Pacific midnight
 * DEAD      → invalid/revoked key; never auto-recovers, the user must fix or replace it
 */
export type KeyStatus = 'ACTIVE' | 'COOLDOWN' | 'EXHAUSTED' | 'DEAD';

/** e.g. `'gemini-2.5-flash-lite'`. Free-form: budgets are config-driven, not an enum. */
export type ModelId = string;

/** Soft ceilings for one model: requests per minute and requests per day. */
export interface ModelBudget {
  rpm: number;
  rpd: number;
}

export type ModelBudgets = Record<ModelId, ModelBudget>;

/** Per-model daily ledger state for a single key. `resetAt` is the next Pacific midnight. */
export interface KeyLedger {
  used: number;
  resetAt: number;
}

/**
 * Everything the rotation math knows about one key. It deliberately contains **no secret**:
 * the ciphertext (extension) or the sealed vault row (server) is held by the host, keyed by `id`.
 */
export interface KeyState {
  id: string;
  status: KeyStatus;
  strikes: number;
  /** epoch ms; 0 = not cooling. */
  cooldownUntil: number;
  /** epoch ms; 0 = never used. Drives the LRU ordering. */
  lastUsedAt: number;
  /** Request timestamps (epoch ms) per model, pruned to a 60s sliding window. */
  rpm: Record<ModelId, number[]>;
  daily: Record<ModelId, KeyLedger>;
}

/** The classified result of one Gemini call (see SEC 2.3 for the HTTP → outcome mapping). */
export type Outcome =
  | { kind: 'ok' }
  | { kind: 'http_429' }
  | { kind: 'quota_daily' }
  | { kind: 'key_invalid' }
  | { kind: 'net_or_5xx' };

/** UI-friendly per-key summary. `retryAt` is `null` when the key is usable now or is DEAD. */
export interface PoolSnapshot {
  keyId: string;
  status: KeyStatus;
  retryAt: number | null;
}

/* ------------------------------------------------------------------------- *
 * Constants
 * ------------------------------------------------------------------------- */

/** Width of the RPM sliding window. Google's free tier meters per rolling minute. */
export const RPM_WINDOW_MS = 60_000;

/** 429 backoff ladder by strike count: 60s → 5m → 30m, then capped at 30m. */
export const BACKOFF_LADDER_MS: readonly number[] = [60_000, 300_000, 1_800_000];

/** A single user request may burn at most this many keys before it gives up (SEC 5.4). */
export const MAX_KEYS_PER_REQUEST = 3;

/**
 * Shipped default free-tier budgets (SEC 5.2).
 *
 * These numbers are **approximate**. Google revises free-tier limits without notice, so they are
 * treated as soft ceilings, never asserted as fact in UI copy, and are **overridable from remote
 * config** (`modelBudgets` in the adapters config, SEC 5.6 / SEC 15.6). Always pass the resolved
 * budgets into these functions rather than assuming the defaults below.
 */
export const DEFAULT_MODEL_BUDGETS: ModelBudgets = {
  'gemini-2.5-flash-lite': { rpm: 15, rpd: 1000 },
  'gemini-2.5-flash': { rpm: 10, rpd: 250 },
  'gemini-2.0-flash': { rpm: 15, rpd: 200 },
};

/** Degrade the model before failing the user: 2.5-flash-lite → 2.5-flash → 2.0-flash. */
export const MODEL_FALLBACK_CHAIN: readonly ModelId[] = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

/**
 * Fallback for a model that has no entry in either the caller's budgets or the shipped defaults.
 * Intentionally the most conservative row of the shipped table — an unknown model must not be
 * treated as unmetered. Also approximate; see `DEFAULT_MODEL_BUDGETS`.
 */
const UNKNOWN_MODEL_BUDGET: ModelBudget = { rpm: 10, rpd: 200 };

/** Google resets free-tier daily quotas at midnight Pacific time. */
const PACIFIC_TIME_ZONE = 'America/Los_Angeles';

const MS_PER_DAY = 86_400_000;

/** Largest epoch ms a `Date` can represent — guards `toISOString()` in error messages. */
const MAX_TIME_VALUE = 8.64e15;

/* ------------------------------------------------------------------------- *
 * Errors
 * ------------------------------------------------------------------------- */

/**
 * Thrown by `selectKey` when no key in the pool can serve the requested model right now.
 * `retryAt` is the earliest epoch ms at which some key recovers, or `Infinity` when nothing
 * will recover without user action (empty pool / every key DEAD).
 */
export class AllKeysBusyError extends Error {
  readonly retryAt: number;

  constructor(retryAt: number) {
    super(
      Number.isFinite(retryAt)
        ? `All Gemini API keys are busy until ${formatEpoch(retryAt)}.`
        : 'All Gemini API keys are unavailable — no key can recover without user action.',
    );
    this.name = 'AllKeysBusyError';
    this.retryAt = retryAt;
    // Keeps `instanceof` correct if a bundler downlevels class extends (extension build).
    Object.setPrototypeOf(this, AllKeysBusyError.prototype);
  }
}

function formatEpoch(epochMs: number): string {
  if (!Number.isFinite(epochMs) || Math.abs(epochMs) > MAX_TIME_VALUE) return String(epochMs);
  return new Date(epochMs).toISOString();
}

/* ------------------------------------------------------------------------- *
 * Pacific-midnight math (Intl-driven; PST/PDT derived, never hardcoded)
 * ------------------------------------------------------------------------- */

interface PacificParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

let pacificFormatter: Intl.DateTimeFormat | null = null;

function getPacificFormatter(): Intl.DateTimeFormat {
  if (pacificFormatter === null) {
    pacificFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: PACIFIC_TIME_ZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
  return pacificFormatter;
}

/** Wall-clock calendar/time fields in America/Los_Angeles for an instant. */
function pacificParts(epochMs: number): PacificParts {
  const parts = getPacificFormatter().formatToParts(new Date(epochMs));
  let year = 1970;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;

  for (const part of parts) {
    switch (part.type) {
      case 'year':
        year = Number(part.value);
        break;
      case 'month':
        month = Number(part.value);
        break;
      case 'day':
        day = Number(part.value);
        break;
      case 'hour':
        hour = Number(part.value);
        break;
      case 'minute':
        minute = Number(part.value);
        break;
      case 'second':
        second = Number(part.value);
        break;
      default:
        break;
    }
  }

  // Some ICU builds render midnight as hour 24 on the same calendar day.
  if (hour === 24) hour = 0;

  return { year, month, day, hour, minute, second };
}

/**
 * The America/Los_Angeles UTC offset in ms at an instant (-8h in PST, -7h in PDT), obtained by
 * comparing the zone's wall clock against UTC. This is what keeps the reset correct across DST.
 */
function pacificOffsetMs(epochMs: number): number {
  const wholeSecond = Math.floor(epochMs / 1000) * 1000;
  const parts = pacificParts(wholeSecond);
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asIfUtc - wholeSecond;
}

/**
 * Epoch ms of 00:00:00 Pacific on a given civil date. Midnight is never skipped or repeated in
 * America/Los_Angeles (US transitions happen at 02:00 local), so the fixed point is unique.
 */
function pacificMidnightOf(year: number, month: number, day: number): number {
  const asIfUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  let epochMs = asIfUtc - pacificOffsetMs(asIfUtc);
  for (let i = 0; i < 3; i += 1) {
    const refined = asIfUtc - pacificOffsetMs(epochMs);
    if (refined === epochMs) break;
    epochMs = refined;
  }
  return epochMs;
}

/** Civil-date arithmetic in UTC space — no time zone involved, so DST cannot distort it. */
function addCivilDays(year: number, month: number, day: number, delta: number): PacificParts {
  const shifted = new Date(Date.UTC(year, month - 1, day) + delta * MS_PER_DAY);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
}

/**
 * The next 00:00 America/Los_Angeles **strictly after** `now`, as epoch ms — i.e. the instant
 * Google rolls the free-tier daily quota. Correct in both PST (UTC-8) and PDT (UTC-7), and across
 * the 23-hour spring-forward and 25-hour fall-back days.
 */
export function pacificMidnightAfter(now: number): number {
  if (!Number.isFinite(now)) {
    throw new RangeError('pacificMidnightAfter: `now` must be a finite epoch-ms timestamp');
  }

  const today = pacificParts(now);
  let year = today.year;
  let month = today.month;
  let day = today.day;
  let midnight = pacificMidnightOf(year, month, day);

  // Normally exactly one step (today's midnight is in the past). The guard keeps this total.
  for (let i = 0; midnight <= now && i < 5; i += 1) {
    const next = addCivilDays(year, month, day, 1);
    year = next.year;
    month = next.month;
    day = next.day;
    midnight = pacificMidnightOf(year, month, day);
  }

  return midnight;
}

/* ------------------------------------------------------------------------- *
 * Internal helpers
 * ------------------------------------------------------------------------- */

function resolveBudget(budgets: ModelBudgets, model: ModelId): ModelBudget {
  const configured = budgets[model];
  if (configured !== undefined) return configured;
  const shipped = DEFAULT_MODEL_BUDGETS[model];
  if (shipped !== undefined) return shipped;
  return UNKNOWN_MODEL_BUDGET;
}

function cloneKeyState(state: KeyState): KeyState {
  const rpm: Record<ModelId, number[]> = {};
  for (const model of Object.keys(state.rpm)) {
    const stamps = state.rpm[model];
    rpm[model] = stamps === undefined ? [] : stamps.slice();
  }

  const daily: Record<ModelId, KeyLedger> = {};
  for (const model of Object.keys(state.daily)) {
    const ledger = state.daily[model];
    if (ledger !== undefined) daily[model] = { used: ledger.used, resetAt: ledger.resetAt };
  }

  return {
    id: state.id,
    status: state.status,
    strikes: state.strikes,
    cooldownUntil: state.cooldownUntil,
    lastUsedAt: state.lastUsedAt,
    rpm,
    daily,
  };
}

/**
 * When the window is full, the instant at which a slot frees up: the timestamp that has to age out
 * plus the window width. For a window of exactly `rpm` entries that is the oldest entry; the
 * generalised index also copes with an over-full window after a remote-config budget cut.
 */
function rpmSlotFreeAt(stamps: readonly number[], rpm: number, now: number): number {
  if (stamps.length < rpm) return now;
  const sorted = stamps.slice().sort((a, b) => a - b);
  const stamp = sorted[stamps.length - rpm];
  if (stamp === undefined) return now;
  return stamp + RPM_WINDOW_MS;
}

/* ------------------------------------------------------------------------- *
 * Constructors
 * ------------------------------------------------------------------------- */

/** A fresh daily ledger: nothing spent, rolling at the next Pacific midnight. */
export function newLedger(now: number): KeyLedger {
  return { used: 0, resetAt: pacificMidnightAfter(now) };
}

/**
 * A blank ACTIVE state for a newly added key. Ledgers for the default fallback chain are seeded so
 * that quota UI has something to render immediately; any other model is created lazily on first use.
 */
export function newKeyState(id: string, now: number): KeyState {
  const rpm: Record<ModelId, number[]> = {};
  const daily: Record<ModelId, KeyLedger> = {};
  const resetAt = pacificMidnightAfter(now);

  for (const model of MODEL_FALLBACK_CHAIN) {
    rpm[model] = [];
    daily[model] = { used: 0, resetAt };
  }

  return {
    id,
    status: 'ACTIVE',
    strikes: 0,
    cooldownUntil: 0,
    lastUsedAt: 0,
    rpm,
    daily,
  };
}

/* ------------------------------------------------------------------------- *
 * Ledger maintenance
 * ------------------------------------------------------------------------- */

/** 60s → 5m → 30m. `strikes` is 1-based on the first 429; anything above the ladder stays capped. */
export function backoffMs(strikes: number): number {
  const first = BACKOFF_LADDER_MS[0] ?? 60_000;
  const last = BACKOFF_LADDER_MS[BACKOFF_LADDER_MS.length - 1] ?? first;
  if (!Number.isFinite(strikes) || strikes <= 1) return first;
  const index = Math.min(Math.floor(strikes) - 1, BACKOFF_LADDER_MS.length - 1);
  return BACKOFF_LADDER_MS[index] ?? last;
}

/** Timestamps still inside the 60s window, oldest first. Returns a new array; never mutates. */
export function pruneRpm(state: KeyState, model: ModelId, now: number): number[] {
  const stamps = state.rpm[model];
  if (stamps === undefined || stamps.length === 0) return [];
  const cutoff = now - RPM_WINDOW_MS;
  return stamps.filter((stamp) => stamp > cutoff);
}

/**
 * Lazily roll the daily ledger over the Pacific-midnight boundary — the reason no cron/alarm is
 * required on either host: the boundary is evaluated on read. Always returns a fresh object.
 */
export function rollDaily(state: KeyState, model: ModelId, now: number): KeyLedger {
  const ledger = state.daily[model];
  if (ledger === undefined || now >= ledger.resetAt) return newLedger(now);
  return { used: ledger.used, resetAt: ledger.resetAt };
}

/**
 * Lazy recovery, for storage and UI: a COOLDOWN key whose `cooldownUntil` has passed becomes
 * ACTIVE, an EXHAUSTED key whose daily ledger has rolled becomes ACTIVE with the rolled ledger.
 * DEAD never auto-recovers. Also prunes the model's RPM window so stored state stays bounded.
 * Returns a new state; the argument is untouched.
 */
export function refreshStatus(state: KeyState, model: ModelId, now: number): KeyState {
  const next = cloneKeyState(state);
  const previous = state.daily[model];
  const rolled = previous === undefined || now >= previous.resetAt;

  next.rpm[model] = pruneRpm(state, model, now);
  next.daily[model] = rollDaily(state, model, now);

  if (next.status === 'COOLDOWN' && next.cooldownUntil <= now) {
    next.status = 'ACTIVE';
    next.cooldownUntil = 0;
  }
  if (next.status === 'EXHAUSTED' && rolled) {
    next.status = 'ACTIVE';
  }

  return next;
}

/* ------------------------------------------------------------------------- *
 * Availability
 * ------------------------------------------------------------------------- */

/**
 * The SEC 5.4 usability filter, verbatim: not DEAD, not cooling, RPM window below the per-minute
 * ceiling, daily ledger below the per-day ceiling. Statuses recover lazily — a COOLDOWN key whose
 * timer has elapsed and an EXHAUSTED key whose ledger has rolled both pass here without needing
 * `refreshStatus` to have run first.
 */
export function isUsable(state: KeyState, model: ModelId, budgets: ModelBudgets, now: number): boolean {
  if (state.status === 'DEAD') return false;
  if (state.cooldownUntil > now) return false;

  const budget = resolveBudget(budgets, model);
  if (budget.rpm <= 0 || budget.rpd <= 0) return false;
  if (pruneRpm(state, model, now).length >= budget.rpm) return false;
  if (rollDaily(state, model, now).used >= budget.rpd) return false;

  return true;
}

/**
 * The epoch ms at which this key could next serve `model`: the latest of its cooldown expiry, the
 * moment an RPM slot frees up, and the daily reset when the RPD ledger is spent. `Infinity` for a
 * DEAD key (or a model configured with a zero budget) — nothing recovers it on a timer.
 * Never earlier than `now`.
 */
export function keyAvailableAt(
  state: KeyState,
  model: ModelId,
  budgets: ModelBudgets,
  now: number,
): number {
  if (state.status === 'DEAD') return Infinity;

  const budget = resolveBudget(budgets, model);
  if (budget.rpm <= 0 || budget.rpd <= 0) return Infinity;

  let at = now;
  if (state.cooldownUntil > at) at = state.cooldownUntil;

  const stamps = pruneRpm(state, model, now);
  if (stamps.length >= budget.rpm) {
    const slotFreeAt = rpmSlotFreeAt(stamps, budget.rpm, now);
    if (slotFreeAt > at) at = slotFreeAt;
  }

  const ledger = rollDaily(state, model, now);
  if (ledger.used >= budget.rpd && ledger.resetAt > at) at = ledger.resetAt;

  return at;
}

/** Earliest `keyAvailableAt` across the pool. `Infinity` for an empty or fully DEAD pool. */
export function nextAvailability(
  states: readonly KeyState[],
  model: ModelId,
  budgets: ModelBudgets,
  now: number,
): number {
  let earliest = Infinity;
  for (const state of states) {
    const at = keyAvailableAt(state, model, budgets, now);
    if (at < earliest) earliest = at;
  }
  return earliest;
}

/* ------------------------------------------------------------------------- *
 * Leasing
 * ------------------------------------------------------------------------- */

/**
 * Least-recently-used round-robin over healthy keys — even wear across N keys, so pool throughput
 * ≈ N × the single-key free limits. Ties (e.g. never-used keys) break on pool order, which keeps
 * selection deterministic. Returns the *same object* from `states`, so the caller can identify it.
 *
 * @throws {AllKeysBusyError} carrying `nextAvailability(...)` when nothing is usable.
 */
export function selectKey(
  states: readonly KeyState[],
  model: ModelId,
  budgets: ModelBudgets,
  now: number,
): KeyState {
  let best: KeyState | null = null;

  for (const state of states) {
    if (!isUsable(state, model, budgets, now)) continue;
    if (best === null || state.lastUsedAt < best.lastUsedAt) best = state;
  }

  if (best === null) {
    throw new AllKeysBusyError(nextAvailability(states, model, budgets, now));
  }

  return best;
}

/**
 * Optimistic accounting applied the moment a key is handed out: stamp `lastUsedAt`, push the
 * request into the RPM window, and spend one unit of the daily ledger. `applyOutcome` refunds the
 * daily unit if the call turns out to have failed for reasons that are not the key's fault.
 * Returns a new state.
 */
export function markLeased(state: KeyState, model: ModelId, now: number): KeyState {
  const next = cloneKeyState(state);
  const ledger = rollDaily(state, model, now);

  next.rpm[model] = [...pruneRpm(state, model, now), now];
  next.daily[model] = { used: ledger.used + 1, resetAt: ledger.resetAt };
  next.lastUsedAt = now;

  return next;
}

/**
 * The SEC 5.4 result state machine.
 *
 *  - `ok`          → strikes cleared, key back to ACTIVE
 *  - `http_429`    → strike +1, COOLDOWN for `backoffMs(strikes)` (60s → 5m → 30m)
 *  - `quota_daily` → daily ledger pinned to the model ceiling, EXHAUSTED until Pacific midnight
 *  - `key_invalid` → DEAD; only the user can revive it
 *  - `net_or_5xx`  → refund the optimistic daily unit and change nothing else; a Google outage or a
 *                    dropped socket is not the key's fault. The RPM entry stays: the request really
 *                    was sent, and Google metered it.
 *
 * Returns a new state.
 */
export function applyOutcome(
  state: KeyState,
  model: ModelId,
  outcome: Outcome,
  now: number,
  budgets: ModelBudgets,
): KeyState {
  const next = cloneKeyState(state);

  switch (outcome.kind) {
    case 'ok': {
      next.strikes = 0;
      next.status = 'ACTIVE';
      next.cooldownUntil = 0;
      break;
    }
    case 'http_429': {
      const strikes = state.strikes + 1;
      next.strikes = strikes;
      next.cooldownUntil = now + backoffMs(strikes);
      next.status = 'COOLDOWN';
      break;
    }
    case 'quota_daily': {
      const budget = resolveBudget(budgets, model);
      const ledger = rollDaily(state, model, now);
      next.daily[model] = { used: budget.rpd, resetAt: ledger.resetAt };
      next.status = 'EXHAUSTED';
      break;
    }
    case 'key_invalid': {
      next.status = 'DEAD';
      break;
    }
    case 'net_or_5xx': {
      const ledger = rollDaily(state, model, now);
      next.daily[model] = { used: Math.max(0, ledger.used - 1), resetAt: ledger.resetAt };
      break;
    }
    default: {
      // Exhaustive: an unknown outcome must not silently corrupt the ledger.
      const never: never = outcome;
      throw new TypeError(`applyOutcome: unknown outcome ${JSON.stringify(never)}`);
    }
  }

  return next;
}

/* ------------------------------------------------------------------------- *
 * Pool-level helpers
 * ------------------------------------------------------------------------- */

/**
 * Walk the fallback chain and return the first model with at least one usable key, so a pool that
 * has burned its 2.5-tier daily budget degrades the model instead of failing the user.
 * `null` when the whole pool is spent for every model in the chain.
 */
export function selectModel(
  states: readonly KeyState[],
  budgets: ModelBudgets,
  now: number,
  chain: readonly ModelId[] = MODEL_FALLBACK_CHAIN,
): ModelId | null {
  for (const model of chain) {
    for (const state of states) {
      if (isUsable(state, model, budgets, now)) return model;
    }
  }
  return null;
}

/**
 * A UI-ready snapshot of the pool for one model: the lazily-recovered status plus, for keys that
 * cannot serve right now, when they will be able to. `retryAt` is `null` when the key is usable
 * now and when it is DEAD (nothing to count down to — and `Infinity` does not survive JSON).
 */
export function poolHealth(
  states: readonly KeyState[],
  model: ModelId,
  budgets: ModelBudgets,
  now: number,
): PoolSnapshot[] {
  return states.map((state) => {
    const refreshed = refreshStatus(state, model, now);
    if (isUsable(refreshed, model, budgets, now)) {
      return { keyId: refreshed.id, status: refreshed.status, retryAt: null };
    }
    const at = keyAvailableAt(refreshed, model, budgets, now);
    return {
      keyId: refreshed.id,
      status: refreshed.status,
      retryAt: Number.isFinite(at) ? at : null,
    };
  });
}
