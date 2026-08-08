/**
 * background/alarms.ts — the two `chrome.alarms` jobs (JF-001 Rev 3.0 SEC 5.4, SEC 10, F-14).
 *
 * SEC 10 specified two: *"daily config poll + Pacific-midnight quota reset."* A third joined them
 * when sync stopped being a button — see `background/sync-scheduler.ts` for why a periodic alarm is
 * the only timer that survives an MV3 worker teardown.
 * Nothing here can start a Gemini request: INV-2 forbids background or scheduled AI traffic, and
 * neither job leases a key or touches `src/ai/index.ts`. The quota job only rolls ledgers that
 * `@repo/rotation` would otherwise roll lazily on the next read.
 *
 * ── Why registration is idempotent, and why it runs on every wake ────────────────────────────────
 * An MV3 service worker is event-driven and dies constantly. Alarms themselves survive that — they
 * live in the browser, not in the worker — but a worker that has just been resurrected has no idea
 * whether the alarms were ever created (fresh install, extension update, profile sync, a user
 * toggling the extension off and on). So `registerAlarms()` runs on start-up, on install and on
 * update, and is written to be safe to call any number of times:
 *
 *   - `alarms.create(name, …)` REPLACES an existing alarm of the same name and restarts its timer.
 *     Calling it blindly on every wake would starve a 24 h poll on a machine whose worker recycles
 *     every few minutes. So we `alarms.get()` first and only create what is genuinely missing.
 *   - The quota alarm is a ONE-SHOT re-armed after each firing rather than a `periodInMinutes: 1440`
 *     repeater, because Pacific midnight is not 1440 minutes after the previous Pacific midnight
 *     twice a year. `pacificMidnightAfter()` (@repo/rotation) does the PST/PDT arithmetic; a
 *     repeating alarm would drift an hour every DST transition and reset quotas at the wrong time.
 */

import { pacificMidnightAfter } from '@repo/rotation';
import type { Browser } from 'wxt/browser';

import { resetDailyLedgers } from '@/ai/rotation-store';
import { createLogger } from '@/platform/logger';
import {
  ALARM_CONFIG_POLL,
  ALARM_QUOTA_RESET,
  ALARM_SYNC_PUSH,
  CONFIG_POLL_PERIOD_MINUTES,
} from '@/shared/constants';

import { refreshKeyBadge } from '@/background/badge';
import { runConfigPoll } from '@/background/config-sync';
import { armSyncAlarm, drainSync } from '@/background/sync-scheduler';

const log = createLogger('bg:alarms');

/**
 * How far a scheduled quota alarm may sit from the computed Pacific midnight before we re-arm it.
 * A minute of slack absorbs the arbitrary delay Chrome is allowed to add without churning the alarm
 * on every single worker wake.
 */
const QUOTA_ALARM_TOLERANCE_MS = 60_000;

/** Upper bound on a sane quota alarm: nothing legitimate is more than ~25 h out. */
const QUOTA_ALARM_MAX_HORIZON_MS = 25 * 60 * 60 * 1_000;

/* ------------------------------------------------------------------------------------------------
 * Arming
 * ---------------------------------------------------------------------------------------------- */

async function getAlarm(name: string): Promise<Browser.alarms.Alarm | undefined> {
  try {
    return await browser.alarms.get(name);
  } catch (error) {
    log.debug(`could not read alarm ${name}`, error);
    return undefined;
  }
}

/**
 * F-14 daily poll. Created only when missing, so a worker that wakes 200 times an hour does not
 * reset the 24 h timer 200 times and effectively never poll.
 */
async function armConfigAlarm(): Promise<boolean> {
  if ((await getAlarm(ALARM_CONFIG_POLL)) !== undefined) return false;
  await browser.alarms.create(ALARM_CONFIG_POLL, {
    // A short initial delay rather than `when: now`: the first poll should not compete with the
    // rest of start-up, and Chrome ignores sub-30s delays anyway.
    delayInMinutes: 1,
    periodInMinutes: CONFIG_POLL_PERIOD_MINUTES,
  });
  log.info(`armed ${ALARM_CONFIG_POLL} (every ${String(CONFIG_POLL_PERIOD_MINUTES)} minutes)`);
  return true;
}

/**
 * SEC 5.4: *"RPD ledger reset — chrome.alarms at 00:00 America/Los_Angeles. Google resets free
 * quotas on Pacific midnight."* Armed as a one-shot at the next Pacific midnight and re-armed after
 * it fires, so DST transitions cannot make it drift.
 */
