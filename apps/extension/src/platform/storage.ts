/**
 * platform/storage.ts — the typed front door to `chrome.storage.local` (JF-001 Rev 3.0 SEC 7.1).
 *
 * The storage map is closed: exactly six top-level slots, named by the `jf.*` constants in
 * `shared/constants.ts`. Nothing else may be written at the top level (the vault material at
 * `jf.vault.secret` is owned by `platform/crypto.ts` and is not a data slot).
 *
 *   jf.meta      MetaRecord          drives migrations
 *   jf.profiles  Profile[]           SEALED — SEC 7.1 "(encrypted blob, SEC 09)"
 *   jf.settings  Settings            UX prefs, thresholds, model prefs, feature flags
 *   jf.keys      GeminiKeyRecord[]   ciphertext + rotation ledgers (INV-5)
 *   jf.mappings  MappingStore        { [domain]: { [sigHash]: ProfilePath } }
 *   jf.sync      SyncState           Phase-2 pairing state; the device JWT is sealed
 *
 * Encryption boundary. `jf.profiles` never touches disk in plaintext: `setProfiles` seals the
 * whole array through `platform/crypto.ts` and `getProfiles` opens it again. `jf.keys` rows are
 * sealed field-wise by the AI vault (`ct`/`iv` per record); this module refuses to persist a row
 * whose `ct` still looks like a live `AIza…` key, so a bug upstream fails loudly instead of
 * writing a plaintext credential to disk (INV-5).
 *
 * Reads never return `undefined`. A missing, malformed, or unopenable slot yields the documented
 * default and logs — a corrupt settings blob must not brick the extension (INV-3: local-first
 * means the local path has to be the reliable one).
 *
 * Context note: sealing needs WebCrypto, which is unavailable to a content script running on a
 * non-secure origin. Content scripts should ask the service worker for profile data over the bus
 * (`PROFILE_GET`) rather than reading `jf.profiles` directly.
 */

import type { WxtBrowser } from 'wxt/browser';
import { z } from 'zod';

import {
  DEFAULT_SETTINGS,
  DEFAULT_SYNC_STATE,
  SCHEMA_VERSION,
  STORAGE_KEYS,
  type StorageKey,
  type StorageKeyName,
} from '@/shared/constants';
import {
  geminiKeyRecordListSchema,
  mappingStoreSchema,
  metaRecordSchema,
  profileListSchema,
  settingsSchema,
  syncStateSchema,
} from '@/shared/schema';
import type {
  GeminiKeyRecord,
  MappingStore,
  MetaRecord,
  Profile,
  Settings,
  SyncState,
} from '@/shared/types';
import {
  decryptString,
  destroyVaultMaterial,
  encryptString,
  randomUuid,
  type Sealed,
} from '@/platform/crypto';
import { createLogger } from '@/platform/logger';

const log = createLogger('storage');

/**
 * Late-bound extension API handle. WXT auto-imports `browser`, but resolving it off `globalThis`
 * at call time keeps this module usable in a plain vitest run where a fake browser is installed
 * on the global object before the first storage call.
 */
function ext(): WxtBrowser {
  const g = globalThis as unknown as { browser?: WxtBrowser; chrome?: WxtBrowser };
  const api = g.browser ?? g.chrome;
  if (!api) throw new Error('extension storage APIs are unavailable in this context');
  return api;
}

/* ------------------------------------------------------------------------------------------------
 * The slot map
 * ---------------------------------------------------------------------------------------------- */

/** The complete, typed `chrome.storage.local` surface (SEC 7.1). */
export interface StorageShape {
  meta: MetaRecord;
  profiles: Profile[];
  settings: Settings;
  keys: GeminiKeyRecord[];
  mappings: MappingStore;
  sync: SyncState;
}

export type StorageSlot = StorageKeyName & keyof StorageShape;

const SLOTS: readonly StorageSlot[] = ['meta', 'profiles', 'settings', 'keys', 'mappings', 'sync'];

/** `jf.profiles` → `profiles`, used by the change feed. */
const SLOT_BY_STORAGE_KEY: ReadonlyMap<string, StorageSlot> = new Map(
  SLOTS.map((slot) => [STORAGE_KEYS[slot], slot] as const),
);

function storageKeyOf(slot: StorageSlot): StorageKey {
  return STORAGE_KEYS[slot];
}

/* ------------------------------------------------------------------------------------------------
 * Defaults — every read resolves to one of these rather than to `undefined`
 * ---------------------------------------------------------------------------------------------- */

