import { createLogger } from '@/platform/logger';
import { getSettings, getSlot, patchSettings, setSlot } from '@/platform/storage';
import { buildSyncProfileVault } from '@repo/types/ProfileTypes';
import type { Profile } from '@/shared/types';
import {
  isVersionConflict,
  pullProfileBlob,
  pushProfileBlob,
  readSyncState,
  readVaultKey,
} from '@/sync/client';
import type { SyncError, SyncResult } from '@/sync/client';
import { generateVaultKey, openProfileVault, rawKeyMaterial, sealProfileVault } from '@/sync/e2e';
import type { SyncProfileVault } from '@/sync/e2e';
import { writeVaultKey } from '@/sync/client';

const log = createLogger('sync:profile');

const MAX_CONFLICT_RETRIES = 2;

export interface ProfilePullOutcome {
  found: boolean;
  applied: number;
  version: number;
}

export interface ProfilePushOutcome {
  version: number;
  profiles: number;
  merged: boolean;
}

function noKey(): SyncError {
  return {
    code: 'crypto',
    message:
      'This device has no vault key, so the profile cannot be read or written. Reconnect from ' +
      'NextMove on the web to restore it.',
  };
}

export function mergeProfiles(
  local: readonly Profile[],
  remote: readonly Profile[],
): { merged: Profile[]; changed: number } {
  const byId = new Map<string, Profile>();
  for (const profile of local) byId.set(profile.id, profile);

  let changed = 0;
  for (const incoming of remote) {
    const existing = byId.get(incoming.id);
    if (existing === undefined) {
      byId.set(incoming.id, incoming);
      changed += 1;
      continue;
    }
    if (incoming.updatedAt > existing.updatedAt) {
      byId.set(incoming.id, incoming);
      changed += 1;
    }
  }

  const merged = [...byId.values()];
  const defaults = merged.filter((profile) => profile.isDefault);
  if (defaults.length !== 1 && merged.length > 0) {
    const winner =
      defaults.length > 1
        ? defaults.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
        : merged.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
    for (const profile of merged) profile.isDefault = profile.id === winner.id;
  }

  return { merged, changed };
}

export async function pullProfile(): Promise<SyncResult<ProfilePullOutcome>> {
  const key = await readVaultKey();
  if (key === null) return { ok: false, error: noKey() };

  const pulled = await pullProfileBlob();
  if (!pulled.ok) return { ok: false, error: pulled.error };
  if (pulled.data === null) {
    log.info('account has no profile vault yet');
    return { ok: true, data: { found: false, applied: 0, version: 0 } };
  }

  let vault: SyncProfileVault;
  try {
    vault = await openProfileVault(pulled.data, rawKeyMaterial(key));
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'crypto',
        message: `Could not open the profile vault: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    };
  }

  const local = await getSlot('profiles');
  const { merged, changed } = mergeProfiles(local, vault.profiles);
  if (changed > 0 || merged.length !== local.length) await setSlot('profiles', merged);

  const settings = await getSettings();
  if (
    settings.activeProfileId === null &&
    vault.activeProfileId !== null &&
    merged.some((profile) => profile.id === vault.activeProfileId)
  ) {
    await patchSettings({ activeProfileId: vault.activeProfileId });
  }

  log.info(`pulled profile vault v${String(pulled.data.version)} — ${String(changed)} applied`);
  return { ok: true, data: { found: true, applied: changed, version: pulled.data.version } };
}

export async function pushProfile(): Promise<SyncResult<ProfilePushOutcome>> {
  const key = await readVaultKey();
  if (key === null) return { ok: false, error: noKey() };

  const material = rawKeyMaterial(key);
  let profiles = await getSlot('profiles');
  if (profiles.length === 0) {
    const state = await readSyncState();
    return { ok: true, data: { version: state.profileVersion, profiles: 0, merged: false } };
  }

  let version = (await readSyncState()).profileVersion + 1;
  let merged = false;

  for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt += 1) {
    const settings = await getSettings();
    const vault = buildSyncProfileVault(profiles, settings.activeProfileId, Date.now());

    const envelope = await sealProfileVault(vault, material, version);
    const pushed = await pushProfileBlob(envelope);
    if (pushed.ok) {
      log.info(`pushed profile vault v${String(pushed.data.version)}`);
      return { ok: true, data: { version: pushed.data.version, profiles: profiles.length, merged } };
    }

    if (!isVersionConflict(pushed.error) || attempt === MAX_CONFLICT_RETRIES) {
      return { ok: false, error: pushed.error };
    }

    const remoteEnvelope = pushed.error.remote;
    if (remoteEnvelope === null) return { ok: false, error: pushed.error };

    let remoteVault: SyncProfileVault;
    try {
      remoteVault = await openProfileVault(remoteEnvelope, material);
    } catch {
      return {
        ok: false,
        error: {
          code: 'crypto',
          message:
            'The profile on your account was sealed with a different vault key. Reconnect this ' +
            'device from NextMove on the web to get the current key.',
        },
      };
    }

    const result = mergeProfiles(profiles, remoteVault.profiles);
    profiles = result.merged;
    await setSlot('profiles', profiles);
    version = remoteEnvelope.version + 1;
    merged = true;
    log.info(`profile push hit a conflict — merged ${String(result.changed)}, retrying at v${String(version)}`);
  }

  return {
    ok: false,
    error: {
      code: 'version-conflict',
      message:
        'Another device kept writing the profile while this one was syncing. It will retry on the ' +
        'next sync.',
    },
  };
}

export async function reconcileAfterPairing(): Promise<SyncResult<ProfilePullOutcome>> {
  const pulled = await pullProfileBlob();
  if (!pulled.ok) return { ok: false, error: pulled.error };

  const key = await readVaultKey();

  if (pulled.data === null) {
    if (key === null) {
      const minted = await writeVaultKey(generateVaultKey());
      if (!minted.ok) return { ok: false, error: minted.error };
      log.info('account had no vault — minted a key for it');
    }
    const seeded = await pushProfile();
    if (!seeded.ok) return { ok: false, error: seeded.error };
    return { ok: true, data: { found: false, applied: 0, version: seeded.data.version } };
  }

  if (key === null) return { ok: false, error: noKey() };
  return pullProfile();
}
