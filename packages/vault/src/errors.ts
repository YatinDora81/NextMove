/**
 * The one error type the vault codec throws. Kept in its own module so `apps/web` can catch it
 * without importing WebCrypto-touching code into a server component by accident.
 */

export type VaultErrorCode =
  /** No key material was supplied where the codec requires it. */
  | 'key-required'
  /** A passphrase shorter than `MIN_VAULT_PASSPHRASE_LENGTH`. */
  | 'passphrase-weak'
  /** Raw key material that is not base64 of exactly `VAULT_KEY_BYTES` bytes. */
  | 'key-malformed'
  /** Not a vault envelope: bad magic, truncated header, unknown format byte, bad base64. */
  | 'bad-format'
  /** AES-GCM authentication failed — wrong key, or the ciphertext was tampered with. */
  | 'decrypt-failed'
  /** Decryption succeeded but the plaintext is not a valid payload for this schema. */
  | 'bad-payload'
  /** WebCrypto is unavailable in this context (a non-secure origin, or a Node build). */
  | 'unavailable';

export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

export function isVaultError(value: unknown): value is VaultError {
  return value instanceof VaultError;
}
