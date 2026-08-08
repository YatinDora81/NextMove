/**
 * sync/profile.ts — the profile vault's round trip (JF-001 Rev 3.0 SEC 7.4 / 8.3).
 *
 * This module is the answer to a question the codebase had left open: `pushProfileBlob` and
 * `pullProfileBlob` were fully implemented in `sync/client.ts` and **nothing ever called them**,
 * because sealing needed a passphrase that no UI ever collected. The profile simply did not sync.
 *
 * With the vault key now arriving from the web onboarding handoff (`sync/e2e.ts`), the missing
 * piece is the policy layer: when to seal, what to do about a 409, and how to reconcile two devices
 * that both edited the same profile. That is all this file does. It owns no crypto and no
 * transport — `@repo/vault` owns the first, `sync/client.ts` the second.
 *
 * ── Merge policy ───────────────────────────────────────────────────────────────────────────────
 *
 * Last-write-wins **per profile**, keyed on `Profile.id` and decided by `updatedAt`. Not per field:
 * a field-level merge of a half-finished work-history edit produces a Frankenstein profile that
 * matches neither device, and the user has no way to see what happened or undo it. Per profile, the
 * losing side is a whole coherent version of something the user typed, and the timestamp says which
 * one they typed last.
 *
 * A profile present on one side and absent on the other is **kept**, never deleted. Deleting a
 * profile on device A and syncing from device B would otherwise resurrect it — but the reverse,
 * treating absence as a delete, means a device that has not pulled yet can wipe the account. Of the
 * two failure modes, an extra profile the user can delete again beats data loss they cannot undo.
 */

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

/** How many times a push may re-seal against a newer remote before it gives up. */
const MAX_CONFLICT_RETRIES = 2;

export interface ProfilePullOutcome {
  /** `false` when the account simply has no vault yet — not an error. */
  found: boolean;
  /** Profiles written locally as a result of the merge. */
  applied: number;
  version: number;
}

export interface ProfilePushOutcome {
  version: number;
  profiles: number;
  /** True when a concurrent write forced a pull-merge-reseal cycle. */
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

/* ------------------------------------------------------------------------------------------------
 * Merge
 * ---------------------------------------------------------------------------------------------- */

/**
 * Union of `local` and `remote` keyed on profile id; for an id on both sides the newer `updatedAt`
 * wins outright. Ties go to `local` — a tie means the same millisecond, which in practice means the
 * same content, and preferring the copy already on disk avoids a pointless write.
 */
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

  // Exactly one profile may carry `isDefault`. A merge can easily produce two (both devices marked
  // a different one) or zero (the only default lived on the losing side), and a vault with the
  // wrong count silently changes which profile autofills.
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

/* ------------------------------------------------------------------------------------------------
 * Pull
 * ---------------------------------------------------------------------------------------------- */

/**
 * `GET /api/sync/profile` → decrypt → merge into local storage.
 *
 * The common case this exists for is a second device: you onboard on the web, install the extension
 * on your laptop, and the profile you typed is simply *there*. It is also what runs immediately
 * after a handoff, which is why `found: false` is a success — a brand-new account has no vault yet.
 */
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

  // Honour the remote's active profile only when this device has not chosen one of its own.
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

/* ------------------------------------------------------------------------------------------------
 * Push
 * ---------------------------------------------------------------------------------------------- */

/**
 * Seal the local profiles and `PUT /api/sync/profile`.
 *
 * On 409 the server hands back the envelope that beat us. We open it, merge it under the same rules
 * as a pull, re-seal at `remoteVersion + 1`, and try again — bounded, because an account being
 * hammered by a third device should surface as an error rather than spin. `sync/client.ts`
 * deliberately does not do this for us: it reports the conflict and lets policy live here.
 */
export async function pushProfile(): Promise<SyncResult<ProfilePushOutcome>> {
  const key = await readVaultKey();
  if (key === null) return { ok: false, error: noKey() };

  const material = rawKeyMaterial(key);
  let profiles = await getSlot('profiles');
  if (profiles.length === 0) {
    // Nothing to say. Pushing an empty vault over a populated one is the one way this function
    // could destroy data, so it is the one thing it refuses to do.
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
      // Someone else's vault, sealed under a different key. Merging is impossible and overwriting
      // would destroy it, so this stops here and asks a human.
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

/* ------------------------------------------------------------------------------------------------
 * First contact
 * ---------------------------------------------------------------------------------------------- */

/**
 * Run once right after pairing: pull what the account already has, and if it has nothing, seed it
 * from this device.
 *
 * `ensureVaultKey` is the subtle half. A user who onboarded on the web arrives here already holding
 * the key that page minted. A user who paired the old way — typing a code into Options — holds
 * none, and for them a fresh key is correct precisely *because* the account has no vault to lock
 * themselves out of. If the account does have one and we hold no key, that is not recoverable here
 * and the caller is told to reconnect from the web.
 */
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
