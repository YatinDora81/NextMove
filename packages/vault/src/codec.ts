/**
 * codec.ts — the byte-level end-to-end envelope, shared verbatim by `apps/web` and
 * `apps/extension` (JF-001 Rev 3.0 SEC 7.4 / 9.2).
 *
 * This module exists because the same bytes must be produced in two different runtimes. The web
 * onboarding wizard seals a profile vault in a browser tab; the MV3 service worker opens it hours
 * later on a different machine. If those two ever ran *similar but separate* implementations they
 * would drift on the first parameter change, and the failure mode is a user whose profile silently
 * will not decrypt. So there is exactly one implementation, in one package, and both import it.
 *
 * ── Wire format ────────────────────────────────────────────────────────────────────────────────
 *
 *   ciphertext (base64):
 *   ┌────────┬────────┬─────────┬───────────┬──────────────────────────────┐
 *   │ magic  │ format │ saltLen │ salt      │ AES-256-GCM ciphertext + tag │
 *   │ 4 B    │ 1 B    │ 1 B     │ saltLen B │ …                            │
 *   └────────┴────────┴─────────┴───────────┴──────────────────────────────┘
 *   nonce (base64): the 12-byte AES-GCM IV, carried beside the blob because
 *   `profileBlobEnvelopeSchema` has a column for it and must not grow one for the salt.
 *
 * ── Why two format bytes ───────────────────────────────────────────────────────────────────────
 *
 *   FORMAT_PBKDF2 (1)  Key = PBKDF2-SHA-256(passphrase, salt, 210 000). What SEC 9.2 originally
 *                      specified. Still written for the *device-token* envelope and still read for
 *                      any vault sealed before the handoff flow existed, so no one's data strands.
 *   FORMAT_RAW_KEY (2) Key = 32 raw random bytes, `saltLen` 0, no KDF. This is what the web →
 *                      extension handoff uses: the website generates the key with
 *                      `generateVaultKey()`, hands it straight to the extension over
 *                      `chrome.runtime.sendMessage`, and it never touches the server.
 *
 * A raw key is *stronger* than a passphrase-derived one (full 256 bits of entropy, no dictionary
 * to attack) and removes the single worst piece of UX in the original design — asking the user to
 * invent, remember, and retype a 12-character passphrase on every device. The trade is
 * recoverability, which is why `generateVaultKey` output is meant to be shown once as a
 * downloadable recovery key.
 *
 * INVARIANT: nothing in this file reads or writes storage, network, `chrome.*`, or `process.env`.
 * It is pure over its arguments so it can be unit-tested and so neither host app can smuggle a
 * side effect into the other's runtime.
 */

import { VaultError } from './errors';

/* ------------------------------------------------------------------------------------------------
 * Parameters — the numbers both runtimes must agree on
 * ---------------------------------------------------------------------------------------------- */

/** OWASP 2023 floor for PBKDF2-SHA-256. Only used by `FORMAT_PBKDF2`. */
export const VAULT_PBKDF2_ITERATIONS = 210_000;
export const VAULT_SALT_BYTES = 16;
export const VAULT_IV_BYTES = 12;
/** AES-256. `generateVaultKey()` emits exactly this many random bytes. */
export const VAULT_KEY_BYTES = 32;
/** AES-GCM tag length in bytes — used only for truncation checks. */
export const GCM_TAG_BYTES = 16;

/** A passphrase floor worth having. Below this, PBKDF2 iterations are theatre. */
export const MIN_VAULT_PASSPHRASE_LENGTH = 12;

export const FORMAT_PBKDF2 = 1;
export const FORMAT_RAW_KEY = 2;

const MIN_SALT_BYTES = 8;
const MAX_SALT_BYTES = 64;
const MAGIC_BYTES_LENGTH = 4;
const HEADER_FIXED_BYTES = MAGIC_BYTES_LENGTH + 2; // magic + format + saltLen

/** ASCII magic for a sealed profile vault. */
export const VAULT_MAGIC = 'JFS1';
/** ASCII magic for a device-token envelope (device-local, never E2E — there is no other end). */
export const DEVICE_TOKEN_MAGIC = 'JFD1';

export type SealedBlobMagic = typeof VAULT_MAGIC | typeof DEVICE_TOKEN_MAGIC;

/**
 * `lib.dom`'s `BufferSource` narrowed to an `ArrayBuffer`-backed view. TypeScript 5.7+ separates
 * these from `SharedArrayBuffer`-backed views, and WebCrypto only accepts the former.
 */
type Bytes = Uint8Array<ArrayBuffer>;

