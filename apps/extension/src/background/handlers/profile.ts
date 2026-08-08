/**
 * background/handlers/profile.ts — the vault and the learned field maps.
 *
 * Implements JF-001 Rev 3.0:
 *   SEC 7.1/7.2  `jf.profiles` (sealed on disk) and `jf.settings.activeProfileId`
 *   SEC 6.6      `PROFILE_GET` · `PROFILE_LIST` · `PROFILE_SAVE` · `PROFILE_ACTIVE_SET`
 *   F-13         `FIELD_MAP_SAVE` / `FIELD_MAP_GET` — learn-from-correction, `jf.mappings`
 *
 * ── Why profile reads go over the bus at all ────────────────────────────────────────────────────
 * `jf.profiles` is stored as ciphertext (SEC 7.1 "encrypted blob, SEC 09") and opening it needs
 * WebCrypto, which is unavailable to a content script on a non-secure origin. So the content script
 * asks the service worker, which is the only context guaranteed to be able to decrypt. That is also
 * why `platform/storage.ts` is the sole writer here: this file never touches ciphertext itself.
 *
 * ── F-13, and why the mapping tier is worth 100 points ──────────────────────────────────────────
 * SEC 6.3 puts a saved user mapping at the very top of the authority chain, above adapter maps and
 * above the `autocomplete` attribute. The user correcting a field once is the strongest possible
 * signal about what that field means on that site, so `FIELD_MAP_SAVE` is what turns a wrong fill
 * into a permanently right one — for this domain, keyed by the signature hash.
 *
 * The domain key is normalised (trimmed, lower-cased) on BOTH save and get so a host that arrives
 * as `Boards.Greenhouse.io` cannot silently create a second, invisible bucket. Sub-domains are
 * deliberately preserved: `boards.greenhouse.io` and `my.greenhouse.io` are different form estates.
 */

import { createLogger } from '@/platform/logger';
import {
  getActiveProfile,
  getMappingsForDomain,
  getProfileById,
  getProfiles,
  patchSettings,
  saveMapping,
  upsertProfile,
} from '@/platform/storage';
import { markDirty } from '@/background/sync-scheduler';
import { errReply, okReply } from '@/shared/messages';
import type { MessageHandlers } from '@/shared/messages';

const log = createLogger('bg:profile');

type ProfileHandlers = Pick<
  MessageHandlers,
  'PROFILE_GET' | 'PROFILE_LIST' | 'PROFILE_SAVE' | 'PROFILE_ACTIVE_SET' | 'FIELD_MAP_GET' | 'FIELD_MAP_SAVE'
>;

/** One spelling per host, whichever surface asks. See the header note on sub-domains. */
function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

/** `profileId: null` ⇒ the active profile (settings → default → first), per SEC 6.6. */
const profileGet: ProfileHandlers['PROFILE_GET'] = async (payload) => {
  const profile = await getProfileById(payload.profileId);
  return okReply({ profile });
};

/**
 * Every profile plus the EFFECTIVE active id.
 *
 * "Effective" matters: `settings.activeProfileId` may be `null` (never chosen) or may point at a
 * profile the user has since deleted. `getActiveProfile()` resolves the same fallback chain the
 * fill engine uses — chosen → default → first — so the popup's profile switcher highlights the
 * profile that would actually be used, not a stale preference.
 */
const profileList: ProfileHandlers['PROFILE_LIST'] = async () => {
  const [profiles, active] = await Promise.all([getProfiles(), getActiveProfile()]);
  return okReply({ profiles, activeProfileId: active?.id ?? null });
};

/**
 * Insert-or-replace one profile. `updatedAt` is stamped here rather than trusted from the caller,
 * so an editor that forgot to touch it cannot make a newer vault look older than the cloud copy
 * during Phase-2 sync.
 */
const profileSave: ProfileHandlers['PROFILE_SAVE'] = async (payload) => {
  const profile = { ...payload.profile, updatedAt: Date.now() };
  if (profile.id.trim().length === 0) {
    return errReply('BAD_REQUEST', 'A profile must have an id.');
  }

  const profiles = await upsertProfile(profile);
  const saved = profiles.find((candidate) => candidate.id === profile.id);
  if (saved === undefined) {
    // `upsertProfile` always returns the array it just wrote, so this is unreachable in practice —
    // handled anyway because a sealed-slot write that silently dropped a row must never be reported
    // as a success (SEC 7.1: a broken vault has to fail loudly).
    return errReply('INTERNAL', 'The profile could not be written to the vault.');
  }
  // F-15: a local edit is worth pushing. Fire-and-forget by design — a profile save must never
  // wait on, or fail because of, the network (INV-3).
  void markDirty('profile');
  log.info(`profile "${saved.label}" saved`);
  return okReply({ profile: saved });
};

/** Switch profiles (popup switcher, Options). Refuses ids that do not exist. */
const profileActiveSet: ProfileHandlers['PROFILE_ACTIVE_SET'] = async (payload) => {
  const profile = await getProfileById(payload.profileId);
  if (profile === null) {
    return errReply('NOT_FOUND', 'That profile no longer exists.');
  }
  await patchSettings({ activeProfileId: profile.id });
  return okReply({ activeProfileId: profile.id });
};

/**
 * F-13 write. The content script calls this when the user drags a red/yellow field onto a profile
 * path in the review overlay ("map this field"). Next visit, that signature scores 100 (SEC 6.3).
 */
const fieldMapSave: ProfileHandlers['FIELD_MAP_SAVE'] = async (payload) => {
  const domain = normalizeDomain(payload.domain);
  const sigHash = payload.sigHash.trim();
  const path = payload.path.trim();

  if (domain.length === 0 || sigHash.length === 0 || path.length === 0) {
    return errReply('BAD_REQUEST', 'A mapping needs a domain, a signature hash and a profile path.');
  }

  await saveMapping(domain, sigHash, path);
  void markDirty('mappings');
  log.info(`learned a mapping on ${domain}: ${sigHash.slice(0, 8)}… → ${path}`);
  return okReply({ saved: true as const });
};

/** F-13 read — every mapping learned for one domain, fetched once per fill run. */
const fieldMapGet: ProfileHandlers['FIELD_MAP_GET'] = async (payload) => {
  const domain = normalizeDomain(payload.domain);
  if (domain.length === 0) return okReply({ mappings: {} });
  return okReply({ mappings: await getMappingsForDomain(domain) });
};

export const profileHandlers: ProfileHandlers = {
  PROFILE_GET: profileGet,
  PROFILE_LIST: profileList,
  PROFILE_SAVE: profileSave,
  PROFILE_ACTIVE_SET: profileActiveSet,
  FIELD_MAP_GET: fieldMapGet,
  FIELD_MAP_SAVE: fieldMapSave,
};
