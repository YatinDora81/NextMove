/**
 * platform/crypto.ts — the vault's WebCrypto layer (JF-001 Rev 3.0 SEC 5.3, SEC 9.2).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * HONEST LIMIT (SEC 9.2, stated verbatim so nobody downstream overstates it):
 *
 *   "Encryption at rest — vault key from PBKDF2(installSecret, 210k, SHA-256) → AES-GCM per
 *    record. Honest limit: the install secret lives on the same device, so this defeats casual
 *    file-system snooping and backup leakage, not malware running as the user. Optional user
 *    passphrase mode upgrades to real E2E strength (required for Phase-2 sync)."
 *
 * Read that again before writing any UI copy about this feature. In the default (install-secret)
 * mode the key material sits next to the ciphertext on the same disk: a process running as the
 * user can read both. What this buys is real but bounded — a stolen laptop image, a synced
 * profile folder, or a browser backup does not hand over plaintext keys or PII. It is NOT
 * protection against malware running as the user, and it must never be described as such.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Crypto parameters (SEC 5.3):
 *   - PBKDF2-SHA256, 210,000 iterations, 16-byte random salt → AES-256-GCM key.
 *   - A FRESH 12-byte random IV per encryption. IVs are never reused, never derived, never
 *     counted — `crypto.getRandomValues` on every single call. GCM nonce reuse is catastrophic,
 *     so there is no code path here that can produce a second ciphertext under the same IV.
 *   - `{ ct, iv }` are base64; `ct` carries the GCM auth tag (WebCrypto appends it).
 *
 * INV-5: this module encrypts and decrypts. It never logs a plaintext, never returns key material
 * to a caller, and never touches the network. `src/ai/vault.ts` is the only module allowed to
 * decrypt a `GeminiKeyRecord.ct`; everything else uses this layer for profiles and device tokens.
 *
 * This module deliberately does NOT import `platform/storage` — storage encrypts profiles through
 * *this* module, so the dependency runs one way only. The vault material lives under its own
 * `jf.vault.secret` storage key (constants.VAULT_SECRET_KEY), outside the six `jf.*` data slots,
 * so a schema migration that rewrites a data slot can never orphan the key that decrypts it.
 */

import type { WxtBrowser } from 'wxt/browser';
import { z } from 'zod';

import {
  VAULT_IV_BYTES,
  VAULT_PBKDF2_ITERATIONS,
  VAULT_SALT_BYTES,
  VAULT_SECRET_KEY,
} from '@/shared/constants';
import { createLogger } from '@/platform/logger';

const log = createLogger('crypto');

/**
 * Late-bound extension API handle. WXT auto-imports `browser`, but resolving it off `globalThis`
 * at call time keeps this module usable in a plain vitest run where a fake browser is installed
 * on the global object before the first vault call.
 */
function ext(): WxtBrowser {
  const g = globalThis as unknown as { browser?: WxtBrowser; chrome?: WxtBrowser };
  const api = g.browser ?? g.chrome;
  if (!api) throw new VaultUnavailableError('extension storage APIs are unavailable in this context');
  return api;
}

/* ------------------------------------------------------------------------------------------------
 * Errors
 * ---------------------------------------------------------------------------------------------- */

/** WebCrypto (or the extension API) is missing — e.g. a content script on a non-secure origin. */
export class VaultUnavailableError extends Error {
  override readonly name = 'VaultUnavailableError';
  constructor(message: string) {
    super(message);
  }
}

/** Ciphertext could not be opened: wrong key, truncated blob, or a tampered auth tag. */
export class VaultDecryptError extends Error {
  override readonly name = 'VaultDecryptError';
  constructor(message: string) {
    super(message);
  }
}

