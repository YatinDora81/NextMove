/**
 * ai/rotation-store.ts — the chrome.storage host adapter for `@repo/rotation`.
 *
 * `@repo/rotation` is pure: it never touches storage and never reads a clock. This file is the
 * half that does. It loads `KeyState[]` out of the vault, drives `selectKey` / `markLeased` /
 * `applyOutcome`, and **persists after every single transition** — because an MV3 service worker
 * dies whenever Chrome feels like it, and a rotation ledger that only lived in memory would
 * forget a 429 cooldown the moment the worker was recycled (SEC 5.4).
 *
 * `runWithRotation` is the loop SEC 5.4 specifies:
 *   - at most `MAX_KEYS_PER_REQUEST` (3) keys per user request — bounded latency, and a systemic
 *     Google outage cannot burn the whole pool
 *   - when an entire model tier is spent pool-wide, degrade down `MODEL_FALLBACK_CHAIN` rather
 *     than failing the user
 *   - the optimistic daily increment is refunded on 5xx/network (`applyOutcome` does that part)
 *
 * INV-5: the plaintext key exists only inside `vault.withDecryptedKey`, which this module calls
 *        and whose value it never captures.
 * INV-6: nothing here knows the NextMove API exists.
 */

import type { KeyState, ModelBudget, ModelBudgets, ModelId, Outcome, PoolSnapshot } from '@repo/rotation';
import {
  AllKeysBusyError,
  DEFAULT_MODEL_BUDGETS,
  MAX_KEYS_PER_REQUEST,
  MODEL_FALLBACK_CHAIN,
  applyOutcome,
  markLeased,
  newLedger,
  nextAvailability,
  poolHealth,
  pruneRpm,
  refreshStatus,
  rollDaily,
  selectKey,
  selectModel,
} from '@repo/rotation';

import type { GeminiKeyPublic } from '@/shared/types';

import type { AiFailure } from './errors';
import { AiError, allKeysBusy, keyInvalid, networkFailed, noKeysConfigured, outputInvalid } from './errors';
import type { GeminiResult } from './gemini-client';
import { getKeyLabel, listKeys, loadKeyStates, saveKeyStates, withDecryptedKey } from './vault';

/* ------------------------------------------------------------------------------------------------
 * Config (remote-overridable — SEC 5.2 / 5.6)
 * ---------------------------------------------------------------------------------------------- */

let budgetOverride: ModelBudgets | null = null;
let chainOverride: readonly ModelId[] | null = null;

/**
 * Apply `modelBudgets` from the remote adapter config (F-14). The shipped numbers are approximate
 * — Google revises free-tier limits without notice — so this is the supported way to correct them
 * without an extension release. Passing `null` restores the shipped defaults.
 */
export function setModelBudgets(budgets: ModelBudgets | null): void {
  budgetOverride = budgets;
}

export function getModelBudgets(): ModelBudgets {
  return budgetOverride ?? DEFAULT_MODEL_BUDGETS;
}

/** Override the fallback chain from settings (`Settings.modelFallbackChain`) or remote config. */
export function setModelChain(chain: readonly ModelId[] | null): void {
  chainOverride = chain !== null && chain.length > 0 ? [...chain] : null;
}

export function getModelChain(): readonly ModelId[] {
  return chainOverride ?? MODEL_FALLBACK_CHAIN;
}

function budgetFor(budgets: ModelBudgets, model: ModelId): ModelBudget {
  return budgets[model] ?? DEFAULT_MODEL_BUDGETS[model] ?? { rpm: 10, rpd: 200 };
}

/** `[preferred, ...chain]`, de-duplicated, preserving order. */
function buildChain(preferred: ModelId | undefined, chain: readonly ModelId[]): ModelId[] {
  const ordered: ModelId[] = [];
  const seen = new Set<ModelId>();
  const push = (model: ModelId | undefined): void => {
    if (model === undefined || model.length === 0 || seen.has(model)) return;
    seen.add(model);
    ordered.push(model);
  };
  push(preferred);
  for (const model of chain) push(model);
  if (ordered.length === 0) push(MODEL_FALLBACK_CHAIN[0]);
  return ordered;
}

function replaceState(states: readonly KeyState[], next: KeyState): KeyState[] {
  return states.map((state) => (state.id === next.id ? next : state));
}

/**
 * Turn "nothing is usable" into the right row of the SEC 5.6 table.
 *
 * `daily` scope means every surviving key has spent its RPD budget for every model in the chain —
 * that is the "Free daily quota used across N keys" case, which resets at Pacific midnight rather
 * than in seconds. Anything else is a cooldown/RPM wait and gets the countdown copy.
 */
function busyFailure(
  states: readonly KeyState[],
  budgets: ModelBudgets,
  now: number,
  chain: readonly ModelId[],
): AiFailure {
  let retryAt = Number.POSITIVE_INFINITY;
  for (const model of chain) {
    const at = nextAvailability(states, model, budgets, now);
    if (at < retryAt) retryAt = at;
  }

  const alive = states.filter((state) => state.status !== 'DEAD');
  const allDaily =
    alive.length > 0 &&
    alive.every((state) =>
      chain.every((model) => rollDaily(state, model, now).used >= budgetFor(budgets, model).rpd),
    );

  return allKeysBusy(retryAt, allDaily ? 'daily' : 'cooldown', alive.length);
}

