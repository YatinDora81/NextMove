import { describe, expect, it } from 'vitest';

import {
  AllKeysBusyError,
  BACKOFF_LADDER_MS,
  DEFAULT_MODEL_BUDGETS,
  MAX_KEYS_PER_REQUEST,
  MODEL_FALLBACK_CHAIN,
  RPM_WINDOW_MS,
  applyOutcome,
  backoffMs,
  isUsable,
  keyAvailableAt,
  markLeased,
  newKeyState,
  newLedger,
  nextAvailability,
  pacificMidnightAfter,
  poolHealth,
  pruneRpm,
  refreshStatus,
  rollDaily,
  selectKey,
  selectModel,
  type KeyState,
  type ModelBudgets,
} from './index.js';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const MODEL = 'gemini-2.5-flash-lite';
const FLASH = 'gemini-2.5-flash';
const LEGACY = 'gemini-2.0-flash';

/** 2026-01-15T12:00:00Z — 04:00 in Los Angeles, deep in PST. */
const T0 = Date.UTC(2026, 0, 15, 12, 0, 0);
/** The Pacific midnight that follows T0: 2026-01-16 00:00 PST = 08:00Z. */
const MIDNIGHT_1 = Date.UTC(2026, 0, 16, 8, 0, 0);
/** And the one after that. */
const MIDNIGHT_2 = Date.UTC(2026, 0, 17, 8, 0, 0);

const HOUR = 3_600_000;

function budgets(rpm: number, rpd: number, model: string = MODEL): ModelBudgets {
  return { [model]: { rpm, rpd } };
}

function byId(states: readonly KeyState[], id: string): KeyState {
  const found = states.find((state) => state.id === id);
  if (found === undefined) throw new Error(`test fixture is missing key "${id}"`);
  return found;
}

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

function deepFreeze(state: KeyState): KeyState {
  for (const stamps of Object.values(state.rpm)) Object.freeze(stamps);
  for (const ledger of Object.values(state.daily)) Object.freeze(ledger);
  Object.freeze(state.rpm);
  Object.freeze(state.daily);
  return Object.freeze(state);
}

const laClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function laWallClock(epochMs: number): string {
  return laClock.format(new Date(epochMs));
}

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

describe('constants', () => {
  it('pins the SEC 5.4 tuning values', () => {
    expect(RPM_WINDOW_MS).toBe(60_000);
    expect(BACKOFF_LADDER_MS).toEqual([60_000, 300_000, 1_800_000]);
    expect(MAX_KEYS_PER_REQUEST).toBe(3);
    expect(MODEL_FALLBACK_CHAIN).toEqual([MODEL, FLASH, LEGACY]);
  });

  it('ships the SEC 5.2 approximate free-tier budgets', () => {
    expect(DEFAULT_MODEL_BUDGETS).toEqual({
      'gemini-2.5-flash-lite': { rpm: 15, rpd: 1000 },
      'gemini-2.5-flash': { rpm: 10, rpd: 250 },
      'gemini-2.0-flash': { rpm: 15, rpd: 200 },
    });
  });
});

/* ------------------------------------------------------------------ *
 * backoffMs
 * ------------------------------------------------------------------ */

describe('backoffMs', () => {
  it('climbs 60s → 5m → 30m and then caps', () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(300_000);
    expect(backoffMs(3)).toBe(1_800_000);
    expect(backoffMs(4)).toBe(1_800_000);
    expect(backoffMs(97)).toBe(1_800_000);
  });

  it('treats non-positive and non-finite strike counts as the first rung', () => {
    expect(backoffMs(0)).toBe(60_000);
    expect(backoffMs(-5)).toBe(60_000);
    expect(backoffMs(Number.NaN)).toBe(60_000);
    expect(backoffMs(Number.POSITIVE_INFINITY)).toBe(60_000);
  });

  it('floors fractional strike counts onto a rung', () => {
    expect(backoffMs(2.9)).toBe(300_000);
  });
});

/* ------------------------------------------------------------------ *
 * pacificMidnightAfter
 * ------------------------------------------------------------------ */

