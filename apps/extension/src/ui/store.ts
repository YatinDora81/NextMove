/**
 * ui/store.ts — the Zustand stores behind the popup and the Options app (SEC 03, SEC 4.2).
 *
 * Every store is a thin, typed shell over the MessageBus. The UI holds no business logic: it asks
 * the service worker for state and asks the service worker to change state. That is what SEC 4.2
 * means by "Options app must never run page-fill logic" — the Options page cannot fill a form even
 * if it wanted to, because it has no code that can.
 *
 * Three deliberate exceptions to "everything over the bus", each because the protocol in
 * `shared/messages.ts` has no message for it and inventing one would break the contract:
 *
 *   - `jf.settings` — read/written through the typed storage layer. `chrome.storage.local` is
 *     shared across extension contexts and the service worker re-reads it on every use.
 *   - `jf.mappings` (F-13 editor) — `FIELD_MAP_GET` answers for one domain at a time and there is
 *     no "list every domain" message, so the editor reads the slot directly.
 *   - profile *deletion* (F-11) — there is no `PROFILE_DELETE` message; `deleteProfile()` in the
 *     storage layer is the sanctioned path and keeps the active-profile pointer consistent.
 *
 * Everything else — profiles, keys, tracker, answers, sync, fill — goes over the bus.
 *
 * INV-2: no store mints or caches a gesture nonce. Panels mint one inside the click handler via
 * `ui/gesture.ts` and pass it straight to the send.
 */

import { create } from 'zustand';

import { sendMessage, sendToTab } from '@/platform/bus';
import { randomId } from '@/platform/crypto';
import {
  deleteMapping as deleteMappingSlot,
  deleteProfile as deleteProfileSlot,
  getMappings,
  getSettings,
  patchSettings,
  saveMapping,
  setMappings,
} from '@/platform/storage';
import { createEmptyProfile } from '@/shared/schema';
import type { BusErrorCode, MessageType, PayloadOf, ReplyDataOf } from '@/shared/messages';
import type {
  AnswerRecord,
  AnswerScope,
  AnswerSource,
  ApplicationPatch,
  ApplicationRow,
  AppStatus,
  AtsId,
  FillReport,
  FillTrigger,
  GeminiKeyPublic,
  MappingStore,
  ModelId,
  PoolSnapshot,
  Profile,
  ProfilePath,
  Settings,
  SyncScope,
  SyncState,
  TrackerQuery,
  TrackerStats,
} from '@/shared/types';

/* ------------------------------------------------------------------------------------------------
 * Bus plumbing
 * ---------------------------------------------------------------------------------------------- */

/** A `{ ok: false, error }` reply, re-thrown so stores can use one try/catch. */
export class BusFailure extends Error {
  readonly code: BusErrorCode;
  /** epoch ms — set by ALL_KEYS_BUSY / QUOTA_EXHAUSTED so the UI can render a countdown. */
  readonly retryAt: number | null;

  constructor(code: BusErrorCode, message: string, retryAt: number | null) {
    super(message);
    this.name = 'BusFailure';
    this.code = code;
    this.retryAt = retryAt;
    Object.setPrototypeOf(this, BusFailure.prototype);
  }
}

/** Send and unwrap. Throws `BusFailure` on a protocol-level error so callers never test `ok`. */
export async function call<T extends MessageType>(
  type: T,
  payload: PayloadOf<T>,
  gesture?: string,
): Promise<ReplyDataOf<T>> {
  const reply = await sendMessage(type, payload, gesture);
  if (!reply.ok) {
    throw new BusFailure(reply.error.code, reply.error.message, reply.error.retryAt ?? null);
  }
  return reply.data;
}

