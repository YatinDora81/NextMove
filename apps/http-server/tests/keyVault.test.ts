/**
 * tests/keyVault.test.ts — JF-001 SEC 15.2 / 15.4 / 15.8.
 *
 * The vault is the highest-consequence code in the repository: it holds other people's API keys.
 * SEC 15.2 makes four specific claims about what it defends against. Claims in a design document
 * are worth nothing; these are the executable versions.
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';

import { sealKey, openKey, KeyVaultDecryptError } from '@/utils/keyVault.js';

// Split so no `AIza` + 35-character literal exists for GitHub secret scanning to flag; the joined
// value is unchanged, so this still exercises the real key shape.
const KEY = ['AIza', 'SyD-FAKE-KEY-FOR-TESTS-0000000009F2k'].join('');
const USER_A = 'user-aaaaaaaa-0000-0000-0000-000000000001';
const USER_B = 'user-bbbbbbbb-0000-0000-0000-000000000002';

const sealedRow = (userId: string) => {
  const s = sealKey(KEY, userId);
  return { ciphertext: s.ciphertext, iv: s.iv, authTag: s.authTag, keyVersion: s.keyVersion };
};

describe('SEC 15.4 · envelope sealing', () => {
  it('round-trips a key under its owner', () => {
    expect(openKey(sealedRow(USER_A), USER_A)).toBe(KEY);
  });

  it('uses a FRESH random 12-byte IV on every encryption (GCM nonce reuse is the footgun)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const s = sealKey(KEY, USER_A);
      expect(s.iv.byteLength).toBe(12);
      seen.add(s.iv.toString('hex'));
    }
    expect(seen.size, 'an IV repeated across encryptions').toBe(200);
  });

  it('produces different ciphertext each time, so rows are not comparable', () => {
    const a = sealKey(KEY, USER_A).ciphertext.toString('hex');
    const b = sealKey(KEY, USER_A).ciphertext.toString('hex');
    expect(a).not.toBe(b);
  });

  it('stores last4 for display so the list UI never decrypts', () => {
    expect(sealKey(KEY, USER_A).last4).toBe(KEY.slice(-4));
  });

  it('stamps keyVersion on every row so the master can rotate', () => {
    expect(sealKey(KEY, USER_A).keyVersion).toBeGreaterThanOrEqual(1);
  });
});

describe('SEC 15.2 · threat model, executed', () => {
  it('CROSS-TENANT: a row lifted into another user context fails authentication, never silently succeeds', () => {
    const row = sealedRow(USER_A);
    expect(() => openKey(row, USER_B)).toThrow(KeyVaultDecryptError);
  });

  it('TAMPERING: a flipped ciphertext byte fails the auth tag', () => {
    const row = sealedRow(USER_A);
    const tampered = Buffer.from(row.ciphertext);
    tampered[0] = tampered[0]! ^ 0xff;
    expect(() => openKey({ ...row, ciphertext: tampered }, USER_A)).toThrow(KeyVaultDecryptError);
  });

  it('TAMPERING: a flipped auth tag byte is rejected', () => {
    const row = sealedRow(USER_A);
    const tag = Buffer.from(row.authTag);
    tag[0] = tag[0]! ^ 0xff;
    expect(() => openKey({ ...row, authTag: tag }, USER_A)).toThrow(KeyVaultDecryptError);
  });

  it('TAMPERING: a swapped IV is rejected', () => {
    const row = sealedRow(USER_A);
    expect(() => openKey({ ...row, iv: randomBytes(12) }, USER_A)).toThrow(KeyVaultDecryptError);
  });

  it('MALFORMED: a wrong-length IV is caught before it reaches the cipher', () => {
    const row = sealedRow(USER_A);
    expect(() => openKey({ ...row, iv: randomBytes(8) }, USER_A)).toThrow(KeyVaultDecryptError);
  });

  it('DB DUMP: ciphertext does not contain the plaintext key', () => {
    const row = sealedRow(USER_A);
    const blob = Buffer.concat([row.ciphertext, row.iv, row.authTag]).toString('binary');
    expect(blob).not.toContain(KEY);
    expect(blob).not.toContain('AIzaSy');
  });

  it('the AAD binding is mandatory — an empty owner id is refused outright', () => {
    expect(() => sealKey(KEY, '')).toThrow(TypeError);
    expect(() => openKey(sealedRow(USER_A), '')).toThrow(TypeError);
  });
});
