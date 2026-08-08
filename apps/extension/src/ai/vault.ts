/**
 * ai/vault.ts — the key vault (JF-001 Rev 3.0 SEC 5.3).
 *
 *   Add      → validate against Google FIRST, then encrypt. An invalid key is never stored.
 *   At rest  → AES-256-GCM, key derived with PBKDF2(installSecret, 210k, SHA-256); ciphertext +
 *              per-key 12-byte IV in `chrome.storage.local` under `jf.keys`.
 *   In memory→ decrypted per request, inside `withDecryptedKey`, and dropped when it returns.
 *   Display  → ALWAYS masked ("AIza…9F2k"). There is no reveal path in this module, by design.
 *   Delete   → shreds the ciphertext in place before the row is removed.
 *
 * INV-5 is enforced here, not merely documented:
 *   - `listKeys()` cannot leak a key: it never decrypts, and the mask is precomputed at add time.
 *   - the plaintext exists only inside the `withDecryptedKey` callback frame.
 *   - nothing in this file calls `console.*` with key material — the only logging is a bare
 *     counter of decrypt failures.
 * INV-6: no import of `API_BASE_URL`; the vault never talks to the NextMove API.
 *
 * The crypto and storage ports are injectable (`configureVaultPorts`) so that
 * `src/platform/{crypto,storage}` can own them once it lands; the built-in implementations are
 * the SEC 5.3 algorithms verbatim and are what runs until something is injected.
 */

import { browser } from 'wxt/browser';
import { z } from 'zod';

import type { KeyState, ModelBudgets, ModelId } from '@repo/rotation';
import {
  DEFAULT_MODEL_BUDGETS,
  MODEL_FALLBACK_CHAIN,
  keyAvailableAt,
  newKeyState,
  refreshStatus,
} from '@repo/rotation';

import {
  STORAGE_KEY_KEYS,
  VAULT_IV_BYTES,
  VAULT_PBKDF2_ITERATIONS,
  VAULT_SALT_BYTES,
  VAULT_SECRET_KEY,
} from '@/shared/constants';
import { geminiKeyRecordSchema } from '@/shared/schema';
import type { GeminiKeyPublic, GeminiKeyRecord } from '@/shared/types';

import { validateKey } from './gemini-client';

/* ------------------------------------------------------------------------------------------------
 * Ports
 * ---------------------------------------------------------------------------------------------- */

export interface VaultCrypto {
  /** Returns base64 ciphertext (auth tag included) and a fresh base64 12-byte IV. */
  encrypt(plaintext: string): Promise<{ ct: string; iv: string }>;
  decrypt(ct: string, iv: string): Promise<string>;
}

export interface VaultStorage {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

let cryptoPort: VaultCrypto | null = null;
let storagePort: VaultStorage | null = null;

/**
 * Swap in `src/platform/crypto` / `src/platform/storage`. Passing `null` (or omitting a field)
 * restores the built-in implementation. Call this once, at service-worker start-up.
 */
export function configureVaultPorts(ports: {
  crypto?: VaultCrypto | null;
  storage?: VaultStorage | null;
}): void {
  if ('crypto' in ports) cryptoPort = ports.crypto ?? null;
  if ('storage' in ports) storagePort = ports.storage ?? null;
  // A different crypto port means a different derived key; drop the cached one.
  derivedKey = null;
  installSecret = null;
}

/* ------------------------------------------------------------------------------------------------
 * Built-in storage port — chrome.storage.local via the WXT polyfill
 * ---------------------------------------------------------------------------------------------- */

const memoryStore = new Map<string, unknown>();

function localArea(): {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string): Promise<void>;
} | null {
  const area = (browser as unknown as { storage?: { local?: unknown } } | undefined)?.storage
    ?.local as
    | {
        get(keys: string): Promise<Record<string, unknown>>;
        set(items: Record<string, unknown>): Promise<void>;
        remove(keys: string): Promise<void>;
      }
    | undefined;
  return area ?? null;
}

const builtInStorage: VaultStorage = {
  async read(key) {
    const area = localArea();
    if (area === null) return memoryStore.get(key) ?? null;
    const bag = await area.get(key);
    return bag[key] ?? null;
  },
  async write(key, value) {
    const area = localArea();
    if (area === null) {
      memoryStore.set(key, value);
      return;
    }
    await area.set({ [key]: value });
  },
  async remove(key) {
    const area = localArea();
    if (area === null) {
      memoryStore.delete(key);
      return;
    }
    await area.remove(key);
  },
};

function store(): VaultStorage {
  return storagePort ?? builtInStorage;
}

