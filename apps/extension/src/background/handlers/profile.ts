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

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

const profileGet: ProfileHandlers['PROFILE_GET'] = async (payload) => {
  const profile = await getProfileById(payload.profileId);
  return okReply({ profile });
};

const profileList: ProfileHandlers['PROFILE_LIST'] = async () => {
  const [profiles, active] = await Promise.all([getProfiles(), getActiveProfile()]);
  return okReply({ profiles, activeProfileId: active?.id ?? null });
};

const profileSave: ProfileHandlers['PROFILE_SAVE'] = async (payload) => {
  const profile = { ...payload.profile, updatedAt: Date.now() };
  if (profile.id.trim().length === 0) {
    return errReply('BAD_REQUEST', 'A profile must have an id.');
  }

  const profiles = await upsertProfile(profile);
  const saved = profiles.find((candidate) => candidate.id === profile.id);
  if (saved === undefined) {
    return errReply('INTERNAL', 'The profile could not be written to the vault.');
  }
  void markDirty('profile');
  log.info(`profile "${saved.label}" saved`);
  return okReply({ profile: saved });
};

const profileActiveSet: ProfileHandlers['PROFILE_ACTIVE_SET'] = async (payload) => {
  const profile = await getProfileById(payload.profileId);
  if (profile === null) {
    return errReply('NOT_FOUND', 'That profile no longer exists.');
  }
  await patchSettings({ activeProfileId: profile.id });
  return okReply({ activeProfileId: profile.id });
};

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