/** Passphrase mode is active but no passphrase has been supplied in this service-worker lifetime. */
export class VaultLockedError extends Error {
  override readonly name = 'VaultLockedError';
  constructor(message = 'Vault is in passphrase mode and locked — unlockWithPassphrase() first.') {
    super(message);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Wire shapes
 * ---------------------------------------------------------------------------------------------- */

/** AES-256-GCM envelope. Both fields are base64; `ct` includes the 16-byte GCM auth tag. */
export interface Sealed {
  ct: string;
  iv: string;
}

export const sealedSchema = z.object({
  ct: z.string().min(1),
  iv: z.string().min(1),
});

export type VaultMode = 'install' | 'passphrase';

/** A key-bound cipher. Handed out by `deriveFromPassphrase` so a rekey can hold both at once. */
export interface VaultCipher {
  readonly mode: VaultMode;
  encryptString(plaintext: string): Promise<Sealed>;
  decryptString(sealed: Sealed): Promise<string>;
}

/**
 * What actually sits at `jf.vault.secret`. `secret` is the per-install random material (SEC 5.3);
 * `salt` is shared by both derivation modes; `verifier` is a probe sealed under the passphrase
 * key so a wrong passphrase is rejected without touching user data.
 */
interface VaultMaterial {
  v: number;
  secret: string;
  salt: string;
  mode: VaultMode;
  iterations: number;
  verifier: Sealed | null;
  createdAt: number;
}

const VAULT_MATERIAL_VERSION = 1;

const vaultMaterialSchema = z.object({
  v: z.number().int().positive(),
  secret: z.string().min(1),
  salt: z.string().min(1),
  mode: z.enum(['install', 'passphrase']),
  iterations: z.number().int().positive(),
  verifier: sealedSchema.nullable(),
  createdAt: z.number().int().nonnegative(),
});

/** Constant sealed under the passphrase key to verify an entered passphrase. */
const PASSPHRASE_PROBE = 'jf.vault.probe.v1';

/* ------------------------------------------------------------------------------------------------
 * base64 / bytes
 * ---------------------------------------------------------------------------------------------- */

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte === undefined) continue;
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length: number): Uint8Array {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new VaultUnavailableError('crypto.getRandomValues is unavailable in this context');
  }
  return c.getRandomValues(new Uint8Array(length));
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new VaultUnavailableError(
      'crypto.subtle is unavailable here (non-secure context?) — vault operations must run in the ' +
        'service worker or an extension page.',
    );
  }
  return c.subtle;
}

/**
 * Crypto-random identifier, e.g. `randomId('prof')` → `prof_k3f9d1a08b2c`.
 * Never `Math.random` — ids end up as Dexie primary keys and idempotency handles.
 */
export function randomId(prefix: string): string {
  const bytes = randomBytes(9);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte === undefined) continue;
    out += byte.toString(16).padStart(2, '0');
  }
  return `${prefix}_${out}`;
}

/** UUID v4 for correlation ids and install ids. */
export function randomUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = randomBytes(16);
  const b6 = bytes[6];
  const b8 = bytes[8];
  if (b6 !== undefined) bytes[6] = (b6 & 0x0f) | 0x40;
  if (b8 !== undefined) bytes[8] = (b8 & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    hex.push(byte === undefined ? '00' : byte.toString(16).padStart(2, '0'));
  }
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

/* ------------------------------------------------------------------------------------------------
 * Material lifecycle
 * ---------------------------------------------------------------------------------------------- */

let materialPromise: Promise<VaultMaterial> | null = null;

async function readMaterial(): Promise<VaultMaterial | null> {
  const stored = await ext().storage.local.get(VAULT_SECRET_KEY);
  const raw = (stored as Record<string, unknown>)[VAULT_SECRET_KEY];
  if (raw === undefined || raw === null) return null;
  const parsed = vaultMaterialSchema.safeParse(raw);
  if (!parsed.success) {
    log.error('vault material is unreadable — refusing to overwrite it', parsed.error.issues);
    throw new VaultUnavailableError(
      'Stored vault material is corrupt. Existing encrypted records cannot be opened.',
    );
  }
  return parsed.data;
}