describe('pacificMidnightAfter', () => {
  it('resolves the next midnight during PST (UTC-8)', () => {
    expect(pacificMidnightAfter(T0)).toBe(MIDNIGHT_1);
    expect(laWallClock(pacificMidnightAfter(T0))).toBe('01/16/2026, 00:00:00');
  });

  it('resolves the next midnight during PDT (UTC-7)', () => {
    const summerNoonUtc = Date.UTC(2026, 6, 15, 12, 0, 0);
    expect(pacificMidnightAfter(summerNoonUtc)).toBe(Date.UTC(2026, 6, 16, 7, 0, 0));
    expect(laWallClock(pacificMidnightAfter(summerNoonUtc))).toBe('07/16/2026, 00:00:00');
  });

  it('is strictly after `now`, even exactly on a midnight boundary', () => {
    expect(pacificMidnightAfter(MIDNIGHT_1)).toBe(MIDNIGHT_2);
    expect(pacificMidnightAfter(MIDNIGHT_1 - 1)).toBe(MIDNIGHT_1);
  });

  it('handles the 23-hour spring-forward day (2026-03-08, PST → PDT)', () => {
    const beforeTransition = Date.UTC(2026, 2, 7, 20, 0, 0); // 12:00 PST on Mar 7
    const springMidnight = pacificMidnightAfter(beforeTransition);
    expect(springMidnight).toBe(Date.UTC(2026, 2, 8, 8, 0, 0)); // 00:00 PST
    expect(laWallClock(springMidnight)).toBe('03/08/2026, 00:00:00');

    const nextMidnight = pacificMidnightAfter(springMidnight);
    expect(nextMidnight).toBe(Date.UTC(2026, 2, 9, 7, 0, 0)); // 00:00 PDT
    expect(laWallClock(nextMidnight)).toBe('03/09/2026, 00:00:00');
    expect((nextMidnight - springMidnight) / HOUR).toBe(23);
  });

  it('handles the 25-hour fall-back day (2026-11-01, PDT → PST)', () => {
    const beforeTransition = Date.UTC(2026, 9, 31, 20, 0, 0); // 13:00 PDT on Oct 31
    const fallMidnight = pacificMidnightAfter(beforeTransition);
    expect(fallMidnight).toBe(Date.UTC(2026, 10, 1, 7, 0, 0)); // 00:00 PDT
    expect(laWallClock(fallMidnight)).toBe('11/01/2026, 00:00:00');

    const nextMidnight = pacificMidnightAfter(fallMidnight);
    expect(nextMidnight).toBe(Date.UTC(2026, 10, 2, 8, 0, 0)); // 00:00 PST
    expect(laWallClock(nextMidnight)).toBe('11/02/2026, 00:00:00');
    expect((nextMidnight - fallMidnight) / HOUR).toBe(25);
  });

  it('always lands on a real Pacific midnight, 0–25h ahead, across a full year', () => {
    const start = Date.UTC(2026, 0, 1, 3, 17, 42);
    for (let day = 0; day < 365; day += 1) {
      const now = start + day * 86_400_000;
      const midnight = pacificMidnightAfter(now);
      expect(midnight).toBeGreaterThan(now);
      expect(midnight - now).toBeLessThanOrEqual(25 * HOUR);
      expect(laWallClock(midnight).endsWith(', 00:00:00')).toBe(true);
    }
  });

  it('rejects a non-finite clock reading instead of looping', () => {
    expect(() => pacificMidnightAfter(Number.NaN)).toThrow(RangeError);
  });
});

/* ------------------------------------------------------------------ *
 * Constructors + ledger maintenance
 * ------------------------------------------------------------------ */

describe('newKeyState / newLedger', () => {
  it('creates a blank ACTIVE key with seeded chain ledgers', () => {
    const key = newKeyState('k1', T0);
    expect(key.id).toBe('k1');
    expect(key.status).toBe('ACTIVE');
    expect(key.strikes).toBe(0);
    expect(key.cooldownUntil).toBe(0);
    expect(key.lastUsedAt).toBe(0);

    for (const model of MODEL_FALLBACK_CHAIN) {
      expect(key.rpm[model]).toEqual([]);
      expect(key.daily[model]).toEqual({ used: 0, resetAt: MIDNIGHT_1 });
    }
  });

  it('creates a ledger that rolls at the next Pacific midnight', () => {
    expect(newLedger(T0)).toEqual({ used: 0, resetAt: MIDNIGHT_1 });
  });
});