const MAGICS: Record<SealedBlobMagic, Bytes> = {
  [VAULT_MAGIC]: asciiBytes(VAULT_MAGIC),
  [DEVICE_TOKEN_MAGIC]: asciiBytes(DEVICE_TOKEN_MAGIC),
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/* ------------------------------------------------------------------------------------------------
 * Key material
 * ---------------------------------------------------------------------------------------------- */

/**
 * What opens (or seals) an envelope. A discriminated union rather than a bare string so a caller
 * physically cannot pass a passphrase where a raw key is meant — the two produce different format
 * bytes and mixing them up would be a silent, unrecoverable data error.
 */
export type VaultKeyMaterial =
  | { readonly kind: 'passphrase'; readonly passphrase: string }
  | { readonly kind: 'rawKey'; readonly keyB64: string };

export function passphraseMaterial(passphrase: string): VaultKeyMaterial {
  return { kind: 'passphrase', passphrase };
}

export function rawKeyMaterial(keyB64: string): VaultKeyMaterial {
  return { kind: 'rawKey', keyB64 };
}

/**
 * Mints a fresh 256-bit vault key as base64. This is *the* secret in the E2E design: whoever holds
 * it can read the profile, and nobody who does not hold it can — including the NextMove server,
 * which only ever sees the ciphertext.
 */
export function generateVaultKey(): string {
  return bytesToBase64(randomBytes(VAULT_KEY_BYTES));
}

/** True when `value` is base64 decoding to exactly a 256-bit key. Cheap validation for handoff. */
export function isVaultKey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    return base64ToBytes(value).length === VAULT_KEY_BYTES;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Byte helpers
 * ---------------------------------------------------------------------------------------------- */

function asciiBytes(text: string): Bytes {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function subtle(): SubtleCrypto {
  const c: Crypto | undefined = globalThis.crypto;
  if (!c || typeof c.subtle === 'undefined') {
    throw new VaultError(
      'unavailable',
      'WebCrypto SubtleCrypto is unavailable here. In a browser this means a non-secure origin.',
    );
  }
  return c.subtle;
}

/** Cryptographically-random bytes. Never `Math.random` — this is key material. */
export function randomBytes(length: number): Bytes {
  const c: Crypto | undefined = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new VaultError('unavailable', 'crypto.getRandomValues is not available in this context.');
  }
  const out = new Uint8Array(length);
  c.getRandomValues(out);
  return out;
}

export function bytesToBase64(bytes: Bytes): string {
  let binary = '';
  const CHUNK = 0x8000; // chunked so a large vault cannot blow the argument limit on spread
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const slice = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Bytes {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new VaultError('bad-format', 'Value is not valid base64.');
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i) & 0xff;
  return out;
}

function concatBytes(parts: readonly Bytes[]): Bytes {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Length-fixed prefix compare. The magic is public, so no timing signal of value matters. */
function startsWithMagic(blob: Bytes, magic: Bytes): boolean {
  if (blob.length < magic.length) return false;
  let diff = 0;
  for (let i = 0; i < magic.length; i += 1) diff |= (blob[i] ?? 0) ^ (magic[i] ?? 0);
  return diff === 0;
}

/* ------------------------------------------------------------------------------------------------
 * Key derivation / import
 * ---------------------------------------------------------------------------------------------- */

/** PBKDF2-SHA-256 → non-extractable AES-256-GCM key. `FORMAT_PBKDF2` only. */
export async function deriveVaultKey(
  passphrase: string,
  salt: Bytes,
  iterations: number = VAULT_PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', textEncoder.encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Imports a base64 256-bit key as non-extractable AES-GCM. `FORMAT_RAW_KEY` only. */
export async function importVaultKey(keyB64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(keyB64);
  if (raw.length !== VAULT_KEY_BYTES) {
    throw new VaultError(
      'key-malformed',
      `Vault key must be ${VAULT_KEY_BYTES} bytes, got ${raw.length}.`,
    );
  }
  return subtle().importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

function assertMaterial(material: VaultKeyMaterial): void {
  if (material.kind === 'passphrase') {
    if (typeof material.passphrase !== 'string' || material.passphrase.length === 0) {
      throw new VaultError('key-required', 'A passphrase is required to open this vault.');
    }
    if (material.passphrase.length < MIN_VAULT_PASSPHRASE_LENGTH) {
      throw new VaultError(
        'passphrase-weak',
        `Passphrase must be at least ${MIN_VAULT_PASSPHRASE_LENGTH} characters.`,
      );
    }
    return;
  }
  if (!isVaultKey(material.keyB64)) {
    throw new VaultError('key-malformed', 'Vault key is not base64 of a 256-bit key.');
  }
}

/* ------------------------------------------------------------------------------------------------
 * Seal / open
 * ---------------------------------------------------------------------------------------------- */

export interface SealedBlob {
  /** base64 of `magic || format || saltLen || salt || AES-GCM(ct+tag)`. */
  ciphertext: string;
  /** base64 of the 12-byte AES-GCM IV. */
  nonce: string;
}

export async function sealBlob(
  magic: SealedBlobMagic,
  material: VaultKeyMaterial,
  plaintext: string,
  iterations: number = VAULT_PBKDF2_ITERATIONS,
): Promise<SealedBlob> {
  assertMaterial(material);

  const iv = randomBytes(VAULT_IV_BYTES);
  const salt =
    material.kind === 'passphrase' ? randomBytes(VAULT_SALT_BYTES) : (new Uint8Array(0) as Bytes);
  const key =
    material.kind === 'passphrase'
      ? await deriveVaultKey(material.passphrase, salt, iterations)
      : await importVaultKey(material.keyB64);

  const encrypted = new Uint8Array(
    await subtle().encrypt({ name: 'AES-GCM', iv }, key, textEncoder.encode(plaintext)),
  ) as Bytes;

  const header = new Uint8Array(HEADER_FIXED_BYTES) as Bytes;
  header.set(MAGICS[magic], 0);
  header[4] = material.kind === 'passphrase' ? FORMAT_PBKDF2 : FORMAT_RAW_KEY;
  header[5] = salt.length;

  return {
    ciphertext: bytesToBase64(concatBytes([header, salt, encrypted])),
    nonce: bytesToBase64(iv),
  };
}

export async function openBlob(
  magic: SealedBlobMagic,
  material: VaultKeyMaterial,
  sealed: SealedBlob,
  iterations: number = VAULT_PBKDF2_ITERATIONS,
): Promise<string> {
  assertMaterial(material);

  const blob = base64ToBytes(sealed.ciphertext);
  const iv = base64ToBytes(sealed.nonce);

  if (iv.length !== VAULT_IV_BYTES) {
    throw new VaultError('bad-format', `Nonce must be ${VAULT_IV_BYTES} bytes, got ${iv.length}.`);
  }
  if (!startsWithMagic(blob, MAGICS[magic])) {
    throw new VaultError('bad-format', `Blob is not a ${magic} envelope.`);
  }
  if (blob.length < HEADER_FIXED_BYTES) {
    throw new VaultError('bad-format', 'Envelope header is truncated.');
  }

  const format = blob[4];
  const saltLength = blob[5] ?? 0;

  // The format byte and the key material must agree. A vault sealed with a raw key cannot be
  // opened with a passphrase and vice versa, and saying so beats a generic decrypt failure.
  if (format === FORMAT_PBKDF2 && material.kind !== 'passphrase') {
    throw new VaultError('bad-format', 'This vault was sealed with a passphrase.');
  }
  if (format === FORMAT_RAW_KEY && material.kind !== 'rawKey') {
    throw new VaultError('bad-format', 'This vault was sealed with a vault key, not a passphrase.');
  }
  if (format !== FORMAT_PBKDF2 && format !== FORMAT_RAW_KEY) {
    throw new VaultError('bad-format', `Unsupported envelope format ${String(format)}.`);
  }
  if (format === FORMAT_PBKDF2 && (saltLength < MIN_SALT_BYTES || saltLength > MAX_SALT_BYTES)) {
    throw new VaultError('bad-format', `Envelope salt length ${saltLength} is out of range.`);
  }
  if (format === FORMAT_RAW_KEY && saltLength !== 0) {
    throw new VaultError('bad-format', 'A raw-key envelope must not carry a salt.');
  }

  const bodyStart = HEADER_FIXED_BYTES + saltLength;
  if (blob.length <= bodyStart + GCM_TAG_BYTES) {
    throw new VaultError('bad-format', 'Envelope body is truncated.');
  }

  const salt = blob.subarray(HEADER_FIXED_BYTES, bodyStart) as Bytes;
  const body = blob.subarray(bodyStart) as Bytes;
  const key =
    material.kind === 'passphrase'
      ? await deriveVaultKey(material.passphrase, salt, iterations)
      : await importVaultKey(material.keyB64);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await subtle().decrypt({ name: 'AES-GCM', iv }, key, body);
  } catch {
    // Deliberately opaque: a wrong key and a tampered ciphertext are indistinguishable to the
    // caller, which is the correct security posture.
    throw new VaultError('decrypt-failed', 'Could not decrypt — wrong key or corrupt data.');
  }
  return textDecoder.decode(plaintext);
}

/**
 * Cheap structural proof that a base64 body really came out of `sealBlob`. `sync/guard.ts` calls
 * this on every outbound body so a plaintext profile can never leave a device even if some future
 * caller forgets to seal it.
 */
export function hasSealedHeader(ciphertextBase64: string, magic: SealedBlobMagic): boolean {
  try {
    const blob = base64ToBytes(ciphertextBase64);
    if (!startsWithMagic(blob, MAGICS[magic])) return false;
    if (blob.length < HEADER_FIXED_BYTES) return false;

    const format = blob[4];
    const saltLength = blob[5] ?? 0;
    if (format === FORMAT_PBKDF2) {
      if (saltLength < MIN_SALT_BYTES || saltLength > MAX_SALT_BYTES) return false;
    } else if (format === FORMAT_RAW_KEY) {
      if (saltLength !== 0) return false;
    } else {
      return false;
    }
    return blob.length > HEADER_FIXED_BYTES + saltLength + GCM_TAG_BYTES;
  } catch {
    return false;
  }
}
