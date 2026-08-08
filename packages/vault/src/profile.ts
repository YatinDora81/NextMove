/**
 * profile.ts — sealing and opening the profile vault itself.
 *
 * `codec.ts` knows about bytes; this file knows what those bytes mean. Both halves of the product
 * call these two functions and nothing lower:
 *
 *   apps/web        seals during onboarding, then `PUT /api/sync/profile`
 *   apps/extension  `GET /api/sync/profile`, then opens into local storage
 *
 * The payload is validated on the way *in* and on the way *out*. Validating on the way out matters
 * more than it looks: a decrypted blob is attacker-influenced input the moment someone can write to
 * the `ProfileBlob` row, and AES-GCM authenticates the bytes, not their meaning.
 */

import { syncProfileVaultSchema } from '@repo/types/ProfileTypes';
import type { SyncProfileVault } from '@repo/types/ProfileTypes';

import { VAULT_MAGIC, openBlob, sealBlob } from './codec';
import type { SealedBlob, VaultKeyMaterial } from './codec';
import { VaultError } from './errors';

/**
 * The `GET`/`PUT /api/sync/profile` body. Declared structurally rather than imported from
 * `@repo/types/ExtensionTypes` so this package stays usable in a context that has not wired the
 * API contracts — the caller parses against the real schema before it hits the wire.
 */
export interface ProfileBlobEnvelope {
  ciphertext: string;
  nonce: string;
  version: number;
}

/**
 * Encrypts the profile vault into a `profileBlobEnvelopeSchema` body.
 *
 * `version` is the optimistic-concurrency counter (SEC 8.3): pass `lastKnownVersion + 1`. The
 * server rejects a stale write with 409 and returns its current version so the caller can pull,
 * merge, and retry — this function never decides that policy.
 */
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

/** Decrypts an envelope pulled from `GET /api/sync/profile`. Throws `VaultError` on any failure. */
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

/** True when `material` opens `envelope`. Used to tell "wrong key" from "merge needed" in the UI. */
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