async function writeMaterial(material: VaultMaterial): Promise<void> {
  await ext().storage.local.set({ [VAULT_SECRET_KEY]: material });
}

async function createMaterial(): Promise<VaultMaterial> {
  const fresh: VaultMaterial = {
    v: VAULT_MATERIAL_VERSION,
    secret: toBase64(randomBytes(32)),
    salt: toBase64(randomBytes(VAULT_SALT_BYTES)),
    mode: 'install',
    iterations: VAULT_PBKDF2_ITERATIONS,
    verifier: null,
    createdAt: Date.now(),
  };
  await writeMaterial(fresh);
  // Two contexts can race on first install (service worker + options page). Both write, then both
  // re-read and converge on whichever landed last — safe because no data exists yet at that point.
  const settled = await readMaterial();
  return settled ?? fresh;
}

/** Load the per-install material, generating it exactly once. */
async function loadMaterial(): Promise<VaultMaterial> {
  if (materialPromise) return materialPromise;
  const pending = (async (): Promise<VaultMaterial> => {
    const existing = await readMaterial();
    if (existing) return existing;
    log.info('generating vault material (first run)');
    return createMaterial();
  })();
  materialPromise = pending;
  try {
    return await pending;
  } catch (error) {
    materialPromise = null;
    throw error;
  }
}

async function updateMaterial(patch: Partial<VaultMaterial>): Promise<VaultMaterial> {
  const current = await loadMaterial();
  const next: VaultMaterial = { ...current, ...patch };
  await writeMaterial(next);
  materialPromise = Promise.resolve(next);
  return next;
}

/* ------------------------------------------------------------------------------------------------
 * Key derivation
 * ---------------------------------------------------------------------------------------------- */

async function deriveAesKey(
  keyMaterial: Uint8Array,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const api = subtle();
  const base = await api.importKey('raw', keyMaterial as BufferSource, 'PBKDF2', false, ['deriveKey']);
  return api.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptWithKey(key: CryptoKey, plaintext: string): Promise<Sealed> {
  // Fresh 12-byte IV on EVERY encryption — never reused (SEC 5.3).
  const iv = randomBytes(VAULT_IV_BYTES);
  const buffer = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    TEXT_ENCODER.encode(plaintext) as BufferSource,
  );
  return { ct: toBase64(new Uint8Array(buffer)), iv: toBase64(iv) };
}

async function decryptWithKey(key: CryptoKey, sealed: Sealed): Promise<string> {
  const iv = fromBase64(sealed.iv);
  if (iv.length !== VAULT_IV_BYTES) {
    throw new VaultDecryptError(`bad IV length: expected ${VAULT_IV_BYTES} bytes, got ${iv.length}`);
  }
  try {
    const buffer = await subtle().decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      fromBase64(sealed.ct) as BufferSource,
    );
    return TEXT_DECODER.decode(buffer);
  } catch {
    // Never echo the ciphertext or the key — just say it failed.
    throw new VaultDecryptError('AES-GCM decryption failed (wrong key or tampered ciphertext)');
  }
}

