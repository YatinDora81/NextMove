/**
 * background/sync-scheduler.ts — turning sync from a button into a background job (F-15).
 *
 * Before this file existed, everything the extension knew reached Postgres only when a user found
 * Options → Sync and clicked "Sync now". In practice that meant: never. A tracker row written while
 * applying to a job at 11pm sat on one machine until someone remembered a button existed.
 *
 * ── Why an alarm and a dirty flag, and not a debounce ──────────────────────────────────────────
 *
 * The obvious design is a `setTimeout` a few seconds after each write. It does not work in MV3. The
 * service worker is torn down aggressively when idle, and a timer that has not fired yet is a timer
 * that never will — the worker is gone and the callback with it. `chrome.alarms` is the only timer
 * that survives, because it lives in the browser rather than in the worker.
 *
 * So writes do the cheapest possible thing: set a flag in `chrome.storage.session`. The alarm wakes
 * the worker every few minutes, sees the flag, drains it, and clears it. A crash between the write
 * and the drain costs one cycle, never a row — the flag is the only state, and it errs toward
 * syncing again rather than skipping.
 *
 * INV-3 still holds: every entry point here returns immediately when the user has not paired, and
 * nothing in a fill, a match, an answer or a tracker write can block on any of it.
 */

import { createLogger } from '@/platform/logger';
import { getSettings } from '@/platform/storage';
import { ALARM_SYNC_PUSH, SYNC_ALARM_PERIOD_MINUTES, SYNC_DIRTY_KEY } from '@/shared/constants';
import type { SyncScope } from '@/shared/types';
import { isPaired } from '@/sync';

const log = createLogger('bg:sync-scheduler');

/** Scopes awaiting a push. A Set on the wire would not survive `storage.session`, so: an array. */
type DirtyScopes = SyncScope[];

/* ------------------------------------------------------------------------------------------------
 * The dirty flag
 * ---------------------------------------------------------------------------------------------- */

async function readDirty(): Promise<DirtyScopes> {
  try {
    const stored = await browser.storage.session.get(SYNC_DIRTY_KEY);
    const raw: unknown = stored[SYNC_DIRTY_KEY];
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (scope): scope is SyncScope =>
        scope === 'profile' || scope === 'mappings' || scope === 'applications',
    );
  } catch {
    return [];
  }
}

/**
 * Note that `scope` has local changes worth pushing.
 *
 * Callers are on hot paths — saving a profile, logging an application, learning a mapping — so this
 * never awaits the network and never throws. A scheduler that could break a fill would be worse
 * than no scheduler.
 */
export async function markDirty(...scopes: readonly SyncScope[]): Promise<void> {
  if (scopes.length === 0) return;
  try {
    if (!(await isPaired())) return;
    const current = await readDirty();
    const next = [...new Set([...current, ...scopes])];
    if (next.length === current.length) return;
    await browser.storage.session.set({ [SYNC_DIRTY_KEY]: next });
    log.debug(`marked dirty: ${next.join(', ')}`);
  } catch (error) {
    log.debug('could not mark sync dirty', error);
  }
}

async function clearDirty(): Promise<void> {
  try {
    await browser.storage.session.remove(SYNC_DIRTY_KEY);
  } catch {
    // Losing the clear costs one redundant push next cycle. Harmless.
  }
}

/* ------------------------------------------------------------------------------------------------
 * The alarm
 * ---------------------------------------------------------------------------------------------- */

/**
 * Arm the periodic push, or clear it when the user is not paired.
 *
 * `alarms.create` replaces an alarm of the same name and restarts its timer, so on a machine whose
 * worker recycles every couple of minutes, calling it unconditionally on every wake would mean the
 * alarm never actually fires. Hence the `get` first — the same reasoning `armConfigAlarm` uses.
 */
export async function armSyncAlarm(): Promise<void> {
  try {
    const paired = await isPaired();
    const existing = await browser.alarms.get(ALARM_SYNC_PUSH);

    if (!paired) {
      if (existing !== undefined) {
        await browser.alarms.clear(ALARM_SYNC_PUSH);
        log.debug('cleared the sync alarm — not paired');
      }
      return;
    }
    if (existing !== undefined) return;

    await browser.alarms.create(ALARM_SYNC_PUSH, {
      delayInMinutes: SYNC_ALARM_PERIOD_MINUTES,
      periodInMinutes: SYNC_ALARM_PERIOD_MINUTES,
    });
    log.info(`armed ${ALARM_SYNC_PUSH} every ${String(SYNC_ALARM_PERIOD_MINUTES)}m`);
  } catch (error) {
    log.warn('could not arm the sync alarm', error);
  }
}

/**
 * Drain whatever is dirty. Called by the alarm, and directly after a handoff so a new device does
 * not wait five minutes to see its own data.
 *
 * The dirty flag is cleared *before* the push rather than after. That is deliberate: clearing after
 * a partial success would re-push everything next cycle, and every push in this extension is
 * already idempotent — applications key on `clientId`, mappings are last-write-wins per
 * (domain, sigHash), and the profile carries an optimistic version. Re-sending is free; losing a
 * scope's dirty bit because the drain crashed midway is not.
 */
export async function drainSync(force = false): Promise<void> {
  try {
    if (!(await isPaired())) return;
    const settings = await getSettings();
    if (!settings.syncEnabled) return;

    const scopes = force ? (['profile', 'mappings', 'applications'] as SyncScope[]) : await readDirty();
    if (scopes.length === 0) return;

    await clearDirty();

    // Imported lazily so this module can be pulled into a context that never syncs without
    // dragging the whole client and its Zod contracts along with it.
    const { dispatchLocal } = await import('@/background/router');
    const reply = await dispatchLocal('SYNC_PUSH', { scopes });
    if (!reply.ok) {
      log.warn(`background sync failed: ${reply.error.code} — ${reply.error.message}`);
      // Put the scopes back so the next cycle retries them.
      await markDirty(...scopes);
      return;
    }
    log.info(
      `background sync: profile=${String(reply.data.pushed.profile)} ` +
        `mappings=${String(reply.data.pushed.mappings)} apps=${String(reply.data.pushed.applications)}`,
    );
  } catch (error) {
    log.warn('background sync threw', error);
  }
}