describe('pruneRpm', () => {
  it('drops timestamps that have aged out of the 60s window without mutating', () => {
    const base = newKeyState('p', T0);
    const state: KeyState = {
      ...base,
      rpm: { [MODEL]: [T0 - 90_000, T0 - 60_000, T0 - 59_999, T0] },
    };

    expect(pruneRpm(state, MODEL, T0)).toEqual([T0 - 59_999, T0]);
    expect(state.rpm[MODEL]).toHaveLength(4);
  });

  it('returns an empty window for a model that has never been used', () => {
    expect(pruneRpm(newKeyState('p', T0), 'never-seen', T0)).toEqual([]);
  });
});

describe('rollDaily', () => {
  it('keeps the ledger before the boundary and rolls it after', () => {
    const leased = markLeased(newKeyState('r', T0), MODEL, T0);

    expect(rollDaily(leased, MODEL, MIDNIGHT_1 - 1)).toEqual({ used: 1, resetAt: MIDNIGHT_1 });
    expect(rollDaily(leased, MODEL, MIDNIGHT_1)).toEqual({ used: 0, resetAt: MIDNIGHT_2 });
  });

  it('materialises a ledger for a model that has none yet', () => {
    expect(rollDaily(newKeyState('r', T0), 'brand-new-model', T0)).toEqual({
      used: 0,
      resetAt: MIDNIGHT_1,
    });
  });

  it('never hands back the stored ledger object', () => {
    const leased = markLeased(newKeyState('r', T0), MODEL, T0);
    expect(rollDaily(leased, MODEL, T0)).not.toBe(leased.daily[MODEL]);
  });
});

/* ------------------------------------------------------------------ *
 * LRU selection
 * ------------------------------------------------------------------ */

