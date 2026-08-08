export type VaultErrorCode =
  | 'key-required'
  | 'passphrase-weak'
  | 'key-malformed'
  | 'bad-format'
  | 'decrypt-failed'
  | 'bad-payload'
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
