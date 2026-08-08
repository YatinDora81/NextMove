import { VaultError } from './errors';

export const VAULT_PBKDF2_ITERATIONS = 210_000;
export const VAULT_SALT_BYTES = 16;
export const VAULT_IV_BYTES = 12;
export const VAULT_KEY_BYTES = 32;
export const GCM_TAG_BYTES = 16;

export const MIN_VAULT_PASSPHRASE_LENGTH = 12;

export const FORMAT_PBKDF2 = 1;
export const FORMAT_RAW_KEY = 2;

const MIN_SALT_BYTES = 8;
const MAX_SALT_BYTES = 64;
const MAGIC_BYTES_LENGTH = 4;
const HEADER_FIXED_BYTES = MAGIC_BYTES_LENGTH + 2;

export const VAULT_MAGIC = 'JFS1';
export const DEVICE_TOKEN_MAGIC = 'JFD1';

export type SealedBlobMagic = typeof VAULT_MAGIC | typeof DEVICE_TOKEN_MAGIC;

type Bytes = Uint8Array<ArrayBuffer>;

const MAGICS: Record<SealedBlobMagic, Bytes> = {
  [VAULT_MAGIC]: asciiBytes(VAULT_MAGIC),
  [DEVICE_TOKEN_MAGIC]: asciiBytes(DEVICE_TOKEN_MAGIC),
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type VaultKeyMaterial =
  | { readonly kind: 'passphrase'; readonly passphrase: string }
  | { readonly kind: 'rawKey'; readonly keyB64: string };

export function passphraseMaterial(passphrase: string): VaultKeyMaterial {
  return { kind: 'passphrase', passphrase };
}

export function rawKeyMaterial(keyB64: string): VaultKeyMaterial {
  return { kind: 'rawKey', keyB64 };
}

export function generateVaultKey(): string {
  return bytesToBase64(randomBytes(VAULT_KEY_BYTES));
}

export function isVaultKey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    return base64ToBytes(value).length === VAULT_KEY_BYTES;
  } catch {
    return false;
  }
}

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
  const CHUNK = 0x8000;
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

function startsWithMagic(blob: Bytes, magic: Bytes): boolean {
  if (blob.length < magic.length) return false;
  let diff = 0;
  for (let i = 0; i < magic.length; i += 1) diff |= (blob[i] ?? 0) ^ (magic[i] ?? 0);
  return diff === 0;
}

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

export interface SealedBlob {
  ciphertext: string;
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
    throw new VaultError('decrypt-failed', 'Could not decrypt — wrong key or corrupt data.');
  }
  return textDecoder.decode(plaintext);
}

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
