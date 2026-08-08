/**
 * background/handlers/sync.ts — Phase-2 sync, and INV-3 in code (SEC 8.2 / 8.3, F-15).
 *
 * ── INV-3: local-first ──────────────────────────────────────────────────────────────────────────
 * *"v1 must work fully with the NextMove backend switched off. No feature except sync may require
 * the network."* These four handlers are the ONLY place in the service worker that can talk to the
 * NextMove API, and every one of them is a typed no-op until the user has explicitly opted in:
 *
 *   SYNC_STATUS  always succeeds and reports `paired: false` — asking is not opting in.
 *   SYNC_PUSH    replies `NOT_PAIRED` and opens no socket when sync is off or the device is
 *                unpaired. That is the steady state in v1, and it is not an error condition.
 *   SYNC_UNPAIR  is idempotent: disconnecting an already-disconnected device always succeeds,
 *                because the local credential is dropped either way.
 *   SYNC_PAIR    is the opt-in act itself, driven by an 8-char code the user typed into Options.
 *                Success flips `settings.syncEnabled`; nothing else in the extension may flip it.
 *
 * ── INV-5 / SEC 7.4: what may never leave the device ────────────────────────────────────────────
 * Gemini keys and the Answer Bank are never synced. That is enforced mechanically one layer down —
 * `sync/guard.ts` runs an allowlist over every outbound body and THROWS on key material, on an
 * answer-bank record, or on a plaintext profile field — and it is why this file never even reads
 * `jf.keys` or the `answerBank` table.
 *
 * ── The profile blob, and what changed ──────────────────────────────────────────────────────────
 * This handler used to skip the profile scope entirely. The reasoning was sound at the time: the
 * vault is E2E-sealed (SEC 7.4: "the server stores ciphertext it cannot read"), sealing needed the
 * user's passphrase, and a passphrase the service worker could reach unattended would defeat the
 * property. The consequence, though, was that the profile never synced at all — no UI ever
 * collected that passphrase, so `pushProfileBlob` had no callers.
 *
 * The vault key now arrives from the web onboarding handshake and lives sealed at rest under the
 * per-install secret (`sync/e2e.ts`), so the worker can seal without a human present and the server
 * still cannot read a byte of it. `SYNC_PUSH` therefore covers all three scopes, and the profile
 * scope reports honestly when this device holds no key — which means "reconnect from the web",
 * not "sync is broken".
 */

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

/** SEC 7.4 — the on-device lowercase lifecycle maps onto the cloud's uppercase `JobAppStatus`. */
const CLOUD_STATUS: Readonly<Record<AppStatus, jobApplicationRowSchemaType['status']>> = {
  draft: 'DRAFT',
  applied: 'APPLIED',
  interview: 'INTERVIEW',
  offer: 'OFFER',
  rejected: 'REJECTED',
  ghosted: 'GHOSTED',
};

/**
 * Local row → `jobApplicationRowSchema` wire row.
 *
 * `clientId` is the extension's own row id, which is what makes `POST /api/job-applications`
 * idempotent on retry (SEC 8.3). Rows with no company or role are refused rather than padded: the
 * server contract requires both, and a row with neither is a fill on a page we could not read,
 * which is worth nothing in the cloud dashboard.
 */
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

/** Opted in AND actually holding a device credential. Both halves matter (SEC 8.4). */
async function syncReady(): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.syncEnabled) return false;
  return isPaired();
}

/** SEC 8.3 — safe to call at any time, paired or not. Never touches the network. */
const syncStatus: SyncHandlers['SYNC_STATUS'] = async () => {
  return okReply({ state: await status() });
};

/**
 * SEC 8.2 steps 3-4: exchange the 8-char code for a device-bound 7-day JWT, which
 * `sync/client.ts` stores AES-GCM-encrypted (never in plaintext).
 *
 * This is the opt-in, so it is the one handler allowed to reach the API while `syncEnabled` is
 * still false. `syncEnabled` is flipped only after the exchange actually succeeds.
 */
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

  // First contact: pull the account's vault if it has one, seed it from this device if it does not.
  // A failure here is reported through `SyncState.lastError` rather than failing the pair — the
  // device *is* paired at this point, and telling the user otherwise would be a lie.
  const reconciled = await reconcileAfterPairing();
  if (!reconciled.ok) {
    log.warn(`paired, but the first profile sync failed: ${reconciled.error.code}`);
  }

  log.info('device paired with a NextMove account');
  return okReply({ state: await status() });
};

/**
 * Disconnect this install. Best-effort `DELETE /api/devices/:id`, but the local credential is
 * dropped either way — from the user's point of view "disconnect" always succeeds, even offline.
 */
const syncUnpair: SyncHandlers['SYNC_UNPAIR'] = async () => {
  const state = await unpair();
  await patchSettings({ syncEnabled: false });
  await armSyncAlarm();
  log.info('device unpaired; sync disabled');
  return okReply({ state });
};

/**
 * Push the slices that need no passphrase.
 *
 * Applications are pushed by delta (`listUnsyncedApplications`) and stamped with `syncedAt` only
 * for rows the server actually acknowledged, so an interrupted push resumes rather than restarts.
 * `syncedAt` is written straight to Dexie rather than through `tracker.update`, because that would
 * bump `updatedAt` and immediately mark the row unsynced again.
 */
const syncPush: SyncHandlers['SYNC_PUSH'] = async (payload) => {
  if (!(await syncReady())) {
    // INV-3: the expected steady state in v1, not a failure of anything.
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
      // No vault key on this device. Not a transport failure and not worth failing the whole push
      // for — mappings and applications still made it, and the user needs a different remedy.
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

/**
 * Pull the profile vault. Fails loudly rather than silently no-opping: the user asked for their
 * profile back, so "there is no key on this device" has to reach them as a message they can act on.
 */
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