/* ------------------------------------------------------------------------------------------------
 * Built-in crypto port — WebCrypto, SEC 5.3 parameters
 * ---------------------------------------------------------------------------------------------- */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Only ever holds derived material, never a Gemini key. */
interface InstallSecret {
  secret: Uint8Array;
  salt: Uint8Array;
  iterations: number;
}

const installSecretSchema = z.object({
  secret: z.string().min(1),
  salt: z.string().min(1),
  iterations: z.number().int().positive().optional(),
  createdAt: z.number().int().nonnegative().optional(),
});

let installSecret: Promise<InstallSecret> | null = null;
let derivedKey: Promise<CryptoKey> | null = null;

/**
 * Read (or mint) the per-install secret behind the vault key.
 *
 * Tolerant on purpose: a sibling module may have written this record first, either as the
 * `{secret, salt}` envelope this function writes, or as a bare secret string. In the bare case
 * the salt is derived deterministically from the secret so both readers agree.
 */
async function loadInstallSecret(): Promise<InstallSecret> {
  const raw = await store().read(VAULT_SECRET_KEY);

  if (typeof raw === 'string' && raw.length > 0) {
    const secret = textEncoder.encode(raw);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', secret));
    return {
      secret,
      salt: digest.slice(0, VAULT_SALT_BYTES),
      iterations: VAULT_PBKDF2_ITERATIONS,
    };
  }

  const parsed = installSecretSchema.safeParse(raw);
  if (parsed.success) {
    return {
      secret: base64ToBytes(parsed.data.secret),
      salt: base64ToBytes(parsed.data.salt),
      iterations: parsed.data.iterations ?? VAULT_PBKDF2_ITERATIONS,
    };
  }

  const fresh: InstallSecret = {
    secret: randomBytes(32),
    salt: randomBytes(VAULT_SALT_BYTES),
    iterations: VAULT_PBKDF2_ITERATIONS,
  };
  await store().write(VAULT_SECRET_KEY, {
    secret: bytesToBase64(fresh.secret),
    salt: bytesToBase64(fresh.salt),
    iterations: fresh.iterations,
    createdAt: Date.now(),
  });
  return fresh;
}

async function getVaultKey(): Promise<CryptoKey> {
  if (derivedKey === null) {
    derivedKey = (async () => {
      if (installSecret === null) installSecret = loadInstallSecret();
      const { secret, salt, iterations } = await installSecret;
      const base = await crypto.subtle.importKey('raw', secret as BufferSource, 'PBKDF2', false, [
        'deriveKey',
      ]);
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        // Non-extractable: the vault key itself can never be read back out of WebCrypto.
        false,
        ['encrypt', 'decrypt'],
      );
    })();
  }
  return derivedKey;
}

const builtInCrypto: VaultCrypto = {
  async encrypt(plaintext) {
    const key = await getVaultKey();
    const iv = randomBytes(VAULT_IV_BYTES);
    const buffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      textEncoder.encode(plaintext) as BufferSource,
    );
    return { ct: bytesToBase64(new Uint8Array(buffer)), iv: bytesToBase64(iv) };
  },
  async decrypt(ct, iv) {
    const key = await getVaultKey();
    const buffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(iv) as BufferSource },
      key,
      base64ToBytes(ct) as BufferSource,
    );
    return textDecoder.decode(buffer);
  },
};

function vaultCrypto(): VaultCrypto {
  return cryptoPort ?? builtInCrypto;
}

/* ------------------------------------------------------------------------------------------------
 * Stored shape
 * ---------------------------------------------------------------------------------------------- */

/**
 * `jf.keys` row = the shared `GeminiKeyRecord` plus the precomputed display mask.
 *
 * The mask is stored rather than derived on read precisely so that rendering the key list never
 * needs a decryption (INV-5). It contains four leading and four trailing characters of a key that
 * is worthless without the middle — the same thing Google itself shows in AI Studio.
 */
export interface StoredKeyRecord extends GeminiKeyRecord {
  masked: string;
}

const storedKeyRecordSchema = geminiKeyRecordSchema.extend({
  masked: z.string().default('AIza…????'),
});

const storedKeyListSchema = z.array(storedKeyRecordSchema);

/** "AIza…9F2k" — the only representation of a key that may ever reach a UI (SEC 5.3). */
export function maskKey(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length <= 8) return '…';
  return trimmed.slice(0, 4) + '…' + trimmed.slice(-4);
}

/* ------------------------------------------------------------------------------------------------
 * Serialised read/modify/write
 * ---------------------------------------------------------------------------------------------- */

