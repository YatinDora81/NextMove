import { describe, expect, it } from 'vitest';

import {
  DEVICE_TOKEN_MAGIC,
  FORMAT_PBKDF2,
  FORMAT_RAW_KEY,
  VAULT_KEY_BYTES,
  VAULT_MAGIC,
  base64ToBytes,
  generateVaultKey,
  hasSealedHeader,
  isVaultKey,
  openBlob,
  openProfileVault,
  passphraseMaterial,
  rawKeyMaterial,
  sealBlob,
  sealProfileVault,
} from './index';
import { PROFILE_VAULT_SCHEMA_VERSION, createEmptyProfile } from '@repo/types/ProfileTypes';
import type { SyncProfileVault } from '@repo/types/ProfileTypes';

const FAST_ITERATIONS = 1_000;

function vaultFixture(): SyncProfileVault {
  const profile = createEmptyProfile('p1', 'Default', 1_700_000_000_000);
  profile.personal.firstName = 'Ada';
  profile.personal.lastName = 'Lovelace';
  profile.personal.email = 'ada@example.com';
  profile.skills = ['analytical engines', 'mathematics'];
  return {
    schemaVersion: PROFILE_VAULT_SCHEMA_VERSION,
    exportedAt: 1_700_000_000_000,
    activeProfileId: 'p1',
    profiles: [profile],
  };
}

describe('vault keys', () => {
  it('mints base64 of exactly 256 bits', () => {
    const key = generateVaultKey();
    expect(base64ToBytes(key)).toHaveLength(VAULT_KEY_BYTES);
    expect(isVaultKey(key)).toBe(true);
  });

  it('rejects anything that is not a 256-bit key', () => {
    expect(isVaultKey('')).toBe(false);
    expect(isVaultKey('not base64 !!')).toBe(false);
    expect(isVaultKey(btoa('too short'))).toBe(false);
    expect(isVaultKey(null)).toBe(false);
  });
});

describe('raw-key envelopes (format 2 — the web → extension handoff)', () => {
  it('round-trips a profile vault', async () => {
    const key = rawKeyMaterial(generateVaultKey());
    const vault = vaultFixture();

    const envelope = await sealProfileVault(vault, key, 1);
    expect(envelope.version).toBe(1);

    const reopened = await openProfileVault(envelope, key);
    expect(reopened).toEqual(vault);
    expect(reopened.profiles[0]?.personal.firstName).toBe('Ada');
  });

  it('writes format byte 2 and no salt', async () => {
    const sealed = await sealBlob(VAULT_MAGIC, rawKeyMaterial(generateVaultKey()), 'hello');
    const bytes = base64ToBytes(sealed.ciphertext);
    expect(bytes[4]).toBe(FORMAT_RAW_KEY);
    expect(bytes[5]).toBe(0);
    expect(hasSealedHeader(sealed.ciphertext, VAULT_MAGIC)).toBe(true);
  });

  it('fails to open under a different key', async () => {
    const sealed = await sealBlob(VAULT_MAGIC, rawKeyMaterial(generateVaultKey()), 'secret');
    await expect(
      openBlob(VAULT_MAGIC, rawKeyMaterial(generateVaultKey()), sealed),
    ).rejects.toMatchObject({ code: 'decrypt-failed' });
  });

  it('refuses a passphrase against a raw-key envelope', async () => {
    const sealed = await sealBlob(VAULT_MAGIC, rawKeyMaterial(generateVaultKey()), 'secret');
    await expect(
      openBlob(VAULT_MAGIC, passphraseMaterial('correct horse battery'), sealed),
    ).rejects.toMatchObject({ code: 'bad-format' });
  });
});

describe('passphrase envelopes (format 1 — legacy, still readable)', () => {
  it('round-trips and carries a salt', async () => {
    const material = passphraseMaterial('correct horse battery staple');
    const sealed = await sealBlob(VAULT_MAGIC, material, 'legacy payload', FAST_ITERATIONS);

    const bytes = base64ToBytes(sealed.ciphertext);
    expect(bytes[4]).toBe(FORMAT_PBKDF2);
    expect(bytes[5]).toBe(16);

    await expect(openBlob(VAULT_MAGIC, material, sealed, FAST_ITERATIONS)).resolves.toBe(
      'legacy payload',
    );
  });

  it('rejects a passphrase under the length floor before touching crypto', async () => {
    await expect(sealBlob(VAULT_MAGIC, passphraseMaterial('short'), 'x')).rejects.toMatchObject({
      code: 'passphrase-weak',
    });
  });
});

describe('envelope integrity', () => {
  it('rejects a blob sealed under a different magic', async () => {
    const key = rawKeyMaterial(generateVaultKey());
    const sealed = await sealBlob(DEVICE_TOKEN_MAGIC, key, 'a device token');
    await expect(openBlob(VAULT_MAGIC, key, sealed)).rejects.toMatchObject({ code: 'bad-format' });
    expect(hasSealedHeader(sealed.ciphertext, VAULT_MAGIC)).toBe(false);
    expect(hasSealedHeader(sealed.ciphertext, DEVICE_TOKEN_MAGIC)).toBe(true);
  });

  it('detects a flipped ciphertext byte', async () => {
    const key = rawKeyMaterial(generateVaultKey());
    const sealed = await sealBlob(VAULT_MAGIC, key, 'tamper me');

    const bytes = base64ToBytes(sealed.ciphertext);
    const last = bytes.length - 1;
    bytes[last] = (bytes[last] ?? 0) ^ 0xff;
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);

    await expect(
      openBlob(VAULT_MAGIC, key, { ciphertext: btoa(binary), nonce: sealed.nonce }),
    ).rejects.toMatchObject({ code: 'decrypt-failed' });
  });

  it('rejects plaintext masquerading as an envelope', () => {
    expect(hasSealedHeader(btoa(JSON.stringify({ firstName: 'Ada' })), VAULT_MAGIC)).toBe(false);
    expect(hasSealedHeader('', VAULT_MAGIC)).toBe(false);
  });

  it('rejects a vault payload that is valid JSON but the wrong shape', async () => {
    const key = rawKeyMaterial(generateVaultKey());
    const sealed = await sealBlob(VAULT_MAGIC, key, JSON.stringify({ nope: true }));
    await expect(openProfileVault(sealed, key)).rejects.toMatchObject({ code: 'bad-payload' });
  });
});
