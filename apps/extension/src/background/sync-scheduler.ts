import { createLogger } from '@/platform/logger';
import { getSettings } from '@/platform/storage';
import { ALARM_SYNC_PUSH, SYNC_ALARM_PERIOD_MINUTES, SYNC_DIRTY_KEY } from '@/shared/constants';
import type { SyncScope } from '@/shared/types';
import { isPaired } from '@/sync';

const log = createLogger('bg:sync-scheduler');

type DirtyScopes = SyncScope[];

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

export async function drainSync(force = false): Promise<void> {
  try {
    if (!(await isPaired())) return;
    const settings = await getSettings();
    if (!settings.syncEnabled) return;

    const scopes = force ? (['profile', 'mappings', 'applications'] as SyncScope[]) : await readDirty();
    if (scopes.length === 0) return;

    await clearDirty();

    const { dispatchLocal } = await import('@/background/router');
    const reply = await dispatchLocal('SYNC_PUSH', { scopes });
    if (!reply.ok) {
      log.warn(`background sync failed: ${reply.error.code} — ${reply.error.message}`);
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