export function describeError(error: unknown): string {
  if (error instanceof BusFailure) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** `retryAt` when the failure carries one — drives the SEC 5.6 countdown copy. */
export function retryAtOf(error: unknown): number | null {
  return error instanceof BusFailure ? error.retryAt : null;
}

/* ------------------------------------------------------------------------------------------------
 * Profiles (F-01 / F-11)
 * ---------------------------------------------------------------------------------------------- */

interface ProfilesState {
  profiles: Profile[];
  activeProfileId: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  /** Id currently open in the vault editor; not necessarily the active-for-fill profile. */
  editingId: string | null;

  load: () => Promise<void>;
  setEditing: (profileId: string | null) => void;
  save: (profile: Profile) => Promise<Profile | null>;
  setActive: (profileId: string) => Promise<void>;
  create: (label: string, base?: Profile | null) => Promise<Profile | null>;
  remove: (profileId: string) => Promise<void>;
}

/** Base identity is shared across profiles (F-11); only summary/skills/resume diverge. */
function deriveProfile(base: Profile, id: string, label: string, now: number): Profile {
  return {
    ...base,
    id,
    label,
    isDefault: false,
    // Personal identity, links, education, authorization, EEO and compensation are the "base
    // identity" F-11 talks about — copied wholesale. Summary and skills are the override surface.
    personal: {
      ...base.personal,
      address: { ...base.personal.address },
    },
    links: { ...base.links, other: [...base.links.other] },
    work: base.work.map((entry) => ({ ...entry, bullets: [...entry.bullets] })),
    education: base.education.map((entry) => ({ ...entry })),
    skills: [...base.skills],
    authorization: {
      ...base.authorization,
      authorizedIn: [...base.authorization.authorizedIn],
      needsSponsorship: { ...base.authorization.needsSponsorship },
    },
    eeo: { ...base.eeo },
    compensation: {
      expected: { ...base.compensation.expected },
      noticePeriodDays: base.compensation.noticePeriodDays,
    },
    answers: base.answers.map((answer) => ({ ...answer })),
    updatedAt: now,
  };
}

export const useProfilesStore = create<ProfilesState>((set, get) => ({
  profiles: [],
  activeProfileId: null,
  loading: false,
  saving: false,
  error: null,
  editingId: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = await call('PROFILE_LIST', {});
      const editingId = get().editingId;
      const stillExists = data.profiles.some((profile) => profile.id === editingId);
      set({
        profiles: data.profiles,
        activeProfileId: data.activeProfileId,
        editingId: stillExists ? editingId : (data.activeProfileId ?? data.profiles[0]?.id ?? null),
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: describeError(error) });
    }
  },

  setEditing: (profileId) => set({ editingId: profileId }),

  save: async (profile) => {
    set({ saving: true, error: null });
    try {
      const data = await call('PROFILE_SAVE', { profile });
      set((state) => ({
        saving: false,
        profiles: state.profiles.some((p) => p.id === data.profile.id)
          ? state.profiles.map((p) => (p.id === data.profile.id ? data.profile : p))
          : [...state.profiles, data.profile],
      }));
      return data.profile;
    } catch (error) {
      set({ saving: false, error: describeError(error) });
      return null;
    }
  },

  setActive: async (profileId) => {
    const previous = get().activeProfileId;
    set({ activeProfileId: profileId, error: null }); // optimistic — the switcher must feel instant
    try {
      const data = await call('PROFILE_ACTIVE_SET', { profileId });
      set({ activeProfileId: data.activeProfileId });
    } catch (error) {
      set({ activeProfileId: previous, error: describeError(error) });
    }
  },

  create: async (label, base = null) => {
    const now = Date.now();
    const id = randomId('prof');
    const profile =
      base === null ? createEmptyProfile(id, label, now) : deriveProfile(base, id, label, now);
    const saved = await get().save(profile);
    if (saved !== null) set({ editingId: saved.id });
    return saved;
  },

  remove: async (profileId) => {
    try {
      // No PROFILE_DELETE exists in the SEC 6.6 protocol; the storage layer owns the invariant
      // that a deleted profile can never stay the active one.
      const profiles = await deleteProfileSlot(profileId);
      set((state) => ({
        profiles,
        editingId: state.editingId === profileId ? (profiles[0]?.id ?? null) : state.editingId,
      }));
      await get().load();
    } catch (error) {
      set({ error: describeError(error) });
    }
  },
}));

