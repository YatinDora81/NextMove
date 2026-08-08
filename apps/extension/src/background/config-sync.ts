/**
 * background/config-sync.ts — F-14 remote adapter config (JF-001 Rev 3.0 SEC 8.3, SEC 4.4, SEC 10).
 *
 * ── The MV3 compliance argument, stated once, in the file that depends on it ─────────────────────
 * What this module fetches is **DATA, NEVER CODE**. `adapters.json` is a static, versioned JSON
 * document on Vercel's CDN containing CSS selectors, synonym lists, capture/confirmation hints and
 * approximate model budgets. Nothing in it is ever evaluated, `Function`-constructed, injected as a
 * script, or turned into a code path: it is parsed with `JSON.parse`, validated with
 * `remoteAdapterConfigSchema` from `@repo/types/ExtensionTypes`, semver-gated, and then handed to
 * `core/adapters/registry.ts` as plain merge input. That is precisely what makes F-14
 * ("broken-by-site-update fixes ship in hours, without a store re-review") legal under Manifest V3's
 * remote-code ban — and it is why this file must never grow an `eval`, an `import()` of a fetched
 * URL, or a `chrome.scripting.executeScript` fed from the payload.
 *
 * ── Failure policy (INV-3, local-first) ─────────────────────────────────────────────────────────
 * A fetch failure is SILENT and keeps the last good config — the shipped `adapters.seed.json` is a
 * complete, working configuration on its own, so a dead CDN degrades nothing. The only thing a
 * failure changes is `lastError`, which the Options page may surface as a diagnostic.
 *
 * ── The semver gate ─────────────────────────────────────────────────────────────────────────────
 * A fetched document replaces the cached one only when it is strictly newer than BOTH the shipped
 * seed and whatever is already cached. A CDN rollback therefore cannot silently downgrade a client
 * that already pulled a fix, and an extension release that ships a newer seed than the CDN wins.
 *
 * ── Storage note ────────────────────────────────────────────────────────────────────────────────
 * The SEC 7.1 storage map is a closed set of six `jf.*` data slots owned by `platform/storage.ts`.
 * The remote-config cache is not user data and is not part of that map, so — exactly like
 * `jf.vault.secret`, which `platform/crypto.ts` owns — it lives in its own key written directly.
 * It is disposable: deleting it costs one HTTP request.
 */

import { remoteAdapterConfigSchema } from '@repo/types/ExtensionTypes';

import { setModelBudgets, setModelChain } from '@/ai/rotation-store';
import { SEED_VERSION, isConfigNewer, resolveModelBudgets } from '@/core/adapters/registry';
import { createLogger } from '@/platform/logger';
import { getSettings } from '@/platform/storage';
import {
  CONFIG_FETCH_TIMEOUT_MS,
  CONFIG_MIN_POLL_INTERVAL_MS,
  CONFIG_URL,
} from '@/shared/constants';
import type { RemoteConfig, RemoteConfigCache } from '@/shared/types';

const log = createLogger('bg:config');

/**
 * Background-owned cache slot. Deliberately outside the SEC 7.1 `jf.*` data map (see the header):
 * it holds no user data, and losing it is a one-request problem, not a data-loss problem.
 */
export const CONFIG_CACHE_KEY = 'jf.config';

const EMPTY_CACHE: RemoteConfigCache = { config: null, fetchedAt: 0, lastError: null };

/* ------------------------------------------------------------------------------------------------
 * Cache I/O — never assume the worker stayed alive; always read it back
 * ---------------------------------------------------------------------------------------------- */

/**
 * Read the cached document. A cache that fails validation (a half-written record, a payload from a
 * future build) is treated as absent rather than repaired — the seed is always a valid fallback.
 */
export async function readConfigCache(): Promise<RemoteConfigCache> {
  let raw: unknown;
  try {
    const stored = await browser.storage.local.get(CONFIG_CACHE_KEY);
    raw = stored[CONFIG_CACHE_KEY];
  } catch (error) {
    log.debug('could not read the remote-config cache', error);
    return { ...EMPTY_CACHE };
  }

  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_CACHE };
  const record = raw as { config?: unknown; fetchedAt?: unknown; lastError?: unknown };

  const parsed = remoteAdapterConfigSchema.safeParse(record.config);
  return {
    config: parsed.success ? parsed.data : null,
    fetchedAt: typeof record.fetchedAt === 'number' && Number.isFinite(record.fetchedAt) ? record.fetchedAt : 0,
    lastError: typeof record.lastError === 'string' ? record.lastError : null,
  };
}

async function writeConfigCache(cache: RemoteConfigCache): Promise<void> {
  try {
    await browser.storage.local.set({ [CONFIG_CACHE_KEY]: cache });
  } catch (error) {
    log.warn('could not persist the remote-config cache', error);
  }
}

/** The validated CDN document currently in force, or `null` when we are running on the seed. */
export async function getRemoteConfig(): Promise<RemoteConfig | null> {
  return (await readConfigCache()).config;
}

/** Version of the config actually in force: the cached CDN document, else the shipped seed. */
export async function getActiveConfigVersion(): Promise<string> {
  const cache = await readConfigCache();
  return cache.config?.version ?? SEED_VERSION;
}

/* ------------------------------------------------------------------------------------------------
 * Runtime application — the only side effects a config document is allowed to have
 * ---------------------------------------------------------------------------------------------- */

/**
 * Push the two runtime knobs a config document controls into the rotation store:
 *
 *   `modelBudgets` — SEC 5.2's numbers are approximate ("Google revises free-tier limits without
 *                    notice"), so they are config-driven soft ceilings rather than constants.
 *   `modelFallbackChain` — user preference from `jf.settings` (SEC 5.4 "configurable").
 *
 * Adapter selectors and synonyms are NOT applied globally: they are resolved per request in
 * `CONFIG_GET`, because they depend on the page URL (Workday's per-tenant layers).
 */