/* ------------------------------------------------------------------------------------------------
 * Single-shot lease / report (the primitives; `runWithRotation` is what callers usually want)
 * ---------------------------------------------------------------------------------------------- */

export interface Lease {
  keyId: string;
  model: ModelId;
}

/**
 * Pick a key for `model` (or for the best model in the chain), apply the optimistic ledger
 * increment, and flush it to storage before returning. The caller MUST follow up with
 * `reportOutcome` — an un-reported lease leaves the daily unit spent, which is the safe direction.
 *
 * @throws {AiError} `NoKeysConfigured` when the vault is empty, `AllKeysBusy` otherwise.
 */
export async function leaseKey(model?: ModelId): Promise<Lease> {
  const budgets = getModelBudgets();
  const chain = buildChain(model, getModelChain());
  const now = Date.now();
  const states = await loadKeyStates();

  if (states.length === 0) throw new AiError(noKeysConfigured());

  const target = model ?? selectModel(states, budgets, now, chain);
  if (target === null) throw new AiError(busyFailure(states, budgets, now, chain));

  try {
    const selected = selectKey(states, target, budgets, now);
    const leased = markLeased(selected, target, now);
    await saveKeyStates([leased]);
    return { keyId: leased.id, model: target };
  } catch (error) {
    if (error instanceof AllKeysBusyError) {
      throw new AiError(busyFailure(states, budgets, now, chain), error);
    }
    throw error;
  }
}

/**
 * Apply the SEC 5.4 result state machine to one key and persist it. Unknown key ids are ignored
 * rather than throwing: the user may have deleted the key while the request was in flight.
 */
export async function reportOutcome(
  keyId: string,
  model: ModelId,
  outcome: Outcome,
  now: number = Date.now(),
): Promise<void> {
  const states = await loadKeyStates();
  const current = states.find((state) => state.id === keyId);
  if (current === undefined) return;
  await saveKeyStates([applyOutcome(current, model, outcome, now, getModelBudgets())]);
}

/* ------------------------------------------------------------------------------------------------
 * Pool health (KEYS_STATUS)
 * ---------------------------------------------------------------------------------------------- */

export interface PoolStatus {
  /** The model the snapshot is measured against; `null` only when the vault is empty. */
  model: ModelId | null;
  pool: PoolSnapshot[];
  /** Masked key rows — INV-5: never anything more than a mask. */
  keys: GeminiKeyPublic[];
}

/**
 * Everything the key-health UI needs, measured against the model that would actually serve the
 * next request. Shape matches the `KEYS_STATUS` bus reply exactly.
 */
export async function poolStatus(model?: ModelId, now: number = Date.now()): Promise<PoolStatus> {
  const budgets = getModelBudgets();
  const chain = buildChain(model, getModelChain());
  const states = await loadKeyStates();

  if (states.length === 0) return { model: null, pool: [], keys: [] };

  const target = model ?? selectModel(states, budgets, now, chain) ?? chain[0] ?? null;
  if (target === null) return { model: null, pool: [], keys: await listKeys(undefined, budgets, now) };

  return {
    model: target,
    pool: poolHealth(states, target, budgets, now),
    keys: await listKeys(target, budgets, now),
  };
}

/** `true` when at least one key exists — drives the "AI affordances disabled" state (SEC 5.6). */
export async function hasUsableVault(): Promise<boolean> {
  return (await loadKeyStates()).length > 0;
}

/* ------------------------------------------------------------------------------------------------
 * Pacific-midnight reset (chrome.alarms — SEC 5.4)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Roll every daily ledger and un-EXHAUST every key. Called by the `jf.alarm.quotaReset` alarm at
 * 00:00 America/Los_Angeles, which is when Google resets free-tier quotas.
 *
 * The rotation math already rolls ledgers lazily on read (`rollDaily`), so this is belt-and-braces
 * rather than load-bearing — but it is what makes the quota UI flip at midnight for a user who is
 * staring at it, instead of on their next request.
 */
export async function resetDailyLedgers(now: number = Date.now()): Promise<void> {
  const states = await loadKeyStates();
  if (states.length === 0) return;

  const models = new Set<ModelId>(getModelChain());
  const fresh = newLedger(now);

  const rolled = states.map((state) => {
    for (const model of Object.keys(state.daily)) models.add(model);

    const daily: Record<ModelId, { used: number; resetAt: number }> = {};
    const rpm: Record<ModelId, number[]> = {};
    for (const model of models) {
      daily[model] = { used: 0, resetAt: fresh.resetAt };
      rpm[model] = pruneRpm(state, model, now);
    }

    return {
      ...state,
      // DEAD is user-fixable only; a daily reset must not resurrect a revoked key (SEC 5.4).
      status: state.status === 'EXHAUSTED' ? ('ACTIVE' as const) : state.status,
      daily,
      rpm,
    };
  });

  await saveKeyStates(rolled);
}