function makeCipher(mode: VaultMode, key: CryptoKey): VaultCipher {
  return {
    mode,
    encryptString: (plaintext: string) => encryptWithKey(key, plaintext),
    decryptString: (sealed: Sealed) => decryptWithKey(key, sealed),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Ciphers
 * ---------------------------------------------------------------------------------------------- */

let installCipherPromise: Promise<VaultCipher> | null = null;
/** Passphrase-derived cipher for the current service-worker lifetime. Memory only, by design. */
let unlockedCipher: VaultCipher | null = null;

/** The install-secret cipher (SEC 9.2 default mode). Cached per worker lifetime. */
async function installCipher(): Promise<VaultCipher> {
  if (installCipherPromise) return installCipherPromise;
  const pending = (async (): Promise<VaultCipher> => {
    const material = await loadMaterial();
    const key = await deriveAesKey(
      fromBase64(material.secret),
      fromBase64(material.salt),
      material.iterations,
    );
    return makeCipher('install', key);
  })();
  installCipherPromise = pending;
  try {
    return await pending;
  } catch (error) {
    installCipherPromise = null;
    throw error;
  }
}

/**
 * Derive a cipher from a user passphrase WITHOUT activating it (SEC 9.2 upgrade path).
 * Uses the same stored salt and iteration count as install mode, so callers can hold both
 * ciphers side by side during a rekey.
 */
export async function deriveFromPassphrase(passphrase: string): Promise<VaultCipher> {
  if (passphrase.length === 0) throw new VaultUnavailableError('passphrase must not be empty');
  const material = await loadMaterial();
  const key = await deriveAesKey(
    TEXT_ENCODER.encode(passphrase),
    fromBase64(material.salt),
    material.iterations,
  );
  return makeCipher('passphrase', key);
}

/** The cipher currently in force. Throws `VaultLockedError` in passphrase mode until unlocked. */
export async function getVaultCipher(): Promise<VaultCipher> {
  const material = await loadMaterial();
  if (material.mode === 'passphrase') {
    if (!unlockedCipher) throw new VaultLockedError();
    return unlockedCipher;
  }
  return installCipher();
}

/**
 * The raw per-install secret (base64 of 32 random bytes), generating the material if this is a
 * first run.
 *
 * `sync/e2e.ts` needs this to seal *device-local* credentials — the device JWT and the sync vault
 * key — with an envelope of its own. It deliberately does not go through `getVaultCipher()`,
 * because that cipher is locked in passphrase mode and the service worker must be able to reach a
 * device credential without a human present to type anything.
 *
 * It reads through `loadMaterial()` rather than touching `chrome.storage` itself. That is the
 * whole point of exporting it: two modules independently creating `jf.vault.secret` is how you get
 * one of them writing a bare string where the other expects a `VaultMaterial` object, at which
 * point `readMaterial()` throws `VaultUnavailableError` and every encrypted record on the device
 * becomes unreadable. One writer, one shape.
 */
export async function getInstallSecret(): Promise<string> {
  return (await loadMaterial()).secret;
}

/** Which derivation mode the vault is in right now. */
export async function getVaultMode(): Promise<VaultMode> {
  return (await loadMaterial()).mode;
}

/** True when passphrase mode is on and no passphrase has been supplied yet this lifetime. */
export async function isVaultLocked(): Promise<boolean> {
  return (await loadMaterial()).mode === 'passphrase' && unlockedCipher === null;
}

/** Drop the in-memory passphrase key. Install mode is unaffected (it has nothing to lock). */
export function lockVault(): void {
  unlockedCipher = null;
}

/**
 * Verify a passphrase against the stored probe and, on success, install it as the active cipher
 * for this service-worker lifetime. Returns false on a wrong passphrase — never throws for it.
 */
export async function unlockWithPassphrase(passphrase: string): Promise<boolean> {
  const material = await loadMaterial();
  if (material.mode !== 'passphrase' || !material.verifier) return false;
  const candidate = await deriveFromPassphrase(passphrase);
  try {
    const probe = await candidate.decryptString(material.verifier);
    if (probe !== PASSPHRASE_PROBE) return false;
  } catch {
    return false;
  }
  unlockedCipher = candidate;
  return true;
}

/**
 * Upgrade the vault to passphrase mode (SEC 9.2 / required for Phase-2 sync).
 *
 * The caller supplies `rekey`, which must re-encrypt every record it owns using `to` and drop the
 * `from` ciphertexts. Order matters: records are rewritten first, the mode flip is committed
 * last. If the process dies in between, `decryptString` still opens install-sealed records via
 * its fallback chain, so a half-finished upgrade degrades to "some records already rekeyed"
 * rather than to data loss.
 */
export async function enablePassphraseMode(
  passphrase: string,
  rekey: (from: VaultCipher, to: VaultCipher) => Promise<void>,
): Promise<void> {
  const material = await loadMaterial();
  if (material.mode === 'passphrase') {
    throw new VaultUnavailableError('vault is already in passphrase mode');
  }
  const from = await installCipher();
  const to = await deriveFromPassphrase(passphrase);
  await rekey(from, to);
  const verifier = await to.encryptString(PASSPHRASE_PROBE);
  await updateMaterial({ mode: 'passphrase', verifier });
  unlockedCipher = to;
  log.info('vault upgraded to passphrase mode');
}

/**
 * Downgrade to install-secret mode. Symmetric with `enablePassphraseMode`: `rekey` re-encrypts
 * every record with the install cipher before the mode flip is committed.
 */
export async function disablePassphraseMode(
  passphrase: string,
  rekey: (from: VaultCipher, to: VaultCipher) => Promise<void>,
): Promise<boolean> {
  const material = await loadMaterial();
  if (material.mode !== 'passphrase') return false;
  if (!(await unlockWithPassphrase(passphrase))) return false;
  const from = unlockedCipher;
  if (!from) return false;
  const to = await installCipher();
  await rekey(from, to);
  await updateMaterial({ mode: 'install', verifier: null });
  unlockedCipher = null;
  log.info('vault reverted to install-secret mode');
  return true;
}

/* ------------------------------------------------------------------------------------------------
 * Public encrypt / decrypt
 * ---------------------------------------------------------------------------------------------- */

/** Seal a string under the active vault key. A fresh random 12-byte IV is used every call. */
export async function encryptString(plaintext: string): Promise<Sealed> {
  const cipher = await getVaultCipher();
  return cipher.encryptString(plaintext);
}

/**
 * Open a `{ ct, iv }` envelope.
 *
 * Fallback chain: the active cipher first, then the install cipher. The fallback exists purely so
 * a crash mid-`enablePassphraseMode` cannot strand records that were sealed under the old key —
 * it never weakens anything, because both ciphers are already available to this process.
 */
export async function decryptString(sealed: Sealed): Promise<string> {
  const parsed = sealedSchema.safeParse(sealed);
  if (!parsed.success) throw new VaultDecryptError('malformed sealed envelope');

  const active = await getVaultCipher();
  try {
    return await active.decryptString(parsed.data);
  } catch (error) {
    if (active.mode === 'install') throw error;
    const fallback = await installCipher();
    try {
      const opened = await fallback.decryptString(parsed.data);
      log.warn('opened a record still sealed under the install key — rekey did not complete');
      return opened;
    } catch {
      throw error;
    }
  }
}

/** Convenience: seal a JSON-serialisable value. */
export async function encryptJson(value: unknown): Promise<Sealed> {
  return encryptString(JSON.stringify(value));
}

/** Convenience: open a sealed JSON value. The caller is responsible for Zod-validating it. */
export async function decryptJson(sealed: Sealed): Promise<unknown> {
  const text = await decryptString(sealed);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new VaultDecryptError('decrypted payload is not valid JSON');
  }
}

/**
 * Destroy the vault material. Every existing ciphertext becomes permanently unreadable, so this
 * is only for "wipe this install" flows — it is the shred half of SEC 5.3's "delete is instant
 * and shreds ciphertext".
 */
export async function destroyVaultMaterial(): Promise<void> {
  await ext().storage.local.remove(VAULT_SECRET_KEY);
  materialPromise = null;
  installCipherPromise = null;
  unlockedCipher = null;
  log.warn('vault material destroyed — all existing ciphertext is now unreadable');
}

/** Test hook: forget every cached key/material handle without touching storage. */
export function resetVaultCache(): void {
  materialPromise = null;
  installCipherPromise = null;
  unlockedCipher = null;
}