/** The profile currently open in the editor, or the active one. `null` before the first load. */
export function selectEditingProfile(state: ProfilesState): Profile | null {
  const id = state.editingId ?? state.activeProfileId;
  if (id === null) return state.profiles[0] ?? null;
  return state.profiles.find((profile) => profile.id === id) ?? state.profiles[0] ?? null;
}

export function selectActiveProfile(state: ProfilesState): Profile | null {
  const id = state.activeProfileId;
  if (id === null) return state.profiles.find((p) => p.isDefault) ?? state.profiles[0] ?? null;
  return state.profiles.find((profile) => profile.id === id) ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * AI keys (F-08 / SEC 5.3)
 * ---------------------------------------------------------------------------------------------- */

export interface KeyPoolCounts {
  total: number;
  ACTIVE: number;
  COOLDOWN: number;
  EXHAUSTED: number;
  DEAD: number;
}

interface KeysState {
  keys: GeminiKeyPublic[];
  pool: PoolSnapshot[];
  model: ModelId | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** Result of the last add/test, keyed by key id — shows Google's own words verbatim. */
  lastTest: { id: string; ok: boolean; message: string } | null;

  load: () => Promise<void>;
  add: (key: string, label: string, gesture: string) => Promise<GeminiKeyPublic | null>;
  test: (id: string, gesture: string) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
}

export const useKeysStore = create<KeysState>((set, get) => ({
  keys: [],
  pool: [],
  model: null,
  loading: false,
  busy: false,
  error: null,
  lastTest: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = await call('KEYS_STATUS', {});
      set({ keys: data.keys, pool: data.pool, model: data.model, loading: false });
    } catch (error) {
      set({ loading: false, error: describeError(error) });
    }
  },

  // The gesture is minted by the panel inside the click handler. KEYS_ADD spends a live
  // validation call against Google (SEC 5.3), so it is carried even though the bus only *enforces*
  // a nonce for the GESTURE_REQUIRED set — INV-2 is about intent, not just enforcement.
  add: async (key, label, gesture) => {
    set({ busy: true, error: null, lastTest: null });
    try {
      const data = await call('KEYS_ADD', { key, label }, gesture);
      set((state) => ({
        busy: false,
        keys: [...state.keys, data.record],
        pool: data.pool,
        lastTest: { id: data.record.id, ok: true, message: 'Validated with Google.' },
      }));
      await get().load();
      return data.record;
    } catch (error) {
      set({ busy: false, error: describeError(error) });
      return null;
    }
  },

  test: async (id, gesture) => {
    set({ busy: true, error: null });
    try {
      const data = await call('KEYS_TEST', { id }, gesture);
      set((state) => ({
        busy: false,
        lastTest: { id: data.id, ok: data.ok, message: data.message },
        keys: state.keys.map((record) =>
          record.id === data.id ? { ...record, status: data.status } : record,
        ),
      }));
      await get().load();
      return data.ok;
    } catch (error) {
      set({ busy: false, error: describeError(error) });
      return false;
    }
  },

  remove: async (id) => {
    set({ busy: true, error: null });
    try {
      await call('KEYS_DELETE', { id });
      set((state) => ({
        busy: false,
        keys: state.keys.filter((record) => record.id !== id),
        pool: state.pool.filter((snapshot) => snapshot.keyId !== id),
        lastTest: state.lastTest?.id === id ? null : state.lastTest,
      }));
    } catch (error) {
      set({ busy: false, error: describeError(error) });
    }
  },
}));

export function countPool(keys: readonly GeminiKeyPublic[]): KeyPoolCounts {
  const counts: KeyPoolCounts = {
    total: keys.length,
    ACTIVE: 0,
    COOLDOWN: 0,
    EXHAUSTED: 0,
    DEAD: 0,
  };
  for (const key of keys) counts[key.status] += 1;
  return counts;
}

