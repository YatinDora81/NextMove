/**
 * sync/e2e.ts — the extension's end of the end-to-end envelope (JF-001 Rev 3.0 SEC 7.4 / 8.3 / 9.2).
 *
 * The codec itself no longer lives here. It moved to `@repo/vault` the moment the web onboarding
 * wizard became the place a profile is *authored*: the bytes are now produced in a browser tab and
 * consumed in an MV3 service worker, and two copies of a crypto implementation drift on the first
 * parameter change. What remains in this file is everything that is genuinely extension-shaped —
 * storage, the device credential, and the vault key's lifecycle on this install.
 *
 * ── What changed, and why the passphrase went away ─────────────────────────────────────────────
 *
 * SEC 9.2 originally specified "optional user passphrase mode … required for Phase-2 sync", and the
 * result was a feature nobody could use: there was no passphrase input anywhere in the UI, so
 * `sealProfileVault` and `openProfileVault` were written, exported, and never called by a single
 * caller. The profile never synced.
 *
 * The property SEC 7.4 actually asks for is *"the server stores ciphertext it cannot read"*. A
 * passphrase is one way to get that. A random 256-bit key that never touches the server is a
 * stronger way — full entropy, no dictionary attack, nothing to forget — provided the key can reach
 * a second device without passing through the server. That is exactly what the web → extension
 * handoff does: the onboarding page mints the key with `generateVaultKey()`, seals the profile with
 * it, `PUT`s only the ciphertext, and hands the key straight to this extension over
 * `chrome.runtime.sendMessage`. The server sees an opaque blob at every step.
 *
 * So: the vault key is stored here, sealed at rest with the per-install secret, and the passphrase
 * path survives only as `FORMAT_PBKDF2` in the codec so that no vault sealed under the old scheme
 * becomes unreadable.
 *
 * INV-5 is unchanged and still enforced one layer down in `sync/guard.ts`: Gemini keys and the
 * Answer Bank have no slot in `syncProfileVaultSchema` and the guard re-checks every outbound body.
 */

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

/* ------------------------------------------------------------------------------------------------
 * Re-exports — the surface `sync/guard.ts`, `sync/client.ts` and the barrel already import
 * ---------------------------------------------------------------------------------------------- */

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

/** Historical alias. `sync/guard.ts` imports this name to assert the profile envelope's magic. */
export const E2E_MAGIC = VAULT_MAGIC;

/** True when `value` is base64 that decodes to exactly `length` bytes (used by the guard). */
export function isBase64OfLength(value: string, length: number): boolean {
  try {
    return base64ToBytes(value).length === length;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------------------------------
 * The vault key — this install's copy of the secret that opens the profile blob
 * ---------------------------------------------------------------------------------------------- */

/**
 * Where the sealed vault key lives. It is a sibling of the sealed device token inside `jf.sync`
 * rather than a top-level storage key, because the two have exactly the same lifetime: both arrive
 * at pairing, both are dropped at unpair, and neither is worth anything without the other.
 */
export const VAULT_KEY_CT = 'vaultKeyCt';
export const VAULT_KEY_IV = 'vaultKeyIv';

/**
 * Seals a vault key for storage. Device-local, not E2E — the per-install secret is the right key
 * here precisely because it cannot travel, which is what makes it useless to anyone who exfiltrates
 * `chrome.storage.local` without also having this install's material.
 */
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

/* ------------------------------------------------------------------------------------------------
 * Profile vault
 * ---------------------------------------------------------------------------------------------- */

/**
 * Seals the profile vault for `PUT /api/sync/profile`.
 *
 * `version` is the SEC 8.3 optimistic-concurrency counter: pass `state.profileVersion + 1`. A stale
 * version comes back as a 409 carrying the winning envelope — open it, merge, re-seal at
 * `remoteVersion + 1`. Nothing here retries or overwrites on your behalf.
 */
export async function sealProfileVault(
  vault: SyncProfileVault,
  key: VaultKeyMaterial,
  version: number,
): Promise<profileBlobEnvelopeSchemaType> {
  const envelope = await sealProfileVaultShared(vault, key, version);
  return profileBlobEnvelopeSchema.parse(envelope);
}

/** Opens an envelope pulled from `GET /api/sync/profile`. Throws `VaultError` on any failure. */
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

/** True when `key` opens `envelope` — lets the UI say "wrong key" instead of offering a merge. */
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

/* ------------------------------------------------------------------------------------------------
 * Device-local sealing (SEC 8.2) — the per-install secret, never the vault key
 * ---------------------------------------------------------------------------------------------- */

/**
 * The device JWT and the vault key are *device-local* credentials: they must survive a
 * service-worker restart without prompting anyone. So they are sealed with the per-install secret,
 * which `@/platform/crypto` owns. This module used to read and lazily create `jf.vault.secret`
 * itself, in a different shape from the one `platform/crypto.ts` writes — and since `readMaterial`
 * there throws rather than overwrite a shape it does not recognise, pairing before the profile
 * vault was first initialised would have bricked every encrypted record on the install. One owner
 * for that key, and it is not this file.
 *
 * The secret is 32 random bytes in base64, so it is used as a raw key, not a passphrase: no PBKDF2,
 * which matters because the device token is unsealed on essentially every sync request.
 */
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
    // Envelopes written before the raw-key format existed derived their key with PBKDF2 over the
    // same secret. Read them once so nobody who paired on an older build is silently logged out.
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

/**
 * Test seam. The install secret is cached inside `@/platform/crypto`, so dropping it is that
 * module's job; this exists so callers written against the old API keep compiling.
 */
export function forgetInstallSecret(): void {
  // No local cache to clear — see `deviceMaterial()`.
}