function defaultMeta(): MetaRecord {
  return { schemaVersion: SCHEMA_VERSION, installId: '', createdAt: 0, lastMigratedAt: null };
}

function defaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS, modelFallbackChain: [...DEFAULT_SETTINGS.modelFallbackChain] };
}

function defaultSync(): SyncState {
  return { ...DEFAULT_SYNC_STATE };
}

/** The value a slot reads back as when it has never been written (or cannot be read). */
export function defaultFor<K extends StorageSlot>(slot: K): StorageShape[K] {
  switch (slot) {
    case 'meta':
      return defaultMeta() as StorageShape[K];
    case 'profiles':
      return [] as unknown as StorageShape[K];
    case 'settings':
      return defaultSettings() as StorageShape[K];
    case 'keys':
      return [] as unknown as StorageShape[K];
    case 'mappings':
      return {} as StorageShape[K];
    case 'sync':
      return defaultSync() as StorageShape[K];
    default:
      throw new Error(`unknown storage slot: ${String(slot)}`);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Sealed-slot envelope (SEC 7.1 — `jf.profiles` is stored as ciphertext)
 * ---------------------------------------------------------------------------------------------- */

interface SealedSlot extends Sealed {
  __jf: 'sealed';
  v: number;
}

const sealedSlotSchema = z.object({
  __jf: z.literal('sealed'),
  v: z.number().int().positive(),
  ct: z.string().min(1),
  iv: z.string().min(1),
});

const SEALED_SLOT_VERSION = 1;

/** Slots whose on-disk representation is a `SealedSlot`, not the value itself. */
const SEALED_SLOTS: ReadonlySet<StorageSlot> = new Set<StorageSlot>(['profiles']);

export function isSlotSealed(slot: StorageSlot): boolean {
  return SEALED_SLOTS.has(slot);
}

/**
 * Last vault failure seen while decoding a sealed slot, or null. The options UI surfaces this so
 * a user whose vault material was wiped is told *why* their profiles look empty, rather than
 * silently starting over on top of unreadable ciphertext.
 */
let lastVaultError: string | null = null;

export function getVaultError(): string | null {
  return lastVaultError;
}

export function clearVaultError(): void {
  lastVaultError = null;
}

/* ------------------------------------------------------------------------------------------------
 * INV-5 guard — `jf.keys` may only ever hold ciphertext
 * ---------------------------------------------------------------------------------------------- */

/** Non-global on purpose: `RegExp.test` with /g carries `lastIndex` state between calls. */
const LOOKS_LIKE_PLAINTEXT_KEY = /AIza[0-9A-Za-z_-]{10,}/;

/**
 * INV-5: a `GeminiKeyRecord.ct` that still matches the live-key shape means something bypassed
 * `platform/crypto.ts`. Refuse the write — a thrown error is infinitely cheaper than a plaintext
 * Google API key sitting in `chrome.storage.local`.
 */
function assertKeysSealed(records: readonly GeminiKeyRecord[]): void {
  for (const record of records) {
    if (LOOKS_LIKE_PLAINTEXT_KEY.test(record.ct)) {
      throw new Error(
        `INV-5 violation: key record ${record.id} carries an unsealed API key in \`ct\`. ` +
          'Seal it with platform/crypto.encryptString() before persisting.',
      );
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Raw browser.storage.local access
 * ---------------------------------------------------------------------------------------------- */

async function readRaw(key: string): Promise<unknown> {
  const bag = await ext().storage.local.get(key);
  return (bag as Record<string, unknown>)[key];
}

async function writeRaw(key: string, value: unknown): Promise<void> {
  await ext().storage.local.set({ [key]: value });
}

/* ------------------------------------------------------------------------------------------------
 * Per-slot decode / encode
 * ---------------------------------------------------------------------------------------------- */

function decodeMeta(raw: unknown): MetaRecord {
  if (raw === undefined || raw === null) return defaultMeta();
  const parsed = metaRecordSchema.safeParse(raw);
  if (!parsed.success) {
    log.warn('jf.meta failed validation — falling back to defaults', parsed.error.issues);
    return defaultMeta();
  }
  return parsed.data;
}

function decodeSettings(raw: unknown): Settings {
  // settingsSchema is fully defaulted, so a partial object heals into a complete Settings.
  const parsed = settingsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    log.warn('jf.settings failed validation — falling back to defaults', parsed.error.issues);
    return defaultSettings();
  }
  return parsed.data;
}

function decodeSync(raw: unknown): SyncState {
  const parsed = syncStateSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    log.warn('jf.sync failed validation — falling back to defaults', parsed.error.issues);
    return defaultSync();
  }
  return parsed.data;
}

function decodeMappings(raw: unknown): MappingStore {
  if (raw === undefined || raw === null) return {};
  const parsed = mappingStoreSchema.safeParse(raw);
  if (!parsed.success) {
    log.warn('jf.mappings failed validation — falling back to an empty map', parsed.error.issues);
    return {};
  }
  return parsed.data;
}

function decodeKeys(raw: unknown): GeminiKeyRecord[] {
  if (raw === undefined || raw === null) return [];
  const parsed = geminiKeyRecordListSchema.safeParse(raw);
  if (!parsed.success) {
    log.error('jf.keys failed validation — treating the pool as empty', parsed.error.issues);
    return [];
  }
  return parsed.data;
}

async function decodeProfiles(raw: unknown): Promise<Profile[]> {
  if (raw === undefined || raw === null) return [];

  const sealed = sealedSlotSchema.safeParse(raw);
  if (sealed.success) {
    try {
      const json = await decryptString({ ct: sealed.data.ct, iv: sealed.data.iv });
      const parsed = profileListSchema.safeParse(JSON.parse(json) as unknown);
      if (!parsed.success) {
        log.error('jf.profiles decrypted but failed validation', parsed.error.issues);
        lastVaultError = 'Profile data decrypted but did not match the vault schema.';
        return [];
      }
      lastVaultError = null;
      return parsed.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('jf.profiles could not be opened', message);
      lastVaultError = message;
      return [];
    }
  }

  // Tolerate a plaintext array: an install that predates sealing, or a restored JSON backup.
  // It is re-sealed on the next write (and by the schemaVersion-1 migration).
  const plain = profileListSchema.safeParse(raw);
  if (plain.success) {
    log.warn('jf.profiles found unsealed — it will be sealed on the next write');
    return plain.data;
  }

  log.error('jf.profiles is neither a sealed envelope nor a valid profile list', plain.error.issues);
  return [];
}

async function encodeProfiles(profiles: Profile[]): Promise<SealedSlot> {
  const validated = profileListSchema.parse(profiles);
  const sealed = await encryptString(JSON.stringify(validated));
  lastVaultError = null;
  return { __jf: 'sealed', v: SEALED_SLOT_VERSION, ct: sealed.ct, iv: sealed.iv };
}

async function decodeSlot<K extends StorageSlot>(slot: K, raw: unknown): Promise<StorageShape[K]> {
  switch (slot) {
    case 'meta':
      return decodeMeta(raw) as StorageShape[K];
    case 'profiles':
      return (await decodeProfiles(raw)) as unknown as StorageShape[K];
    case 'settings':
      return decodeSettings(raw) as StorageShape[K];
    case 'keys':
      return decodeKeys(raw) as unknown as StorageShape[K];
    case 'mappings':
      return decodeMappings(raw) as StorageShape[K];
    case 'sync':
      return decodeSync(raw) as StorageShape[K];
    default:
      throw new Error(`unknown storage slot: ${String(slot)}`);
  }
}

async function encodeSlot<K extends StorageSlot>(slot: K, value: StorageShape[K]): Promise<unknown> {
  switch (slot) {
    case 'meta':
      return metaRecordSchema.parse(value);
    case 'profiles':
      return encodeProfiles(value as Profile[]);
    case 'settings':
      return settingsSchema.parse(value);
    case 'keys': {
      const records = geminiKeyRecordListSchema.parse(value);
      assertKeysSealed(records);
      return records;
    }
    case 'mappings':
      return mappingStoreSchema.parse(value);
    case 'sync':
      return syncStateSchema.parse(value);
    default:
      throw new Error(`unknown storage slot: ${String(slot)}`);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Per-slot serialisation — read-modify-write must not lose updates
 * ---------------------------------------------------------------------------------------------- */

const locks = new Map<StorageSlot, Promise<unknown>>();

async function withLock<T>(slot: StorageSlot, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(slot) ?? Promise.resolve();
  const run = previous.then(task, task);
  // Park a never-rejecting tail so one failed update cannot poison the queue.
  locks.set(
    slot,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/* ------------------------------------------------------------------------------------------------
 * Public API
 * ---------------------------------------------------------------------------------------------- */

/** Read a slot. Never returns `undefined`: a missing or broken slot yields `defaultFor(slot)`. */
export async function getSlot<K extends StorageSlot>(slot: K): Promise<StorageShape[K]> {
  try {
    const raw = await readRaw(storageKeyOf(slot));
    return await decodeSlot(slot, raw);
  } catch (error) {
    log.error(`read of ${storageKeyOf(slot)} failed`, error);
    return defaultFor(slot);
  }
}

/** Overwrite a slot. Validates (and, for `jf.profiles`, seals) before anything touches disk. */
export async function setSlot<K extends StorageSlot>(
  slot: K,
  value: StorageShape[K],
): Promise<StorageShape[K]> {
  const encoded = await encodeSlot(slot, value);
  await writeRaw(storageKeyOf(slot), encoded);
  return value;
}

/**
 * Read-modify-write a slot under a per-slot lock, so two concurrent updaters (e.g. the rotation
 * ledger and the options UI both touching `jf.keys`) cannot clobber each other.
 */
export async function updateSlot<K extends StorageSlot>(
  slot: K,
  updater: (current: StorageShape[K]) => StorageShape[K] | Promise<StorageShape[K]>,
): Promise<StorageShape[K]> {
  return withLock(slot, async () => {
    const current = await getSlot(slot);
    const next = await updater(current);
    return setSlot(slot, next);
  });
}

/** Remove a slot entirely. The next read returns `defaultFor(slot)`. */
export async function removeSlot(slot: StorageSlot): Promise<void> {
  await ext().storage.local.remove(storageKeyOf(slot));
}

/* ------------------------------------------------------------------------------------------------
 * Change feed (browser.storage.onChanged)
 * ---------------------------------------------------------------------------------------------- */

export type SlotListener<K extends StorageSlot> = (value: StorageShape[K]) => void;

type AnyListener = (value: unknown) => void;

const listeners = new Map<StorageSlot, Set<AnyListener>>();
let changeHookInstalled = false;

function installChangeHook(): void {
  if (changeHookInstalled) return;
  const api = ext();
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    for (const key of Object.keys(changes)) {
      const slot = SLOT_BY_STORAGE_KEY.get(key);
      if (!slot) continue;
      const slotListeners = listeners.get(slot);
      if (!slotListeners || slotListeners.size === 0) continue;
      // Re-read through the decoder rather than trusting `change.newValue`: sealed slots need
      // decryption, and every slot needs its Zod pass before a subscriber sees it.
      void getSlot(slot)
        .then((value) => {
          for (const listener of slotListeners) {
            try {
              listener(value);
            } catch (error) {
              log.error(`subscriber for ${key} threw`, error);
            }
          }
        })
        .catch((error: unknown) => log.error(`change feed re-read of ${key} failed`, error));
    }
  });
  changeHookInstalled = true;
}

/**
 * Subscribe to a slot. The listener fires with the decoded value after every change to that slot
 * — including changes made by this context. Returns an unsubscribe function.
 */
export function subscribeSlot<K extends StorageSlot>(slot: K, listener: SlotListener<K>): () => void {
  installChangeHook();
  let set = listeners.get(slot);
  if (!set) {
    set = new Set<AnyListener>();
    listeners.set(slot, set);
  }
  const wrapped = listener as AnyListener;
  set.add(wrapped);
  return () => {
    const current = listeners.get(slot);
    if (!current) return;
    current.delete(wrapped);
    if (current.size === 0) listeners.delete(slot);
  };
}

/**
 * The `get / set / update / subscribe` façade named in the design brief. Exported as an object so
 * the barrel can re-export it without colliding with WXT's auto-imported `storage` global.
 */
export const store = {
  get: getSlot,
  set: setSlot,
  update: updateSlot,
  remove: removeSlot,
  subscribe: subscribeSlot,
  defaultFor,
} as const;

/* ------------------------------------------------------------------------------------------------
 * Named accessors — what the rest of the extension actually calls
 * ---------------------------------------------------------------------------------------------- */

export const getMeta = (): Promise<MetaRecord> => getSlot('meta');
export const getProfiles = (): Promise<Profile[]> => getSlot('profiles');
export const getSettings = (): Promise<Settings> => getSlot('settings');
export const getKeys = (): Promise<GeminiKeyRecord[]> => getSlot('keys');
export const getMappings = (): Promise<MappingStore> => getSlot('mappings');
export const getSyncState = (): Promise<SyncState> => getSlot('sync');

export const setProfiles = (profiles: Profile[]): Promise<Profile[]> => setSlot('profiles', profiles);
export const setKeys = (keys: GeminiKeyRecord[]): Promise<GeminiKeyRecord[]> => setSlot('keys', keys);
export const setMappings = (mappings: MappingStore): Promise<MappingStore> =>
  setSlot('mappings', mappings);

/** Settings writes always stamp `updatedAt` so the options UI and the SW agree on freshness. */
export async function setSettings(settings: Settings, now: number = Date.now()): Promise<Settings> {
  return setSlot('settings', { ...settings, updatedAt: now });
}

export async function patchSettings(patch: Partial<Settings>, now: number = Date.now()): Promise<Settings> {
  return updateSlot('settings', (current) => ({ ...current, ...patch, updatedAt: now }));
}

export async function setSyncState(state: SyncState): Promise<SyncState> {
  return setSlot('sync', state);
}

export async function patchSyncState(patch: Partial<SyncState>): Promise<SyncState> {
  return updateSlot('sync', (current) => ({ ...current, ...patch }));
}

/** F-13 learn-from-correction: remember `domain → sigHash → profilePath`. */
export async function saveMapping(domain: string, sigHash: string, path: string): Promise<void> {
  await updateSlot('mappings', (current) => {
    const forDomain = current[domain] ?? {};
    return { ...current, [domain]: { ...forDomain, [sigHash]: path } };
  });
}

/** Every mapping learned for one domain. Empty object when nothing has been learned yet. */
export async function getMappingsForDomain(domain: string): Promise<Record<string, string>> {
  const all = await getMappings();
  return all[domain] ?? {};
}

export async function deleteMapping(domain: string, sigHash: string): Promise<void> {
  await updateSlot('mappings', (current) => {
    const forDomain = current[domain];
    if (!forDomain || !(sigHash in forDomain)) return current;
    const nextDomain: Record<string, string> = { ...forDomain };
    delete nextDomain[sigHash];
    const next: MappingStore = { ...current };
    if (Object.keys(nextDomain).length === 0) delete next[domain];
    else next[domain] = nextDomain;
    return next;
  });
}

/** The active profile, honouring `settings.activeProfileId` and falling back to the default one. */
export async function getActiveProfile(): Promise<Profile | null> {
  const [profiles, settings] = await Promise.all([getProfiles(), getSettings()]);
  if (profiles.length === 0) return null;
  if (settings.activeProfileId !== null) {
    const match = profiles.find((profile) => profile.id === settings.activeProfileId);
    if (match) return match;
  }
  return profiles.find((profile) => profile.isDefault) ?? profiles[0] ?? null;
}

export async function getProfileById(profileId: string | null): Promise<Profile | null> {
  if (profileId === null) return getActiveProfile();
  const profiles = await getProfiles();
  return profiles.find((profile) => profile.id === profileId) ?? null;
}

/** Insert-or-replace one profile, keeping the array order stable. */
export async function upsertProfile(profile: Profile): Promise<Profile[]> {
  return updateSlot('profiles', (current) => {
    const index = current.findIndex((candidate) => candidate.id === profile.id);
    if (index < 0) return [...current, profile];
    const next = [...current];
    next[index] = profile;
    return next;
  });
}

export async function deleteProfile(profileId: string): Promise<Profile[]> {
  return updateSlot('profiles', (current) => current.filter((profile) => profile.id !== profileId));
}

/* ------------------------------------------------------------------------------------------------
 * SEC 7.1 — meta, install identity, migrations
 * ---------------------------------------------------------------------------------------------- */

/** Create `jf.meta` if it is missing; otherwise return what is already there. */
export async function ensureMeta(now: number = Date.now()): Promise<MetaRecord> {
  return withLock('meta', async () => {
    const raw = await readRaw(storageKeyOf('meta'));
    const parsed = metaRecordSchema.safeParse(raw);
    if (parsed.success && parsed.data.installId !== '') return parsed.data;

    const created: MetaRecord = {
      schemaVersion: SCHEMA_VERSION,
      installId: randomUuid(),
      createdAt: now,
      lastMigratedAt: null,
    };
    await writeRaw(storageKeyOf('meta'), created);
    log.info('created jf.meta for a fresh install');
    return created;
  });
}

/** Stable per-install identifier. Local only — it is never sent anywhere (F-16 is opt-in and V2). */
export async function getInstallId(): Promise<string> {
  return (await ensureMeta()).installId;
}

export interface MigrationContext {
  readonly from: number;
  readonly to: number;
  readonly now: number;
}

export interface Migration {
  /** Schema version this migration produces. Runs when `to > stored schemaVersion`. */
  readonly to: number;
  readonly describe: string;
  run(ctx: MigrationContext): Promise<void>;
}

/**
 * Forward-only migrations, ordered by `to`. `SCHEMA_VERSION` is the version this build writes;
 * anything stored below it is walked up one step at a time.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    to: 1,
    describe: 'baseline: fill in defaults for pre-schemaVersion installs and seal jf.profiles',
    async run(ctx) {
      // Re-writing through setSlot() runs each slot's Zod pass with its defaults applied, and —
      // for jf.profiles — seals a plaintext array that predates the vault (SEC 7.1 / SEC 9.2).
      await setSlot('settings', await getSlot('settings'));
      await setSlot('sync', await getSlot('sync'));
      await setSlot('mappings', await getSlot('mappings'));

      const profiles = await getSlot('profiles');
      if (profiles.length > 0) await setSlot('profiles', profiles);

      // `jf.keys` is deliberately left alone: it has no defaults to backfill, and rewriting it
      // would run `assertKeysSealed` at migration time, where a throw would stall every boot.
      // The guard still fires on the next real write, which is where it can be acted on.
      log.info(`migrated storage ${ctx.from} → ${ctx.to}`);
    },
  },
];

/** True when data slots exist but `jf.meta` does not — i.e. an install from before versioning. */
async function looksLikeLegacyInstall(): Promise<boolean> {
  const dataKeys = SLOTS.filter((slot) => slot !== 'meta').map((slot) => storageKeyOf(slot));
  const bag = (await ext().storage.local.get(dataKeys)) as Record<string, unknown>;
  return dataKeys.some((key) => bag[key] !== undefined);
}

/**
 * Bring stored data up to `SCHEMA_VERSION` (SEC 7.1). Idempotent — safe to call on every service
 * worker start. A store written by a *newer* build is left completely alone: downgrading would
 * mean discarding fields this build cannot even name.
 */
export async function runMigrations(now: number = Date.now()): Promise<MetaRecord> {
  return withLock('meta', async () => {
    const raw = await readRaw(storageKeyOf('meta'));
    const parsed = metaRecordSchema.safeParse(raw);

    let meta: MetaRecord;
    if (parsed.success && parsed.data.installId !== '') {
      meta = parsed.data;
    } else {
      const legacy = await looksLikeLegacyInstall();
      meta = {
        schemaVersion: legacy ? 0 : SCHEMA_VERSION,
        installId: randomUuid(),
        createdAt: now,
        lastMigratedAt: null,
      };
      log.info(legacy ? 'no jf.meta but data present — migrating from v0' : 'fresh install');
    }

    if (meta.schemaVersion > SCHEMA_VERSION) {
      log.error(
        `stored schemaVersion ${meta.schemaVersion} is newer than this build (${SCHEMA_VERSION}) — ` +
          'refusing to migrate downwards',
      );
      return meta;
    }

    let from = meta.schemaVersion;
    for (const migration of MIGRATIONS) {
      if (migration.to <= from || migration.to > SCHEMA_VERSION) continue;
      log.info(`applying migration → v${migration.to}: ${migration.describe}`);
      await migration.run({ from, to: migration.to, now });
      from = migration.to;
    }

    const next: MetaRecord = {
      ...meta,
      schemaVersion: SCHEMA_VERSION,
      lastMigratedAt: from === meta.schemaVersion ? (meta.lastMigratedAt ?? null) : now,
    };
    await writeRaw(storageKeyOf('meta'), next);
    return next;
  });
}

/* ------------------------------------------------------------------------------------------------
 * Wipe
 * ---------------------------------------------------------------------------------------------- */

/** Remove every `jf.*` data slot. The vault material survives, so a re-import still decrypts. */
export async function clearAllSlots(): Promise<void> {
  await ext().storage.local.remove(SLOTS.map((slot) => storageKeyOf(slot)));
  log.warn('cleared all jf.* storage slots');
}

/**
 * Full local wipe: every slot plus the vault material (SEC 5.3 "delete is instant and shreds
 * ciphertext"). IndexedDB is wiped separately via `platform/db.deleteDatabase()`.
 */
export async function wipeInstall(): Promise<void> {
  await clearAllSlots();
  await destroyVaultMaterial();
}