/**
 * Earliest moment the pool can serve again, or `null` when something is usable right now.
 * `Infinity` (every key DEAD) also returns `null` — a countdown to never is worse than no
 * countdown, and the DEAD badge already tells that story (SEC 5.6).
 */
export function poolRetryAt(keys: readonly GeminiKeyPublic[]): number | null {
  if (keys.length === 0) return null;
  let earliest = Number.POSITIVE_INFINITY;
  for (const key of keys) {
    if (key.status === 'DEAD') continue;
    if (key.retryAt === null) return null;
    earliest = Math.min(earliest, key.retryAt);
  }
  return Number.isFinite(earliest) ? earliest : null;
}

/**
 * The one thing the popup and the key manager both need to say out loud (SEC 5.6).
 *
 * Order matters and is not obvious: an EXHAUSTED key also carries a `retryAt` (its Pacific-midnight
 * reset), so a pool that is entirely out of daily quota looks identical to a rate-limited one if
 * you only test `retryAt`. "Cooling" therefore requires an actual COOLDOWN key, and the daily-quota
 * case is checked first.
 */
export type PoolCondition = 'none' | 'healthy' | 'cooling' | 'exhausted' | 'dead';

export function poolCondition(keys: readonly GeminiKeyPublic[]): PoolCondition {
  const counts = countPool(keys);
  if (counts.total === 0) return 'none';
  if (counts.ACTIVE > 0) return 'healthy';
  if (counts.COOLDOWN > 0) return 'cooling';
  if (counts.EXHAUSTED > 0) return 'exhausted';
  return 'dead';
}

/* ------------------------------------------------------------------------------------------------
 * Settings (SEC 7.1 `jf.settings`)
 * ---------------------------------------------------------------------------------------------- */

interface SettingsState {
  settings: Settings | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  patch: (patch: Partial<Settings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      set({ settings: await getSettings(), loading: false });
    } catch (error) {
      set({ loading: false, error: describeError(error) });
    }
  },

  patch: async (patch) => {
    try {
      set({ settings: await patchSettings(patch), error: null });
    } catch (error) {
      set({ error: describeError(error) });
    }
  },
}));

/* ------------------------------------------------------------------------------------------------
 * Tracker (F-12 / SEC 6.7)
 * ---------------------------------------------------------------------------------------------- */

export type TrackerSortField = 'date' | 'company' | 'role' | 'status' | 'ats' | 'fillScore';

export interface TrackerFilters {
  status: AppStatus | null;
  ats: AtsId | null;
  profileId: string | null;
  search: string;
  from: number | null;
  to: number | null;
}

export const EMPTY_TRACKER_FILTERS: TrackerFilters = {
  status: null,
  ats: null,
  profileId: null,
  search: '',
  from: null,
  to: null,
};

interface TrackerState {
  rows: ApplicationRow[];
  total: number;
  stats: TrackerStats | null;
  filters: TrackerFilters;
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  setFilters: (patch: Partial<TrackerFilters>) => Promise<void>;
  resetFilters: () => Promise<void>;
  update: (id: string, patch: ApplicationPatch) => Promise<ApplicationRow | null>;
  setStatus: (id: string, status: AppStatus) => Promise<void>;
}

function toQuery(filters: TrackerFilters): TrackerQuery {
  const query: TrackerQuery = {};
  if (filters.status !== null) query.status = filters.status;
  if (filters.ats !== null) query.ats = filters.ats;
  if (filters.profileId !== null) query.profileId = filters.profileId;
  if (filters.from !== null) query.from = filters.from;
  if (filters.to !== null) query.to = filters.to;
  const search = filters.search.trim();
  if (search !== '') query.search = search;
  return query;
}