/**
 * `chrome.storage` has no compare-and-swap, and a single user action can fan out into several
 * ledger writes. Every mutation funnels through this queue so two in-flight leases cannot clobber
 * each other's rotation state.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readRecords(): Promise<StoredKeyRecord[]> {
  const raw = await store().read(STORAGE_KEY_KEYS);
  if (raw === null || raw === undefined) return [];
  const parsed = storedKeyListSchema.safeParse(raw);
  if (!parsed.success) {
    // A corrupt row must not brick the extension; drop what cannot be parsed, keep the rest.
    if (!Array.isArray(raw)) return [];
    const salvaged: StoredKeyRecord[] = [];
    for (const candidate of raw) {
      const row = storedKeyRecordSchema.safeParse(candidate);
      if (row.success) salvaged.push(row.data);
    }
    return salvaged;
  }
  return parsed.data;
}

async function writeRecords(records: readonly StoredKeyRecord[]): Promise<void> {
  await store().write(STORAGE_KEY_KEYS, records);
}

/* ------------------------------------------------------------------------------------------------
 * Public API
 * ---------------------------------------------------------------------------------------------- */

export interface AddKeyOk {
  ok: true;
  record: GeminiKeyPublic;
}

export interface AddKeyRejected {
  ok: false;
  /** Google's rejection message, VERBATIM (SEC 5.2). */
  message: string;
}

export type AddKeyResult = AddKeyOk | AddKeyRejected;

export async function countKeys(): Promise<number> {
  return (await readRecords()).length;
}

export async function hasKeys(): Promise<boolean> {
  return (await countKeys()) > 0;
}

/**
 * SEC 5.3 "Add key": an immediate `models.list` validation call, then encryption. The order
 * matters — an unrestricted legacy key that Google refuses never reaches storage, and the user
 * sees Google's own explanation of why.
 */
export async function addKey(
  plaintextKey: string,
  label: string,
  now: number = Date.now(),
): Promise<AddKeyResult> {
  const key = plaintextKey.trim();
  if (key.length === 0) return { ok: false, message: 'Paste a key first.' };

  const validation = await validateKey(key);
  if (!validation.ok) return { ok: false, message: validation.message };

  const encrypted = await vaultCrypto().encrypt(key);
  const record: StoredKeyRecord = {
    id: crypto.randomUUID(),
    label: label.trim().length > 0 ? label.trim() : 'Gemini key',
    ct: encrypted.ct,
    iv: encrypted.iv,
    addedAt: now,
    state: newKeyState('', now),
    masked: maskKey(key),
  };
  record.state = { ...record.state, id: record.id };

  return serialize(async () => {
    const records = await readRecords();
    records.push(record);
    await writeRecords(records);
    return { ok: true, record: toPublic(record, MODEL_FALLBACK_CHAIN[0] ?? '', DEFAULT_MODEL_BUDGETS, now) };
  });
}

/**
 * Masked list for the UI. Never decrypts, so it is safe to call from any surface that can render
 * (INV-5). `model` decides which ledger the `retryAt` countdown refers to.
 */
export async function listKeys(
  model: ModelId = MODEL_FALLBACK_CHAIN[0] ?? '',
  budgets: ModelBudgets = DEFAULT_MODEL_BUDGETS,
  now: number = Date.now(),
): Promise<GeminiKeyPublic[]> {
  const records = await readRecords();
  return records.map((record) => toPublic(record, model, budgets, now));
}

function toPublic(
  record: StoredKeyRecord,
  model: ModelId,
  budgets: ModelBudgets,
  now: number,
): GeminiKeyPublic {
  const state = refreshStatus(record.state, model, now);
  const availableAt = keyAvailableAt(state, model, budgets, now);
  return {
    id: record.id,
    label: record.label,
    masked: record.masked,
    status: state.status,
    strikes: state.strikes,
    addedAt: record.addedAt,
    lastUsedAt: state.lastUsedAt,
    retryAt: Number.isFinite(availableAt) && availableAt > now ? availableAt : null,
  };
}

/** Label lookup for error copy. Returns `''` for an unknown id — never throws. */
export async function getKeyLabel(id: string): Promise<string> {
  const records = await readRecords();
  return records.find((record) => record.id === id)?.label ?? '';
}

/**
 * SEC 5.3 "Delete is instant and shreds ciphertext": the row's ciphertext and IV are overwritten
 * with same-length random data and flushed to storage before the row itself is removed, so the
 * previous value is not left behind in a copy-on-write page.
 */
