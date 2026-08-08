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

function ext(): WxtBrowser {
  const g = globalThis as unknown as { browser?: WxtBrowser; chrome?: WxtBrowser };
  const api = g.browser ?? g.chrome;
  if (!api) throw new VaultUnavailableError('extension storage APIs are unavailable in this context');
  return api;
}

export class VaultUnavailableError extends Error {
  override readonly name = 'VaultUnavailableError';
  constructor(message: string) {
    super(message);
  }
}

export class VaultDecryptError extends Error {
  override readonly name = 'VaultDecryptError';
  constructor(message: string) {
    super(message);
  }
}

export class VaultLockedError extends Error {
  override readonly name = 'VaultLockedError';
  constructor(message = 'Vault is in passphrase mode and locked — unlockWithPassphrase() first.') {
    super(message);
  }
}

export interface Sealed {
  ct: string;
  iv: string;
}

export const sealedSchema = z.object({
  ct: z.string().min(1),
  iv: z.string().min(1),
});

export type VaultMode = 'install' | 'passphrase';

export interface VaultCipher {
  readonly mode: VaultMode;
  encryptString(plaintext: string): Promise<Sealed>;
  decryptString(sealed: Sealed): Promise<string>;
}

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

const PASSPHRASE_PROBE = 'jf.vault.probe.v1';

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
  const settled = await readMaterial();
  return settled ?? fresh;
}

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

let installCipherPromise: Promise<VaultCipher> | null = null;
let unlockedCipher: VaultCipher | null = null;

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

export async function getVaultCipher(): Promise<VaultCipher> {
  const material = await loadMaterial();
  if (material.mode === 'passphrase') {
    if (!unlockedCipher) throw new VaultLockedError();
    return unlockedCipher;
  }
  return installCipher();
}

export async function getInstallSecret(): Promise<string> {
  return (await loadMaterial()).secret;
}

export async function getVaultMode(): Promise<VaultMode> {
  return (await loadMaterial()).mode;
}

export async function isVaultLocked(): Promise<boolean> {
  return (await loadMaterial()).mode === 'passphrase' && unlockedCipher === null;
}

export function lockVault(): void {
  unlockedCipher = null;
}

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

export async function encryptString(plaintext: string): Promise<Sealed> {
  const cipher = await getVaultCipher();
  return cipher.encryptString(plaintext);
}

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

export async function encryptJson(value: unknown): Promise<Sealed> {
  return encryptString(JSON.stringify(value));
}

export async function decryptJson(sealed: Sealed): Promise<unknown> {
  const text = await decryptString(sealed);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new VaultDecryptError('decrypted payload is not valid JSON');
  }
}

export async function destroyVaultMaterial(): Promise<void> {
  await ext().storage.local.remove(VAULT_SECRET_KEY);
  materialPromise = null;
  installCipherPromise = null;
  unlockedCipher = null;
  log.warn('vault material destroyed — all existing ciphertext is now unreadable');
}

export function resetVaultCache(): void {
  materialPromise = null;
  installCipherPromise = null;
  unlockedCipher = null;
}