export async function applyRuntimeConfig(remote: RemoteConfig | null): Promise<void> {
  setModelBudgets(resolveModelBudgets({ remote }));

  const settings = await getSettings();
  const chain = settings.modelFallbackChain.filter((model) => model.length > 0);
  setModelChain(chain.length > 0 ? chain : null);
}

/**
 * Service-worker start-up: re-apply whatever we already hold. The worker dies constantly, and the
 * rotation store keeps its budgets in module scope — so this has to run on every wake, not once
 * per install.
 */
export async function primeRuntimeConfig(): Promise<RemoteConfig | null> {
  const cache = await readConfigCache();
  await applyRuntimeConfig(cache.config);
  return cache.config;
}

/* ------------------------------------------------------------------------------------------------
 * Fetch → validate → semver-gate → replace
 * ---------------------------------------------------------------------------------------------- */

export interface ConfigRefreshResult {
  /** `true` only when a strictly newer, fully valid document replaced the cache. */
  updated: boolean;
  /** The version now in force (cached document, or the shipped seed). */
  version: string;
  /** epoch ms of the last successful fetch; `0` when nothing has ever been fetched. */
  fetchedAt: number;
}

export interface ConfigRefreshOptions {
  /** Bypass `CONFIG_MIN_POLL_INTERVAL_MS`. The manual "Check for updates" button sets this. */
  force?: boolean;
  /** Ignore `settings.remoteConfigEnabled`. Only the explicit user action does this. */
  ignoreSetting?: boolean;
  now?: number;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * One HTTP GET against `CONFIG_URL`, bounded by `CONFIG_FETCH_TIMEOUT_MS`.
 *
 * `cache: 'no-cache'` asks Chrome to revalidate rather than serve a stale CDN copy — the whole
 * point of F-14 is that a fix lands in hours, and a 24h HTTP cache would eat that budget twice.
 */
async function fetchConfigDocument(): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, CONFIG_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(CONFIG_URL, {
      method: 'GET',
      cache: 'no-cache',
      credentials: 'omit',
      redirect: 'follow',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${CONFIG_URL} responded ${String(response.status)}`);
    }
    // Parsed as data. There is no code path from this value to execution — see the file header.
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * F-14 in full: poll the CDN, validate, semver-gate, and only then replace the cached config.
 *
 * Never throws and never rejects. A network failure, a 404, a truncated body, a payload that fails
 * `remoteAdapterConfigSchema`, or a version that is not strictly newer all resolve to
 * `{ updated: false }` with the previous config left completely untouched (INV-3).
 */
export async function refreshRemoteConfig(
  options: ConfigRefreshOptions = {},
): Promise<ConfigRefreshResult> {
  const now = options.now ?? Date.now();
  const cache = await readConfigCache();
  const currentVersion = cache.config?.version ?? null;

  const unchanged = (): ConfigRefreshResult => ({
    updated: false,
    version: currentVersion ?? SEED_VERSION,
    fetchedAt: cache.fetchedAt,
  });

  if (options.ignoreSetting !== true) {
    const settings = await getSettings();
    if (!settings.remoteConfigEnabled) {
      log.debug('remote config is disabled in settings — skipping the poll');
      return unchanged();
    }
  }

  if (options.force !== true && now - cache.fetchedAt < CONFIG_MIN_POLL_INTERVAL_MS) {
    log.debug('remote config was fetched recently — skipping the poll');
    return unchanged();
  }

  let raw: unknown;
  try {
    raw = await fetchConfigDocument();
  } catch (error) {
    // Silent by design: the shipped seed is a complete configuration (INV-3).
    const message = describe(error);
    log.debug(`remote config fetch failed, keeping the last good config: ${message}`);
    await writeConfigCache({ ...cache, lastError: message });
    return unchanged();
  }

  const parsed = remoteAdapterConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const message = `adapters.json failed remoteAdapterConfigSchema: ${parsed.error.message}`;
    log.warn(message);
    await writeConfigCache({ ...cache, lastError: message });
    return unchanged();
  }

  // The gate: strictly newer than the shipped seed AND than whatever we already cached. A CDN
  // rollback cannot downgrade us, and a release that ships a newer seed wins over a stale CDN.
  const baseline =
    currentVersion !== null && isConfigNewer(currentVersion, SEED_VERSION) ? currentVersion : SEED_VERSION;

  if (!isConfigNewer(parsed.data.version, baseline)) {
    log.debug(
      `remote config ${parsed.data.version} is not newer than ${baseline} — keeping the current config`,
    );
    await writeConfigCache({ config: cache.config, fetchedAt: now, lastError: null });
    return { updated: false, version: baseline, fetchedAt: now };
  }

  const next: RemoteConfigCache = { config: parsed.data, fetchedAt: now, lastError: null };
  await writeConfigCache(next);
  await applyRuntimeConfig(parsed.data);

  log.info(`remote adapter config updated: ${baseline} → ${parsed.data.version}`);
  return { updated: true, version: parsed.data.version, fetchedAt: now };
}

/**
 * The `jf.alarm.configPoll` job (SEC 5.4 / F-14): once every 24 h, honouring the settings toggle
 * and the minimum poll interval. Alarms fire in a worker that may have just been spun up, so the
 * runtime knobs are re-applied here too rather than assumed.
 */
export async function runConfigPoll(now: number = Date.now()): Promise<ConfigRefreshResult> {
  const result = await refreshRemoteConfig({ now });
  if (!result.updated) await primeRuntimeConfig();
  return result;
}