export const useTrackerStore = create<TrackerState>((set, get) => ({
  rows: [],
  total: 0,
  stats: null,
  filters: { ...EMPTY_TRACKER_FILTERS },
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = await call('TRACKER_QUERY', toQuery(get().filters));
      set({ rows: data.rows, total: data.total, stats: data.stats, loading: false });
    } catch (error) {
      set({ loading: false, error: describeError(error) });
    }
  },

  setFilters: async (patch) => {
    set((state) => ({ filters: { ...state.filters, ...patch } }));
    await get().load();
  },

  resetFilters: async () => {
    set({ filters: { ...EMPTY_TRACKER_FILTERS } });
    await get().load();
  },

  update: async (id, patch) => {
    try {
      const data = await call('TRACKER_UPDATE', { id, patch });
      set((state) => ({
        rows: state.rows.map((row) => (row.id === id ? data.row : row)),
        error: null,
      }));
      return data.row;
    } catch (error) {
      set({ error: describeError(error) });
      return null;
    }
  },

  // Kanban drag and the row action share one path so `history[]` is appended exactly once
  // (the tracker service owns the transition — the UI never writes history itself).
  setStatus: async (id, status) => {
    const updated = await get().update(id, { status });
    if (updated !== null) await get().load();
  },
}));

/** SEC 6.7 board lanes, in the order the design doc lists them. */
export const BOARD_LANES: readonly AppStatus[] = [
  'draft',
  'applied',
  'interview',
  'offer',
  'rejected',
  'ghosted',
];

export const STATUS_LABEL: Record<AppStatus, string> = {
  draft: 'Draft',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  ghosted: 'Ghosted',
};

/* ------------------------------------------------------------------------------------------------
 * Answer Bank (F-17 / SEC 5.7)
 * ---------------------------------------------------------------------------------------------- */

/**
 * "Pin favourites" (SEC 5.7 management UI) is a presentation preference, not part of the
 * `AnswerRecord` contract in `shared/types.ts` — and the SEC 7.1 storage map forbids inventing a
 * seventh `chrome.storage.local` key. Pins therefore live in the Options page's own `localStorage`,
 * which is per-extension-origin, local, and outside the synced/exported data set by construction.
 */
const PIN_STORAGE_KEY = 'jf.ui.pinnedAnswers';

function readPins(): Set<string> {
  try {
    const raw = localStorage.getItem(PIN_STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return new Set();
  }
}

function writePins(pins: ReadonlySet<string>): void {
  try {
    localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify([...pins]));
  } catch {
    // A full or disabled localStorage costs the user their pin order, nothing more.
  }
}

interface AnswersState {
  records: AnswerRecord[];
  total: number;
  search: string;
  profileId: string | null;
  pinned: Set<string>;
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  setSearch: (search: string) => Promise<void>;
  setProfileFilter: (profileId: string | null) => Promise<void>;
  save: (input: {
    qRaw: string;
    answer: string;
    source: AnswerSource;
    profileId: string | null;
    scope?: AnswerScope;
  }) => Promise<AnswerRecord | null>;
  remove: (id: string) => Promise<void>;
  togglePin: (id: string) => void;
}

