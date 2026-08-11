import type { jobApplicationRowSchemaType } from '@repo/types/ExtensionTypes';

import { listUnsyncedApplications, putApplication } from '@/platform/db';
import { createLogger } from '@/platform/logger';
import { getSettings, patchSettings } from '@/platform/storage';
import { errReply, okReply } from '@/shared/messages';
import type { MessageHandlers } from '@/shared/messages';
import type { ApplicationRow, AppStatus, SyncScope, SyncState } from '@/shared/types';
import {
  isApplicationPushBlocked,
  isPaired,
  noteApplicationPushed,
  noteApplicationRefused,
  pushApplications,
  pushMappings,
  readApplicationSyncMap,
  wireClientIdFor,

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

/**
 * `jobApplicationRowSchema` (packages/Types) requires a non-empty `role`, but plenty of postings
 * hide the title behind a lazily rendered header that auto-capture never sees. Dropping those rows
 * meant a tracked application was silently never synced and never reached the web Applied page —
 * data loss the user has no way to notice. A placeholder they can edit is strictly better.
 */
const UNKNOWN_ROLE = 'Unknown role';

/**
 * `clientId` is passed in rather than read off the row: it is the identity the SERVER holds for
 * this application, which is only the local id until the two diverge (see `readApplicationSyncMap`).
 */
function toWireRow(row: ApplicationRow, clientId: string): jobApplicationRowSchemaType | null {
  const company = row.company.trim();
  const role = row.role.trim();
  if (company.length === 0) return null;

  return {
    clientId,
    company,
    role: role.length > 0 ? role : UNKNOWN_ROLE,
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

  let applicationsError: string | null = null;
  if (scopes.has('applications')) {
    const identities = await readApplicationSyncMap();
    const rows = await listUnsyncedApplications();
    const wire: jobApplicationRowSchemaType[] = [];
    // One clientId can name SEVERAL local rows — the same posting under two profiles, or a
    // `www.`/`https` pair the server's url reduction collapses — because both adopt the id the
    // server answered with. A plain `Map<string, ApplicationRow>` loses all but the last of them,
    // and the loser is never stamped, so the alarm re-pushes it on every tick forever.
    const byWireClientId = new Map<string, ApplicationRow[]>();
    let blocked = 0;

    for (const row of rows) {
      // A parked row is one the server has refused to the ceiling. It stays unsynced — it is not
      // lost — but it stops spending a write per tick on a verdict that cannot change by itself.
      if (isApplicationPushBlocked(identities[row.id], row.updatedAt ?? 0)) {
        blocked += 1;
        continue;
      }
      // Address the server by the id IT holds for this row. Sending the local id instead is what
      // makes an edited url miss both server lookups and mint a duplicate application.
      const converted = toWireRow(row, wireClientIdFor(identities, row.id));
      if (converted === null) continue;

      const sharing = byWireClientId.get(converted.clientId);
      if (sharing === undefined) {
        // Only the first of a colliding set goes on the wire. Sending the same clientId twice in
        // one batch is two upserts of one server row where the second silently wins, which is a
        // write and a race for no gain — the server holds one row for the posting either way.
        byWireClientId.set(converted.clientId, [row]);
        wire.push(converted);
      } else {
        sharing.push(row);
      }
    }


    if (wire.length > 0) {
      const result = await pushApplications(wire);
      if (!result.ok) {
        const busError = toBusError(result.error);
        return errReply(busError.code, busError.message, busError.retryAt);
      }
      // Resolve every acknowledgement by the clientId we PUSHED, never by the one that came back.
      //
      // The server's upsert falls back to the posting's url when the clientId lookup misses, and
      // that branch keeps the matched row's original clientId (it is the id other installs address
      // the application by). After a reinstall every row takes that branch, so keying this lookup
      // on the returned id misses every time, `syncedAt` is never written, and the alarm re-pushes
      // the whole table on every tick, forever.
      //
      // The returned id is not discarded either: `noteApplicationPushed` adopts it as this row's
      // wire identity, so from here on both sides name the same application. The Dexie primary key
      // is deliberately left alone — see the note above `readApplicationSyncMap`.
      const at = Date.now();
      let diverged = 0;
      for (const saved of result.data.saved) {
        const locals = byWireClientId.get(saved.requestedClientId);
        if (locals === undefined) continue;
        if (saved.row.clientId !== saved.requestedClientId) diverged += 1;
        // Every local row sharing this identity settles on the one acknowledgement — a row that
        // never went on the wire is represented by the one that did, not left behind unsynced.
        for (const local of locals) {
          await putApplication({ ...local, syncedAt: at });
          await noteApplicationPushed(local.id, saved.row.clientId);
        }
      }

      if (diverged > 0) {
        log.debug(`${diverged} row(s) resolved to an application the account already tracked`);
      }
      if (result.data.duplicateUrls.length > 0) {
        log.debug(
          `${String(result.data.duplicateUrls.length)} row(s) refused: another application ` +
            'already tracks that posting',
        );
      }
      for (const refused of result.data.duplicateUrls) {
        const locals = byWireClientId.get(refused);
        if (locals === undefined) continue;
        // The refusal is about the posting, so it lands on every local row that named it — leaving
        // the ones that shared the wire slot unmarked would retry them forever with no ceiling.
        for (const local of locals) {
          if (await noteApplicationRefused(local.id, local.updatedAt ?? 0)) blocked += 1;
        }
      }

      pushed.applications = result.data.pushed;
    }

    if (blocked > 0) {
      // The alarm path throws this reply away (`drainSync` only logs it), so the durable signal is
      // `listBlockedApplications()` — this sentence is for whoever asked for the push.
      applicationsError =
        `${String(blocked)} application${blocked === 1 ? '' : 's'} could not be synced: another ` +
        'application already tracks that job posting. Merge or delete the duplicate in NextMove ' +
        'on the web, then edit the row here to try again.';
      log.warn(`${String(blocked)} application row(s) parked after repeated DUPLICATE_URL refusals`);
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

  // A missing vault key blocks the whole profile, so it outranks a single stuck application row.
  const reportedError = profileError ?? applicationsError;
  const state: SyncState = await status();
  const finalState: SyncState =
    reportedError === null ? state : { ...state, lastError: reportedError };

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