/* ------------------------------------------------------------------------------------------------
 * The request loop
 * ---------------------------------------------------------------------------------------------- */

export interface RotationCallContext {
  keyId: string;
  model: ModelId;
  /** 1-based index of this key within the current user request. */
  attempt: number;
}

export interface RotationOptions {
  /** Template's preferred tier; tried first, then the chain. */
  preferredModel?: ModelId;
  chain?: readonly ModelId[];
  /** Defaults to `MAX_KEYS_PER_REQUEST` (3). */
  maxKeys?: number;
  /** Performs one Gemini call with a borrowed plaintext key. Must not retain `apiKey`. */
  call: (apiKey: string, ctx: RotationCallContext) => Promise<GeminiResult>;
}

export interface RotationSuccess {
  text: string;
  model: ModelId;
  keyId: string;
  /** How many keys this request consumed. */
  attempts: number;
}

/**
 * Run one logical generation across the pool.
 *
 * Order of events per attempt: select (LRU among usable) → mark leased → **persist** → borrow the
 * plaintext → call → classify → apply outcome → **persist**. Both persists matter: the first
 * means a worker that dies mid-flight still remembers it spent a request, the second means a 429
 * cooldown outlives the worker that observed it.
 *
 * @throws {AiError} always, on failure — never returns a partial result.
 */
export async function runWithRotation(options: RotationOptions): Promise<RotationSuccess> {
  const budgets = getModelBudgets();
  const chain = buildChain(options.preferredModel, options.chain ?? getModelChain());
  const maxKeys = Math.max(1, options.maxKeys ?? MAX_KEYS_PER_REQUEST);

  let states = await loadKeyStates();
  if (states.length === 0) throw new AiError(noKeysConfigured());

  let keysUsed = 0;
  let sawBusy = false;
  let rateLimited = false;
  let lastFailure: AiFailure | null = null;
  let lastKeyInvalid: AiFailure | null = null;

  for (const model of chain) {
    while (keysUsed < maxKeys) {
      const leaseAt = Date.now();

      let selected: KeyState;
      try {
        selected = selectKey(states, model, budgets, leaseAt);
      } catch (error) {
        if (error instanceof AllKeysBusyError) {
          // This whole tier is spent — degrade to the next model rather than failing (SEC 5.4).
          sawBusy = true;
          break;
        }
        throw error;
      }

      const leased = markLeased(selected, model, leaseAt);
      states = replaceState(states, leased);
      await saveKeyStates([leased]);
      keysUsed += 1;

      let result: GeminiResult;
      try {
        // INV-5: the plaintext exists only inside this callback frame; `withDecryptedKey`
        // drops it before it returns, and nothing here captures it.
        result = await withDecryptedKey(leased.id, (apiKey) =>
          options.call(apiKey, { keyId: leased.id, model, attempt: keysUsed }),
        );
      } catch (error) {
        // A decrypt failure or a throw from `call` is not the key's fault: refund and move on.
        const refunded = applyOutcome(leased, model, { kind: 'net_or_5xx' }, Date.now(), budgets);
        states = replaceState(states, refunded);
        await saveKeyStates([refunded]);
        lastFailure = networkFailed(null, error instanceof Error ? error.message : String(error));
        continue;
      }

      const outcome: Outcome = result.ok ? { kind: 'ok' } : result.outcome;
      const settled = applyOutcome(leased, model, outcome, Date.now(), budgets);
      states = replaceState(states, settled);
      await saveKeyStates([settled]);

      if (result.ok) {
        return { text: result.text, model, keyId: leased.id, attempts: keysUsed };
      }

      if (result.outcome.kind === 'key_invalid') {
        lastKeyInvalid = keyInvalid(leased.id, await getKeyLabel(leased.id), result.message);
        lastFailure = lastKeyInvalid;
        continue;
      }

      if (result.outcome.kind === 'http_429' || result.outcome.kind === 'quota_daily') {
        rateLimited = true;
        lastFailure = networkFailed(result.status, result.message);
        continue;
      }

      if (!result.retriable) {
        // A safety block or a malformed request: another key changes nothing.
        throw new AiError(
          result.blocked
            ? outputInvalid('gemini', result.message)
            : networkFailed(result.status, result.message),
        );
      }

      lastFailure = networkFailed(result.status, result.message);
    }

    if (keysUsed >= maxKeys) break;
  }

  const now = Date.now();

  // Every key in the pool is now DEAD — the user has to fix something, so say which key died.
  if (lastKeyInvalid !== null && states.every((state) => state.status === 'DEAD')) {
    throw new AiError(lastKeyInvalid);
  }
  if (sawBusy || rateLimited) throw new AiError(busyFailure(states, budgets, now, chain));
  if (lastFailure !== null) throw new AiError(lastFailure);
  throw new AiError(busyFailure(states, budgets, now, chain));
}

/** Re-exported for the alarm registration site and for tests. */
export { MAX_KEYS_PER_REQUEST, MODEL_FALLBACK_CHAIN };

/** `refreshStatus` is re-exported so a UI can lazily recover statuses without importing rotation. */
export { refreshStatus };