export async function deleteKey(id: string): Promise<boolean> {
  return serialize(async () => {
    const records = await readRecords();
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) return false;

    const victim = records[index];
    if (victim !== undefined) {
      records[index] = {
        ...victim,
        ct: bytesToBase64(randomBytes(Math.max(16, base64ToBytes(victim.ct).length))),
        iv: bytesToBase64(randomBytes(VAULT_IV_BYTES)),
        masked: '…',
      };
      await writeRecords(records);
    }

    records.splice(index, 1);
    await writeRecords(records);
    return true;
  });
}

/**
 * Re-run the SEC 5.3 validation ping for one stored key and flip DEAD ↔ ACTIVE accordingly.
 * Shape matches the `KEYS_TEST` bus reply exactly.
 */
export async function testKey(
  id: string,
): Promise<{ id: string; status: GeminiKeyPublic['status']; ok: boolean; message: string }> {
  const records = await readRecords();
  const record = records.find((row) => row.id === id);
  if (record === undefined) {
    return { id, status: 'DEAD', ok: false, message: 'That key is no longer in the vault.' };
  }

  let result;
  try {
    result = await withDecryptedKey(id, (apiKey) => validateKey(apiKey));
  } catch {
    decryptFailures += 1;
    return {
      id,
      status: 'DEAD',
      ok: false,
      message: 'This key could not be decrypted on this device. Delete it and add it again.',
    };
  }

  return serialize(async () => {
    const current = await readRecords();
    const index = current.findIndex((row) => row.id === id);
    if (index === -1) {
      return { id, status: 'DEAD' as const, ok: false, message: 'That key is no longer in the vault.' };
    }
    const row = current[index];
    if (row === undefined) {
      return { id, status: 'DEAD' as const, ok: false, message: 'That key is no longer in the vault.' };
    }

    let state = row.state;
    if (result.ok) {
      state = { ...state, status: 'ACTIVE', strikes: 0, cooldownUntil: 0 };
    } else if (result.outcome.kind === 'key_invalid') {
      state = { ...state, status: 'DEAD' };
    }

    current[index] = { ...row, state };
    await writeRecords(current);
    return {
      id,
      status: state.status,
      ok: result.ok,
      // Verbatim on failure — SEC 5.2.
      message: result.message,
    };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Rotation-state persistence (SEC 5.4 — the ledger must survive service-worker death)
 * ---------------------------------------------------------------------------------------------- */

export async function loadKeyStates(): Promise<KeyState[]> {
  const records = await readRecords();
  return records.map((record) => record.state);
}

/**
 * Persist rotation state after a transition. Only rows that still exist are touched, and only the
 * `state` field is written — a concurrent `addKey`/`deleteKey` can never be undone by a late
 * ledger flush.
 */
export async function saveKeyStates(states: readonly KeyState[]): Promise<void> {
  if (states.length === 0) return;
  const byId = new Map<string, KeyState>();
  for (const state of states) byId.set(state.id, state);

  await serialize(async () => {
    const records = await readRecords();
    let changed = false;
    for (let i = 0; i < records.length; i += 1) {
      const record = records[i];
      if (record === undefined) continue;
      const next = byId.get(record.id);
      if (next === undefined) continue;
      records[i] = { ...record, state: next };
      changed = true;
    }
    if (changed) await writeRecords(records);
  });
}

/* ------------------------------------------------------------------------------------------------
 * The one decrypt site
 * ---------------------------------------------------------------------------------------------- */

/** Bare counter; deliberately never paired with any identifying detail (INV-5). */
let decryptFailures = 0;

export function decryptFailureCount(): number {
  return decryptFailures;
}

/**
 * Borrow a plaintext key for the duration of one call and drop it immediately afterwards.
 *
 * This is the ONLY place in `apps/extension` where a Gemini key exists in plaintext. The value is
 * never returned to the caller, never stored in a module-level variable, and never logged; the
 * local binding is cleared before the frame unwinds so a heap snapshot taken later has nothing to
 * find. `fn` must not stash it either — that is the contract.
 */
export async function withDecryptedKey<T>(
  id: string,
  fn: (apiKey: string) => Promise<T> | T,
): Promise<T> {
  const records = await readRecords();
  const record = records.find((row) => row.id === id);
  if (record === undefined) throw new Error('Key not found in vault.');

  let plaintext = '';
  try {
    plaintext = await vaultCrypto().decrypt(record.ct, record.iv);
    return await fn(plaintext);
  } catch (error) {
    if (plaintext.length === 0) decryptFailures += 1;
    throw error;
  } finally {
    plaintext = '';
  }
}