describe('selectKey — LRU fairness', () => {
  it('round-robins evenly across three keys', () => {
    const budget = budgets(15, 1000);
    let keys = ['a', 'b', 'c'].map((id) => newKeyState(id, T0));
    const picked: string[] = [];

    for (let i = 0; i < 6; i += 1) {
      const now = T0 + i * 1_000;
      const leased = selectKey(keys, MODEL, budget, now);
      picked.push(leased.id);
      keys = keys.map((key) => (key.id === leased.id ? markLeased(key, MODEL, now) : key));
    }

    expect(picked).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
    for (const key of keys) {
      expect(key.daily[MODEL]?.used).toBe(2);
    }
  });

  it('always prefers the least-recently-used key regardless of pool order', () => {
    const budget = budgets(15, 1000);
    const stale: KeyState = { ...newKeyState('stale', T0), lastUsedAt: T0 - 10 * HOUR };
    const fresh: KeyState = { ...newKeyState('fresh', T0), lastUsedAt: T0 - 1_000 };
    const middle: KeyState = { ...newKeyState('middle', T0), lastUsedAt: T0 - HOUR };

    expect(selectKey([fresh, middle, stale], MODEL, budget, T0).id).toBe('stale');
    expect(selectKey([stale, middle, fresh], MODEL, budget, T0).id).toBe('stale');
  });

  it('multiplies pool throughput by the number of keys, then reports a sane retryAt', () => {
    const budget = budgets(2, 1000); // 2 rpm per key × 3 keys = 6 requests per minute
    let keys = ['a', 'b', 'c'].map((id) => newKeyState(id, T0));

    for (let i = 0; i < 6; i += 1) {
      const now = T0 + i * 1_000;
      const leased = selectKey(keys, MODEL, budget, now);
      keys = keys.map((key) => (key.id === leased.id ? markLeased(key, MODEL, now) : key));
    }

    const error = captureError(() => selectKey(keys, MODEL, budget, T0 + 6_000));
    expect(error).toBeInstanceOf(AllKeysBusyError);
    expect(error).toBeInstanceOf(Error);
    expect((error as AllKeysBusyError).retryAt).toBe(T0 + RPM_WINDOW_MS);
    expect((error as AllKeysBusyError).name).toBe('AllKeysBusyError');
    expect((error as AllKeysBusyError).message).toContain('2026-01-15T12:01:00');

    // Once the oldest slot ages out, the pool serves again.
    expect(selectKey(keys, MODEL, budget, T0 + RPM_WINDOW_MS).id).toBe('a');
  });

  it('bounds one user request to MAX_KEYS_PER_REQUEST keys', () => {
    const budget = budgets(15, 1000);
    let keys = ['a', 'b', 'c', 'd'].map((id) => newKeyState(id, T0));
    const tried: string[] = [];

    for (let attempt = 0; attempt < MAX_KEYS_PER_REQUEST; attempt += 1) {
      const now = T0 + attempt;
      const leased = selectKey(keys, MODEL, budget, now);
      tried.push(leased.id);
      keys = keys.map((key) =>
        key.id === leased.id
          ? applyOutcome(markLeased(key, MODEL, now), MODEL, { kind: 'http_429' }, now, budget)
          : key,
      );
    }

    expect(tried).toEqual(['a', 'b', 'c']);
    expect(keys.filter((key) => key.status === 'COOLDOWN')).toHaveLength(3);
    expect(isUsable(byId(keys, 'd'), MODEL, budget, T0 + 3)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * RPM pre-check
 * ------------------------------------------------------------------ */

describe('RPM sliding window', () => {
  it('stops the pool before it can inflict a 429 on itself', () => {
    const budget = budgets(2, 1000);
    let key = newKeyState('k', T0);

    key = markLeased(key, MODEL, T0);
    expect(isUsable(key, MODEL, budget, T0 + 1)).toBe(true);

    key = markLeased(key, MODEL, T0 + 1_000);
    expect(key.rpm[MODEL]).toEqual([T0, T0 + 1_000]);
    expect(isUsable(key, MODEL, budget, T0 + 2_000)).toBe(false);

    const error = captureError(() => selectKey([key], MODEL, budget, T0 + 2_000));
    expect(error).toBeInstanceOf(AllKeysBusyError);
    expect((error as AllKeysBusyError).retryAt).toBe(T0 + RPM_WINDOW_MS);
    expect(keyAvailableAt(key, MODEL, budget, T0 + 2_000)).toBe(T0 + RPM_WINDOW_MS);
  });

  it('frees a slot exactly one window after the oldest request', () => {
    const budget = budgets(2, 1000);
    let key = newKeyState('k', T0);
    key = markLeased(key, MODEL, T0);
    key = markLeased(key, MODEL, T0 + 1_000);

    expect(isUsable(key, MODEL, budget, T0 + RPM_WINDOW_MS - 1)).toBe(false);
    expect(isUsable(key, MODEL, budget, T0 + RPM_WINDOW_MS)).toBe(true);
  });

  it('reports availability as `now` for a key that is free right now', () => {
    const budget = budgets(15, 1000);
    expect(keyAvailableAt(newKeyState('k', T0), MODEL, budget, T0)).toBe(T0);
  });
});

/* ------------------------------------------------------------------ *
 * markLeased
 * ------------------------------------------------------------------ */

describe('markLeased', () => {
  it('optimistically stamps the lease and never touches the input', () => {
    const before = deepFreeze(newKeyState('k', T0));
    const after = markLeased(before, MODEL, T0);

    expect(after).not.toBe(before);
    expect(after.lastUsedAt).toBe(T0);
    expect(after.rpm[MODEL]).toEqual([T0]);
    expect(after.daily[MODEL]).toEqual({ used: 1, resetAt: MIDNIGHT_1 });

    expect(before.lastUsedAt).toBe(0);
    expect(before.rpm[MODEL]).toEqual([]);
    expect(before.daily[MODEL]).toEqual({ used: 0, resetAt: MIDNIGHT_1 });
  });

  it('rolls a stale ledger as it leases across the midnight boundary', () => {
    const leased = markLeased(newKeyState('k', T0), MODEL, T0);
    const nextDay = markLeased(leased, MODEL, MIDNIGHT_1 + 1_000);

    expect(nextDay.daily[MODEL]).toEqual({ used: 1, resetAt: MIDNIGHT_2 });
    expect(nextDay.rpm[MODEL]).toEqual([MIDNIGHT_1 + 1_000]);
  });
});

/* ------------------------------------------------------------------ *
 * applyOutcome — the SEC 5.4 state machine
 * ------------------------------------------------------------------ */

describe('applyOutcome — http_429', () => {
  it('walks the backoff ladder and caps at 30 minutes', () => {
    const budget = budgets(15, 1000);
    let key = newKeyState('k', T0);

    key = applyOutcome(key, MODEL, { kind: 'http_429' }, T0, budget);
    expect(key.strikes).toBe(1);
    expect(key.status).toBe('COOLDOWN');
    expect(key.cooldownUntil).toBe(T0 + 60_000);

    key = applyOutcome(key, MODEL, { kind: 'http_429' }, T0 + 60_000, budget);
    expect(key.strikes).toBe(2);
    expect(key.cooldownUntil).toBe(T0 + 60_000 + 300_000);

    key = applyOutcome(key, MODEL, { kind: 'http_429' }, T0 + HOUR, budget);
    expect(key.strikes).toBe(3);
    expect(key.cooldownUntil).toBe(T0 + HOUR + 1_800_000);

    key = applyOutcome(key, MODEL, { kind: 'http_429' }, T0 + 2 * HOUR, budget);
    expect(key.strikes).toBe(4);
    expect(key.cooldownUntil).toBe(T0 + 2 * HOUR + 1_800_000);
  });

  it('excludes a cooling key from selection until its timer elapses', () => {
    const budget = budgets(15, 1000);
    const cooling = applyOutcome(newKeyState('k', T0), MODEL, { kind: 'http_429' }, T0, budget);

    expect(isUsable(cooling, MODEL, budget, T0 + 59_999)).toBe(false);
    expect(isUsable(cooling, MODEL, budget, T0 + 60_000)).toBe(true);
    expect(keyAvailableAt(cooling, MODEL, budget, T0)).toBe(T0 + 60_000);
  });

  it('clears strikes and cooldown on the next success', () => {
    const budget = budgets(15, 1000);
    const cooling = applyOutcome(newKeyState('k', T0), MODEL, { kind: 'http_429' }, T0, budget);
    const recovered = applyOutcome(cooling, MODEL, { kind: 'ok' }, T0 + 60_000, budget);

    expect(recovered.status).toBe('ACTIVE');
    expect(recovered.strikes).toBe(0);
    expect(recovered.cooldownUntil).toBe(0);
  });
});

describe('applyOutcome — quota_daily', () => {
  it('pins the ledger to the model ceiling and recovers at Pacific midnight', () => {
    const budget = budgets(15, 3);
    let key = markLeased(newKeyState('k', T0), MODEL, T0);
    expect(key.daily[MODEL]?.used).toBe(1);

    key = applyOutcome(key, MODEL, { kind: 'quota_daily' }, T0, budget);
    expect(key.status).toBe('EXHAUSTED');
    expect(key.daily[MODEL]).toEqual({ used: 3, resetAt: MIDNIGHT_1 });

    expect(isUsable(key, MODEL, budget, T0 + 6 * HOUR)).toBe(false);
    expect(keyAvailableAt(key, MODEL, budget, T0)).toBe(MIDNIGHT_1);
    expect(isUsable(key, MODEL, budget, MIDNIGHT_1 - 1)).toBe(false);
    expect(isUsable(key, MODEL, budget, MIDNIGHT_1)).toBe(true);

    const recovered = refreshStatus(key, MODEL, MIDNIGHT_1);
    expect(recovered.status).toBe('ACTIVE');
    expect(recovered.daily[MODEL]).toEqual({ used: 0, resetAt: MIDNIGHT_2 });
  });

  it('reaches EXHAUSTED from the ledger alone, without a Google quota error', () => {
    const budget = budgets(15, 2);
    let key = newKeyState('k', T0);
    key = markLeased(key, MODEL, T0);
    key = markLeased(key, MODEL, T0 + 1_000);

    expect(isUsable(key, MODEL, budget, T0 + 2_000)).toBe(false);
    expect(keyAvailableAt(key, MODEL, budget, T0 + 2_000)).toBe(MIDNIGHT_1);
  });
});

describe('applyOutcome — key_invalid', () => {
  it('quarantines the key forever and never selects it again', () => {
    const budget = budgets(15, 1000);
    const dead = applyOutcome(newKeyState('dead', T0), MODEL, { kind: 'key_invalid' }, T0, budget);
    const healthy = newKeyState('healthy', T0);

    expect(dead.status).toBe('DEAD');
    expect(isUsable(dead, MODEL, budget, T0)).toBe(false);
    expect(keyAvailableAt(dead, MODEL, budget, T0)).toBe(Number.POSITIVE_INFINITY);
    expect(refreshStatus(dead, MODEL, T0 + 400 * 24 * HOUR).status).toBe('DEAD');

    // Even though both keys have lastUsedAt === 0, LRU must skip the dead one.
    expect(selectKey([dead, healthy], MODEL, budget, T0).id).toBe('healthy');

    const error = captureError(() => selectKey([dead], MODEL, budget, T0));
    expect(error).toBeInstanceOf(AllKeysBusyError);
    expect((error as AllKeysBusyError).retryAt).toBe(Number.POSITIVE_INFINITY);
    expect((error as AllKeysBusyError).message).toContain('no key can recover');
  });

  it('is revivable only by an explicit successful re-test', () => {
    const budget = budgets(15, 1000);
    const dead = applyOutcome(newKeyState('k', T0), MODEL, { kind: 'key_invalid' }, T0, budget);
    const revived = applyOutcome(dead, MODEL, { kind: 'ok' }, T0 + HOUR, budget);

    expect(revived.status).toBe('ACTIVE');
    expect(isUsable(revived, MODEL, budget, T0 + HOUR)).toBe(true);
  });
});

describe('applyOutcome — net_or_5xx', () => {
  it('refunds the optimistic daily increment and leaves the key alone', () => {
    const budget = budgets(15, 1000);
    const leased = markLeased(newKeyState('k', T0), MODEL, T0);
    const refunded = applyOutcome(leased, MODEL, { kind: 'net_or_5xx' }, T0 + 500, budget);

    expect(refunded.daily[MODEL]).toEqual({ used: 0, resetAt: MIDNIGHT_1 });
    expect(refunded.status).toBe('ACTIVE');
    expect(refunded.strikes).toBe(0);
    // The request really was sent, so it still counts against the per-minute window.
    expect(refunded.rpm[MODEL]).toEqual([T0]);
  });

  it('floors the ledger at zero', () => {
    const budget = budgets(15, 1000);
    const leased = markLeased(newKeyState('k', T0), MODEL, T0);
    const once = applyOutcome(leased, MODEL, { kind: 'net_or_5xx' }, T0 + 500, budget);
    const twice = applyOutcome(once, MODEL, { kind: 'net_or_5xx' }, T0 + 600, budget);

    expect(twice.daily[MODEL]?.used).toBe(0);
  });

  it('does not disturb an existing cooldown or strike count', () => {
    const budget = budgets(15, 1000);
    const cooling = applyOutcome(newKeyState('k', T0), MODEL, { kind: 'http_429' }, T0, budget);
    const after = applyOutcome(cooling, MODEL, { kind: 'net_or_5xx' }, T0 + 1, budget);

    expect(after.status).toBe('COOLDOWN');
    expect(after.strikes).toBe(1);
    expect(after.cooldownUntil).toBe(cooling.cooldownUntil);
  });
});

/* ------------------------------------------------------------------ *
 * refreshStatus
 * ------------------------------------------------------------------ */

describe('refreshStatus', () => {
  it('promotes a lapsed COOLDOWN back to ACTIVE and keeps the strike history', () => {
    const budget = budgets(15, 1000);
    let key = applyOutcome(newKeyState('k', T0), MODEL, { kind: 'http_429' }, T0, budget);
    key = applyOutcome(key, MODEL, { kind: 'http_429' }, T0 + 60_000, budget);

    expect(refreshStatus(key, MODEL, T0 + 60_000).status).toBe('COOLDOWN');

    const recovered = refreshStatus(key, MODEL, T0 + 60_000 + 300_000);
    expect(recovered.status).toBe('ACTIVE');
    expect(recovered.cooldownUntil).toBe(0);
    expect(recovered.strikes).toBe(2);
  });

  it('prunes the stale RPM window as housekeeping', () => {
    const leased = markLeased(newKeyState('k', T0), MODEL, T0);
    expect(refreshStatus(leased, MODEL, T0 + 30_000).rpm[MODEL]).toEqual([T0]);
    expect(refreshStatus(leased, MODEL, T0 + RPM_WINDOW_MS).rpm[MODEL]).toEqual([]);
  });

  it('never resurrects a DEAD key', () => {
    const budget = budgets(15, 1000);
    const dead = applyOutcome(newKeyState('k', T0), MODEL, { kind: 'key_invalid' }, T0, budget);
    expect(refreshStatus(dead, MODEL, MIDNIGHT_2).status).toBe('DEAD');
  });
});

/* ------------------------------------------------------------------ *
 * Purity
 * ------------------------------------------------------------------ */

describe('purity', () => {
  it('never mutates the state handed to a mutator', () => {
    const budget = budgets(15, 1000);
    const original = deepFreeze(markLeased(newKeyState('k', T0), MODEL, T0));
    const snapshot = JSON.stringify(original);

    markLeased(original, MODEL, T0 + 1_000);
    applyOutcome(original, MODEL, { kind: 'ok' }, T0 + 1_000, budget);
    applyOutcome(original, MODEL, { kind: 'http_429' }, T0 + 1_000, budget);
    applyOutcome(original, MODEL, { kind: 'quota_daily' }, T0 + 1_000, budget);
    applyOutcome(original, MODEL, { kind: 'key_invalid' }, T0 + 1_000, budget);
    applyOutcome(original, MODEL, { kind: 'net_or_5xx' }, T0 + 1_000, budget);
    refreshStatus(original, MODEL, MIDNIGHT_2);
    pruneRpm(original, MODEL, MIDNIGHT_2);
    rollDaily(original, MODEL, MIDNIGHT_2);
    selectKey([original], MODEL, budget, T0 + 1_000);
    poolHealth([original], MODEL, budget, T0 + 1_000);

    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('deep-copies nested ledgers and windows', () => {
    const budget = budgets(15, 1000);
    const original = markLeased(newKeyState('k', T0), MODEL, T0);
    const next = applyOutcome(original, MODEL, { kind: 'ok' }, T0 + 1, budget);

    expect(next.rpm).not.toBe(original.rpm);
    expect(next.daily).not.toBe(original.daily);
    expect(next.rpm[MODEL]).not.toBe(original.rpm[MODEL]);
    expect(next.daily[MODEL]).not.toBe(original.daily[MODEL]);
  });
});

/* ------------------------------------------------------------------ *
 * nextAvailability
 * ------------------------------------------------------------------ */

describe('nextAvailability', () => {
  it('reports the earliest recovery across a mixed pool', () => {
    const budget = budgets(15, 5);
    const cooling = applyOutcome(newKeyState('cool', T0), MODEL, { kind: 'http_429' }, T0, budget);
    const spent = applyOutcome(newKeyState('spent', T0), MODEL, { kind: 'quota_daily' }, T0, budget);
    const dead = applyOutcome(newKeyState('dead', T0), MODEL, { kind: 'key_invalid' }, T0, budget);

    expect(nextAvailability([spent, dead, cooling], MODEL, budget, T0 + 1_000)).toBe(T0 + 60_000);
    expect(nextAvailability([spent, dead], MODEL, budget, T0 + 1_000)).toBe(MIDNIGHT_1);
    expect(nextAvailability([dead], MODEL, budget, T0)).toBe(Number.POSITIVE_INFINITY);
    expect(nextAvailability([], MODEL, budget, T0)).toBe(Number.POSITIVE_INFINITY);
  });
});

/* ------------------------------------------------------------------ *
 * Budgets resolution
 * ------------------------------------------------------------------ */

describe('budget resolution', () => {
  it('falls back to the shipped defaults when the caller supplies none', () => {
    const base = newKeyState('k', T0);
    const nearCeiling: KeyState = {
      ...base,
      daily: { ...base.daily, [FLASH]: { used: 249, resetAt: MIDNIGHT_1 } },
    };
    const atCeiling: KeyState = {
      ...base,
      daily: { ...base.daily, [FLASH]: { used: 250, resetAt: MIDNIGHT_1 } },
    };

    expect(isUsable(nearCeiling, FLASH, {}, T0)).toBe(true);
    expect(isUsable(atCeiling, FLASH, {}, T0)).toBe(false);
  });

  it('treats a completely unknown model conservatively rather than as unmetered', () => {
    const base = newKeyState('k', T0);
    const state: KeyState = {
      ...base,
      daily: { ...base.daily, 'made-up-model': { used: 200, resetAt: MIDNIGHT_1 } },
    };

    expect(isUsable(state, 'made-up-model', {}, T0)).toBe(false);
  });

  it('honours a remote-config override of the shipped defaults', () => {
    const base = newKeyState('k', T0);
    const state: KeyState = {
      ...base,
      daily: { ...base.daily, [MODEL]: { used: 900, resetAt: MIDNIGHT_1 } },
    };

    expect(isUsable(state, MODEL, DEFAULT_MODEL_BUDGETS, T0)).toBe(true);
    expect(isUsable(state, MODEL, budgets(15, 500), T0)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Model fallback
 * ------------------------------------------------------------------ */

describe('selectModel', () => {
  const chainBudgets: ModelBudgets = {
    [MODEL]: { rpm: 15, rpd: 2 },
    [FLASH]: { rpm: 10, rpd: 2 },
    [LEGACY]: { rpm: 15, rpd: 2 },
  };

  it('degrades the model tier by tier as each one is spent pool-wide', () => {
    let key = newKeyState('k', T0);
    expect(selectModel([key], chainBudgets, T0)).toBe(MODEL);

    key = applyOutcome(key, MODEL, { kind: 'quota_daily' }, T0, chainBudgets);
    expect(selectModel([key], chainBudgets, T0)).toBe(FLASH);

    key = applyOutcome(key, FLASH, { kind: 'quota_daily' }, T0, chainBudgets);
    expect(selectModel([key], chainBudgets, T0)).toBe(LEGACY);

    key = applyOutcome(key, LEGACY, { kind: 'quota_daily' }, T0, chainBudgets);
    expect(selectModel([key], chainBudgets, T0)).toBeNull();

    // The whole chain comes back at the Pacific reset.
    expect(selectModel([key], chainBudgets, MIDNIGHT_1)).toBe(MODEL);
  });

  it('only needs one key in the pool to still be usable', () => {
    const spent = applyOutcome(newKeyState('spent', T0), MODEL, { kind: 'quota_daily' }, T0, chainBudgets);
    const fresh = newKeyState('fresh', T0);

    expect(selectModel([spent, fresh], chainBudgets, T0)).toBe(MODEL);
    expect(selectKey([spent, fresh], MODEL, chainBudgets, T0).id).toBe('fresh');
  });

  it('accepts a caller-supplied chain', () => {
    const key = applyOutcome(newKeyState('k', T0), MODEL, { kind: 'quota_daily' }, T0, chainBudgets);

    expect(selectModel([key], chainBudgets, T0, [MODEL])).toBeNull();
    expect(selectModel([key], chainBudgets, T0, [LEGACY, FLASH])).toBe(LEGACY);
  });

  it('returns null for an empty pool', () => {
    expect(selectModel([], chainBudgets, T0)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * poolHealth
 * ------------------------------------------------------------------ */

describe('poolHealth', () => {
  const budget = budgets(15, 5);

  it('summarises the pool with lazily-recovered statuses', () => {
    const active = newKeyState('a', T0);
    const cooling = applyOutcome(newKeyState('c', T0), MODEL, { kind: 'http_429' }, T0, budget);
    const spent = applyOutcome(newKeyState('s', T0), MODEL, { kind: 'quota_daily' }, T0, budget);
    const dead = applyOutcome(newKeyState('d', T0), MODEL, { kind: 'key_invalid' }, T0, budget);

    expect(poolHealth([active, cooling, spent, dead], MODEL, budget, T0 + 1_000)).toEqual([
      { keyId: 'a', status: 'ACTIVE', retryAt: null },
      { keyId: 'c', status: 'COOLDOWN', retryAt: T0 + 60_000 },
      { keyId: 's', status: 'EXHAUSTED', retryAt: MIDNIGHT_1 },
      { keyId: 'd', status: 'DEAD', retryAt: null },
    ]);
  });

  it('self-heals once the timers lapse', () => {
    const cooling = applyOutcome(newKeyState('c', T0), MODEL, { kind: 'http_429' }, T0, budget);
    const spent = applyOutcome(newKeyState('s', T0), MODEL, { kind: 'quota_daily' }, T0, budget);

    expect(poolHealth([cooling], MODEL, budget, T0 + 60_000)).toEqual([
      { keyId: 'c', status: 'ACTIVE', retryAt: null },
    ]);
    expect(poolHealth([spent], MODEL, budget, MIDNIGHT_1)).toEqual([
      { keyId: 's', status: 'ACTIVE', retryAt: null },
    ]);
  });

  it('is JSON-safe (no Infinity crosses the message bus)', () => {
    const dead = applyOutcome(newKeyState('d', T0), MODEL, { kind: 'key_invalid' }, T0, budget);
    const snapshot = poolHealth([dead], MODEL, budget, T0);

    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});
