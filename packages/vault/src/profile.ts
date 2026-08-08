import { syncProfileVaultSchema } from '@repo/types/ProfileTypes';
import type { SyncProfileVault } from '@repo/types/ProfileTypes';

import { VAULT_MAGIC, openBlob, sealBlob } from './codec';
import type { SealedBlob, VaultKeyMaterial } from './codec';
import { VaultError } from './errors';

export interface ProfileBlobEnvelope {
  ciphertext: string;
  nonce: string;
  version: number;
}

export async function sealProfileVault(
  vault: SyncProfileVault,
  material: VaultKeyMaterial,
  version: number,
): Promise<ProfileBlobEnvelope> {
  const parsed = syncProfileVaultSchema.safeParse(vault);
  if (!parsed.success) {
    throw new VaultError('bad-payload', `Refusing to seal a malformed vault: ${parsed.error.message}`);
  }
  if (!Number.isInteger(version) || version < 0) {
    throw new VaultError(
      'bad-payload',
      `Envelope version must be a non-negative integer, got ${String(version)}.`,
    );
  }

  const sealed: SealedBlob = await sealBlob(VAULT_MAGIC, material, JSON.stringify(parsed.data));
  return { ciphertext: sealed.ciphertext, nonce: sealed.nonce, version };
}

export async function openProfileVault(
  envelope: Pick<ProfileBlobEnvelope, 'ciphertext' | 'nonce'>,
  material: VaultKeyMaterial,
): Promise<SyncProfileVault> {
  if (
    typeof envelope?.ciphertext !== 'string' ||
    typeof envelope?.nonce !== 'string' ||
    envelope.ciphertext.length === 0 ||
    envelope.nonce.length === 0
  ) {
    throw new VaultError('bad-format', 'Not a profile blob envelope.');
  }

  const json = await openBlob(VAULT_MAGIC, material, {
    ciphertext: envelope.ciphertext,
    nonce: envelope.nonce,
  });

  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    throw new VaultError('bad-payload', 'Decrypted blob is not valid JSON.');
  }

  const parsed = syncProfileVaultSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new VaultError('bad-payload', `Decrypted vault failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function canOpenProfileVault(
  envelope: Pick<ProfileBlobEnvelope, 'ciphertext' | 'nonce'>,
  material: VaultKeyMaterial,
): Promise<boolean> {
  try {
    await openProfileVault(envelope, material);
    return true;
  } catch {
    return false;
  }
}