export const useAnswersStore = create<AnswersState>((set, get) => ({
  records: [],
  total: 0,
  search: '',
  profileId: null,
  pinned: readPins(),
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const { search, profileId } = get();
      const payload: PayloadOf<'ANSWERS_LIST'> = {};
      if (search.trim() !== '') payload.search = search.trim();
      if (profileId !== null) payload.profileId = profileId;
      const data = await call('ANSWERS_LIST', payload);
      set({ records: data.records, total: data.total, loading: false });
    } catch (error) {
      set({ loading: false, error: describeError(error) });
    }
  },

  setSearch: async (search) => {
    set({ search });
    await get().load();
  },

  setProfileFilter: async (profileId) => {
    set({ profileId });
    await get().load();
  },

  save: async ({ qRaw, answer, source, profileId, scope }) => {
    try {
      const payload: PayloadOf<'ANSWERS_SAVE'> = {
        qRaw,
        answer,
        source,
        profileId,
        // The editor never knows which employer the answer was written for, and guessing would
        // risk baking the wrong company into a reusable answer (SEC 5.7).
        company: null,
      };
      if (scope !== undefined) payload.scope = scope;
      const data = await call('ANSWERS_SAVE', payload);
      await get().load();
      return data.record;
    } catch (error) {
      set({ error: describeError(error) });
      return null;
    }
  },

  remove: async (id) => {
    try {
      await call('ANSWERS_DELETE', { id });
      set((state) => {
        const pinned = new Set(state.pinned);
        pinned.delete(id);
        writePins(pinned);
        return { records: state.records.filter((record) => record.id !== id), pinned };
      });
    } catch (error) {
      set({ error: describeError(error) });
    }
  },

  togglePin: (id) => {
    set((state) => {
      const pinned = new Set(state.pinned);
      if (pinned.has(id)) pinned.delete(id);
      else pinned.add(id);
      writePins(pinned);
      return { pinned };
    });
  },
}));

/** Pinned answers float to the top; the rest keep the service's most-recently-used order. */
export function orderAnswers(
  records: readonly AnswerRecord[],
  pinned: ReadonlySet<string>,
): AnswerRecord[] {
  return [...records].sort((a, b) => {
    const pa = pinned.has(a.id) ? 0 : 1;
    const pb = pinned.has(b.id) ? 0 : 1;
    return pa - pb;
  });
}

/* ------------------------------------------------------------------------------------------------
 * Learned mappings (F-13)
 * ---------------------------------------------------------------------------------------------- */

export interface MappingRow {
  domain: string;
  sigHash: string;
  path: ProfilePath;
}

interface MappingsState {
  mappings: MappingStore;
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  edit: (domain: string, sigHash: string, path: ProfilePath) => Promise<void>;
  remove: (domain: string, sigHash: string) => Promise<void>;
  replaceAll: (mappings: MappingStore) => Promise<void>;
}

export const useMappingsStore = create<MappingsState>((set, get) => ({
  mappings: {},
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      set({ mappings: await getMappings(), loading: false });
    } catch (error) {
      set({ loading: false, error: describeError(error) });
    }
  },

  edit: async (domain, sigHash, path) => {
    try {
      await saveMapping(domain, sigHash, path);
      await get().load();
    } catch (error) {
      set({ error: describeError(error) });
    }
  },

  remove: async (domain, sigHash) => {
    try {
      await deleteMappingSlot(domain, sigHash);
      await get().load();
    } catch (error) {
      set({ error: describeError(error) });
    }
  },

  replaceAll: async (mappings) => {
    try {
      await setMappings(mappings);
      set({ mappings, error: null });
    } catch (error) {
      set({ error: describeError(error) });
    }
  },
}));

/** Flatten `{domain: {hash: path}}` into sortable rows for the editor table. */
export function flattenMappings(store: MappingStore): MappingRow[] {
  const rows: MappingRow[] = [];
  for (const [domain, byHash] of Object.entries(store)) {
    for (const [sigHash, path] of Object.entries(byHash)) {
      rows.push({ domain, sigHash, path });
    }
  }
  rows.sort((a, b) => a.domain.localeCompare(b.domain) || a.path.localeCompare(b.path));
  return rows;
}

/* ------------------------------------------------------------------------------------------------
 * Sync (F-15 / SEC 8.2) — everything here degrades to "not connected" (INV-3)
 * ---------------------------------------------------------------------------------------------- */

interface SyncStoreState {
  state: SyncState | null;
  busy: boolean;
  error: string | null;
  lastPush: { profile: boolean; mappings: number; applications: number } | null;
  /**
   * Outcome of the last SYNC_PULL. `found: false` is a *success* — it means the account simply has
   * no vault yet — so the panel needs the shape, not just a boolean, to say the right thing.
   */
  lastPull: { found: boolean; applied: number } | null;