export async function armQuotaAlarm(now: number = Date.now()): Promise<number> {
  const target = pacificMidnightAfter(now);
  const existing = await getAlarm(ALARM_QUOTA_RESET);

  if (existing !== undefined) {
    const delta = Math.abs(existing.scheduledTime - target);
    const horizon = existing.scheduledTime - now;
    if (delta <= QUOTA_ALARM_TOLERANCE_MS && horizon > 0 && horizon <= QUOTA_ALARM_MAX_HORIZON_MS) {
      return existing.scheduledTime;
    }
    // Stale (a DST shift, a machine that slept through midnight, a clock change) — replace it.
    await browser.alarms.clear(ALARM_QUOTA_RESET);
  }

  await browser.alarms.create(ALARM_QUOTA_RESET, { when: target });
  log.info(`armed ${ALARM_QUOTA_RESET} for ${new Date(target).toISOString()} (00:00 America/Los_Angeles)`);
  return target;
}

/**
 * Ensure both alarms exist. Idempotent and safe on every service-worker wake, on `onInstalled` and
 * on `onStartup` — which is exactly where it is called from, because the worker dies constantly and
 * has no memory of having done this before.
 */
export async function registerAlarms(now: number = Date.now()): Promise<void> {
  try {
    await armConfigAlarm();
    await armQuotaAlarm(now);
    // F-15: armed only while paired, and cleared again on unpair (INV-3 — an unpaired install
    // must never hold a scheduled job that talks to the network).
    await armSyncAlarm();
  } catch (error) {
    // Alarms are a scheduling nicety: the rotation ledgers roll lazily on read (`rollDaily`) and
    // the seed config works offline, so losing them degrades freshness, never correctness.
    log.warn('could not register alarms', error);
  }
}

/** Remove both alarms. Used by a full local wipe and by tests. */
export async function clearAlarms(): Promise<void> {
  try {
    await browser.alarms.clear(ALARM_CONFIG_POLL);
    await browser.alarms.clear(ALARM_QUOTA_RESET);
    await browser.alarms.clear(ALARM_SYNC_PUSH);
  } catch (error) {
    log.debug('could not clear alarms', error);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Firing
 * ---------------------------------------------------------------------------------------------- */

/**
 * The quota job. `resetDailyLedgers()` zeroes every per-model RPD ledger and un-EXHAUSTs the pool;
 * DEAD keys are deliberately left DEAD, because a revoked key does not come back at midnight
 * (SEC 5.4 — DEAD is user-fixable only). The badge is repainted so a user staring at the toolbar
 * sees the state flip at midnight instead of on their next request.
 */
export async function runQuotaReset(now: number = Date.now()): Promise<void> {
  await resetDailyLedgers(now);
  await refreshKeyBadge();
  await armQuotaAlarm(now + 1);
  log.info('daily RPD ledgers reset at Pacific midnight');
}

/**
 * Dispatch one alarm. Unknown names are ignored (another extension cannot reach our alarms, but a
 * stale alarm from an older build can outlive an update).
 */
export async function handleAlarm(alarm: { name: string }, now: number = Date.now()): Promise<void> {
  try {
    switch (alarm.name) {
      case ALARM_CONFIG_POLL:
        await runConfigPoll(now);
        return;
      case ALARM_QUOTA_RESET:
        await runQuotaReset(now);
        return;
      case ALARM_SYNC_PUSH:
        await drainSync();
        return;
      default:
        log.debug(`ignoring an unknown alarm: ${alarm.name}`);
        return;
    }
  } catch (error) {
    // An alarm handler that throws would be reported as an unhandled rejection inside the worker.
    // Neither job is load-bearing, so swallow it after logging.
    log.warn(`alarm ${alarm.name} failed`, error);
  }
}

let listenerInstalled = false;

/**
 * Register the `onAlarm` listener. MUST be called synchronously from the top level of the
 * background entrypoint: MV3 delivers an alarm by starting the worker and firing immediately, so a
 * listener added inside an `await` can miss the very event that woke the worker.
 */
export function installAlarmListener(): void {
  if (listenerInstalled) return;
  browser.alarms.onAlarm.addListener((alarm) => {
    void handleAlarm(alarm);
  });
  listenerInstalled = true;
}
