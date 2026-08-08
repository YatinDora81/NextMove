import type { jobApplicationRowSchemaType } from '@repo/types/ExtensionTypes';

import { listUnsyncedApplications, putApplication } from '@/platform/db';
import { createLogger } from '@/platform/logger';
import { getSettings, patchSettings } from '@/platform/storage';
import { errReply, okReply } from '@/shared/messages';
import type { MessageHandlers } from '@/shared/messages';
import type { ApplicationRow, AppStatus, SyncScope, SyncState } from '@/shared/types';
import {
  isPaired,
  pushApplications,
  pushMappings,
  requestPairing,
  status,
  toBusError,
  unpair,
} from '@/sync';
import { pullProfile, pushProfile, reconcileAfterPairing } from '@/sync/profile';
import { armSyncAlarm } from '@/background/sync-scheduler';

const log = createLogger('bg:sync');

type SyncHandlers = Pick<
  MessageHandlers,
  'SYNC_PAIR' | 'SYNC_UNPAIR' | 'SYNC_STATUS' | 'SYNC_PUSH' | 'SYNC_PULL'
>;

const NOT_PAIRED_MESSAGE =
  'This device is not connected to a NextMove account. Sync is opt-in — everything else in ' +
  'NextMove Autofill works offline.';

const PROFILE_NEEDS_KEY =
  'This device has no vault key, so your profile cannot sync. Reconnect from NextMove on the web ' +
  'to restore it.';

const CLOUD_STATUS: Readonly<Record<AppStatus, jobApplicationRowSchemaType['status']>> = {
  draft: 'DRAFT',
  applied: 'APPLIED',
  interview: 'INTERVIEW',
  offer: 'OFFER',
  rejected: 'REJECTED',
  ghosted: 'GHOSTED',
};

function toWireRow(row: ApplicationRow): jobApplicationRowSchemaType | null {
  const company = row.company.trim();
  const role = row.role.trim();
  if (company.length === 0 || role.length === 0) return null;

  return {
    clientId: row.id,
    company,
    role,
    url: row.url.length > 0 ? row.url : null,
    ats: row.ats,
    status: CLOUD_STATUS[row.status],
    appliedAt: row.appliedAt === null ? null : new Date(row.appliedAt).toISOString(),
    notes: row.notes.length > 0 ? row.notes : null,
    fillStats: { filled: row.fillStats.filled, total: row.fillStats.total },
    history: row.history.map((entry) => ({ at: entry.at, to: CLOUD_STATUS[entry.to] })),
  };
}

async function syncReady(): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.syncEnabled) return false;
  return isPaired();
}

const syncStatus: SyncHandlers['SYNC_STATUS'] = async () => {
  return okReply({ state: await status() });
};

const syncPair: SyncHandlers['SYNC_PAIR'] = async (payload) => {
  const code = payload.code.trim().toUpperCase();
  const deviceName = payload.deviceName.trim();
  if (code.length === 0) {
    return errReply('BAD_REQUEST', 'Enter the pairing code from NextMove → Settings.');
  }

  const result = await requestPairing(code, deviceName);
  if (!result.ok) {
    const busError = toBusError(result.error);
    log.warn(`pairing failed: ${result.error.code}`);
    return errReply(busError.code, busError.message, busError.retryAt);
  }

  await patchSettings({ syncEnabled: true });
  await armSyncAlarm();

  const reconciled = await reconcileAfterPairing();
  if (!reconciled.ok) {
    log.warn(`paired, but the first profile sync failed: ${reconciled.error.code}`);
  }

  log.info('device paired with a NextMove account');
  return okReply({ state: await status() });
};

const syncUnpair: SyncHandlers['SYNC_UNPAIR'] = async () => {
  const state = await unpair();
  await patchSettings({ syncEnabled: false });
  await armSyncAlarm();
  log.info('device unpaired; sync disabled');
  return okReply({ state });
};

const syncPush: SyncHandlers['SYNC_PUSH'] = async (payload) => {
  if (!(await syncReady())) {
    return errReply('NOT_PAIRED', NOT_PAIRED_MESSAGE);
  }

  const scopes = new Set<SyncScope>(payload.scopes);
  const pushed = { profile: false, mappings: 0, applications: 0 };

  if (scopes.has('mappings')) {
    const result = await pushMappings();
    if (!result.ok) {
      const busError = toBusError(result.error);
      return errReply(busError.code, busError.message, busError.retryAt);
    }
    pushed.mappings = result.data.pushed;
  }

  if (scopes.has('applications')) {
    const rows = await listUnsyncedApplications();
    const wire: jobApplicationRowSchemaType[] = [];
    const byClientId = new Map<string, ApplicationRow>();
    for (const row of rows) {
      const converted = toWireRow(row);
      if (converted === null) continue;
      wire.push(converted);
      byClientId.set(converted.clientId, row);
    }

    if (wire.length > 0) {
      const result = await pushApplications(wire);
      if (!result.ok) {
        const busError = toBusError(result.error);
        return errReply(busError.code, busError.message, busError.retryAt);
      }
      const at = Date.now();
      for (const saved of result.data.rows) {
        const local = byClientId.get(saved.clientId);
        if (local === undefined) continue;
        await putApplication({ ...local, syncedAt: at });
      }
      pushed.applications = result.data.pushed;
    }
  }

  let profileError: string | null = null;
  if (scopes.has('profile')) {
    const result = await pushProfile();
    if (result.ok) {
      pushed.profile = result.data.profiles > 0;
    } else if (result.error.code === 'crypto') {
      profileError = PROFILE_NEEDS_KEY;
      log.info('profile scope skipped — this device holds no vault key');
    } else {
      const busError = toBusError(result.error);
      return errReply(busError.code, busError.message, busError.retryAt);
    }
  }

  const state: SyncState = await status();
  const finalState: SyncState = profileError === null ? state : { ...state, lastError: profileError };

  return okReply({ state: finalState, pushed });
};

const syncPull: SyncHandlers['SYNC_PULL'] = async () => {
  if (!(await syncReady())) return errReply('NOT_PAIRED', NOT_PAIRED_MESSAGE);

  const result = await pullProfile();
  if (!result.ok) {
    if (result.error.code === 'crypto') return errReply('BAD_REQUEST', PROFILE_NEEDS_KEY);
    const busError = toBusError(result.error);
    return errReply(busError.code, busError.message, busError.retryAt);
  }
  return okReply({
    state: await status(),
    pulled: { found: result.data.found, applied: result.data.applied },
  });
};

export const syncHandlers: SyncHandlers = {
  SYNC_PAIR: syncPair,
  SYNC_PULL: syncPull,
  SYNC_UNPAIR: syncUnpair,
  SYNC_STATUS: syncStatus,
  SYNC_PUSH: syncPush,
};