  load: () => Promise<void>;
  pair: (code: string, deviceName: string) => Promise<boolean>;
  unpair: () => Promise<void>;
  push: (scopes: SyncScope[]) => Promise<boolean>;
  pull: () => Promise<boolean>;
}

export const useSyncStore = create<SyncStoreState>((set) => ({
  state: null,
  busy: false,
  error: null,
  lastPush: null,
  lastPull: null,

  load: async () => {
    set({ busy: true, error: null });
    try {
      const data = await call('SYNC_STATUS', {});
      set({ state: data.state, busy: false });
    } catch (error) {
      // INV-3: a sync subsystem that cannot answer is "not connected", never a broken page.
      set({ busy: false, state: null, error: describeError(error) });
    }
  },

  pair: async (code, deviceName) => {
    set({ busy: true, error: null });
    try {
      const data = await call('SYNC_PAIR', { code: code.trim().toUpperCase(), deviceName });
      set({ state: data.state, busy: false });
      return data.state.paired;
    } catch (error) {
      set({ busy: false, error: describeError(error) });
      return false;
    }
  },

  unpair: async () => {
    set({ busy: true, error: null });
    try {
      const data = await call('SYNC_UNPAIR', {});
      set({ state: data.state, busy: false, lastPush: null, lastPull: null });
    } catch (error) {
      set({ busy: false, error: describeError(error) });
    }
  },

  push: async (scopes) => {
    set({ busy: true, error: null });
    try {
      const data = await call('SYNC_PUSH', { scopes });
      set({ state: data.state, busy: false, lastPush: data.pushed });
      return true;
    } catch (error) {
      set({ busy: false, error: describeError(error) });
      return false;
    }
  },

  // Same shape as `push`, deliberately: the two are one mental model for the panel. The asymmetry
  // lives in the handler (a pull rewrites what the extension autofills with), not here.
  pull: async () => {
    set({ busy: true, error: null });
    try {
      const data = await call('SYNC_PULL', {});
      set({ state: data.state, busy: false, lastPull: data.pulled });
      return true;
    } catch (error) {
      set({ busy: false, error: describeError(error) });
      return false;
    }
  },
}));

/* ------------------------------------------------------------------------------------------------
 * Fill (SEC 4.3 Flow A) — the popup's one job
 * ---------------------------------------------------------------------------------------------- */

export interface FillOutcome {
  report: FillReport | null;
  error: string | null;
  /** `true` when no content script answered — usually a chrome:// page or the Web Store. */
  unreachable: boolean;
}

/**
 * Ask the active tab's content script to fill the form it is looking at.
 *
 * INV-1 lives on the other side of this call: the content script locates and highlights, and the
 * human presses Submit. Nothing in the popup can click anything on the page.
 *
 * `tabs.query` needs no `tabs` permission for the fields used here (id only) — SEC 9.2 least
 * privilege means the manifest never asks for one.
 */
export async function fillActiveTab(
  profileId: string | null,
  trigger: FillTrigger = 'popup',
): Promise<FillOutcome> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (typeof tabId !== 'number') {
    return { report: null, error: 'No active tab to fill.', unreachable: true };
  }

  const reply = await sendToTab(tabId, 'FILL_REQUEST', { profileId, trigger });
  if (reply.ok) return { report: reply.data, error: null, unreachable: false };

  // A transport failure here means the content script is not present in that tab.
  const unreachable = reply.error.code === 'INTERNAL' || reply.error.code === 'TIMEOUT';
  return { report: null, error: reply.error.message, unreachable };
}

/** Open the Options page from the popup. */
export function openOptions(): void {
  void browser.runtime.openOptionsPage();
}

/** Open the Options page focused on one section (`#tracker`, `#keys`, …). */
export function openOptionsAt(section: string): void {
  void browser.tabs.create({ url: browser.runtime.getURL(`/options.html#${section}`) });
}
