import {
  DEVICE_TOKEN_MAGIC,
  VAULT_MAGIC,
  base64ToBytes,
  bytesToBase64,
  generateVaultKey,
  hasSealedHeader,
  isVaultKey,
  openBlob,
  openProfileVault as openProfileVaultShared,
  passphraseMaterial,
  randomBytes,
  rawKeyMaterial,
  sealBlob,
  sealProfileVault as sealProfileVaultShared,
  VaultError,
  isVaultError,
} from '@repo/vault';
import type { SealedBlob, SealedBlobMagic, VaultKeyMaterial } from '@repo/vault';
import {
  buildSyncProfileVault,
  syncProfileVaultSchema,
} from '@repo/types/ProfileTypes';
import type { SyncProfileVault } from '@repo/types/ProfileTypes';
import { profileBlobEnvelopeSchema } from '@repo/types/ExtensionTypes';
import type { profileBlobEnvelopeSchemaType } from '@repo/types/ExtensionTypes';

import { getInstallSecret } from '@/platform/crypto';

export {
  DEVICE_TOKEN_MAGIC,
  base64ToBytes,
  buildSyncProfileVault,
  bytesToBase64,
  generateVaultKey,
  hasSealedHeader,
  isVaultKey,
  openBlob,
  passphraseMaterial,
  randomBytes,
  rawKeyMaterial,
  sealBlob,
  syncProfileVaultSchema,
  VaultError,
  isVaultError,
};
export type { SealedBlob, SealedBlobMagic, SyncProfileVault, VaultKeyMaterial };

export const E2E_MAGIC = VAULT_MAGIC;

export function isBase64OfLength(value: string, length: number): boolean {
  try {
    return base64ToBytes(value).length === length;
  } catch {
    return false;
  }
}

export const VAULT_KEY_CT = 'vaultKeyCt';
export const VAULT_KEY_IV = 'vaultKeyIv';

export async function sealVaultKey(keyB64: string): Promise<SealedBlob> {
  if (!isVaultKey(keyB64)) {
    throw new VaultError('key-malformed', 'Refusing to store something that is not a vault key.');
  }
  return sealDeviceBlob(keyB64);
}

export async function openVaultKey(sealed: SealedBlob): Promise<string> {
  const keyB64 = await openDeviceBlob(sealed);
  if (!isVaultKey(keyB64)) {
    throw new VaultError('key-malformed', 'Stored vault key is corrupt.');
  }
  return keyB64;
}

export async function sealProfileVault(
  vault: SyncProfileVault,
  key: VaultKeyMaterial,
  version: number,
): Promise<profileBlobEnvelopeSchemaType> {
  const envelope = await sealProfileVaultShared(vault, key, version);
  return profileBlobEnvelopeSchema.parse(envelope);
}

export async function openProfileVault(
  envelope: unknown,
  key: VaultKeyMaterial,
): Promise<SyncProfileVault> {
  const parsed = profileBlobEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    throw new VaultError('bad-format', `Not a profile blob envelope: ${parsed.error.message}`);
  }
  return openProfileVaultShared(parsed.data, key);
}

export async function canOpenProfileVault(
  envelope: unknown,
  key: VaultKeyMaterial,
): Promise<boolean> {
  try {
    await openProfileVault(envelope, key);
    return true;
  } catch {
    return false;
  }
}

async function deviceMaterial(): Promise<VaultKeyMaterial> {
  return rawKeyMaterial(await getInstallSecret());
}

async function sealDeviceBlob(plaintext: string): Promise<SealedBlob> {
  return sealBlob(DEVICE_TOKEN_MAGIC, await deviceMaterial(), plaintext);
}

async function openDeviceBlob(sealed: SealedBlob): Promise<string> {
  const secret = await getInstallSecret();
  try {
    return await openBlob(DEVICE_TOKEN_MAGIC, rawKeyMaterial(secret), sealed);
  } catch (error) {
    if (isVaultError(error) && error.code === 'bad-format') {
      return openBlob(DEVICE_TOKEN_MAGIC, passphraseMaterial(secret), sealed);
    }
    throw error;
  }
}

export async function sealDeviceToken(token: string): Promise<SealedBlob> {
  if (typeof token !== 'string' || token.length === 0) {
    throw new VaultError('bad-payload', 'Refusing to seal an empty device token.');
  }
  return sealDeviceBlob(token);
}

export async function openDeviceToken(sealed: SealedBlob): Promise<string> {
  return openDeviceBlob(sealed);
}

export function forgetInstallSecret(): void {
}
