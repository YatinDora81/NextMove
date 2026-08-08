/**
 * tests/unit/crypto.test.ts — JF-001 Rev 3.0 SEC 11 (Unit · "crypto round-trips").
 *
 * `platform/crypto.ts` is the vault's WebCrypto layer (SEC 5.3, SEC 9.2). Three properties are
 * non-negotiable and each of them is a security property, not a nicety:
 *
 *   ROUND-TRIP.   What goes in comes out, byte for byte, including Unicode and long payloads.
 *
 *   FRESH IV.     A 12-byte random nonce on EVERY encryption. GCM nonce reuse under the same key
 *                 is catastrophic — it leaks the XOR of two plaintexts and the authentication
 *                 subkey. The test encrypts the SAME plaintext repeatedly and asserts every IV is
 *                 distinct; that is the only observable that proves a counter or a constant has
 *                 not crept in.
 *
 *   AUTHENTICATED. A tampered ciphertext, a tampered IV or a truncated blob must FAIL, loudly, as
 *                 `VaultDecryptError`. GCM's tag is the only thing standing between a modified
 *                 `jf.keys` record and a silently corrupted API key.
 *
 * INV-5 is also asserted here in the only way a unit test can: the error thrown on failure must
 * not echo the ciphertext or any key material back to the caller.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  VaultDecryptError,
  decryptJson,
  decryptString,
  destroyVaultMaterial,
  encryptJson,
  encryptString,
  fromBase64,
  getVaultMode,
  randomId,
  randomUuid,
  resetVaultCache,
  toBase64,
} from '@/platform/crypto';
import { VAULT_IV_BYTES, VAULT_SECRET_KEY } from '@/shared/constants';

import { ensureWebCrypto, installBrowserMock, resetBrowserMock } from '../setup';

beforeAll(() => {
  ensureWebCrypto();
  installBrowserMock();
});

beforeEach(() => {
  resetBrowserMock();
  resetVaultCache();
});

/* ------------------------------------------------------------------------------------------------
 * base64 plumbing
 * ---------------------------------------------------------------------------------------------- */

describe('base64', () => {
  it('round-trips arbitrary bytes, including 0x00 and 0xff', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 254, 255, 0, 42]);
    expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
  });

  it('round-trips an empty array', () => {
    expect(toBase64(new Uint8Array(0))).toBe('');
    expect(fromBase64('').length).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------------------
 * SEC 5.3 — AES-256-GCM round trip
 * ---------------------------------------------------------------------------------------------- */

describe('AES-GCM round trip', () => {
  it('starts in install-secret mode and materialises the vault lazily', async () => {
    const browserMock = installBrowserMock();
    expect(browserMock.__store[VAULT_SECRET_KEY]).toBeUndefined();

    expect(await getVaultMode()).toBe('install');
    expect(browserMock.__store[VAULT_SECRET_KEY]).toBeDefined();
  });

  it('decrypts what it encrypted', async () => {
    const plaintext = 'AIzaSy-not-a-real-key-0000000000000000';
    const sealed = await encryptString(plaintext);

    expect(sealed.ct.length).toBeGreaterThan(0);
    expect(sealed.iv.length).toBeGreaterThan(0);
    // The ciphertext must not contain the plaintext in any obvious form.
    expect(sealed.ct).not.toContain(plaintext);

    expect(await decryptString(sealed)).toBe(plaintext);
  });

  it('survives Unicode, newlines and a long payload', async () => {
    const cases = [
      '',
      'a',
      'Aşha Varmā — नमस्ते — 🙂',
      'line one\nline two\r\nline three\t tabbed',
      'x'.repeat(64_000),
    ];
    for (const plaintext of cases) {
      expect(await decryptString(await encryptString(plaintext))).toBe(plaintext);
    }
  });

  it('round-trips JSON through encryptJson / decryptJson', async () => {
    const value = { id: 'prof_1', nested: { list: [1, 2, 3], flag: true }, nil: null };
    expect(await decryptJson(await encryptJson(value))).toEqual(value);
  });

  it('uses a 12-byte IV, as SEC 5.3 specifies', async () => {
    const sealed = await encryptString('anything');
    expect(fromBase64(sealed.iv).length).toBe(VAULT_IV_BYTES);
  });
});

/* ------------------------------------------------------------------------------------------------
 * A FRESH IV ON EVERY ENCRYPTION
 * ---------------------------------------------------------------------------------------------- */

describe('IV freshness — GCM nonce reuse is catastrophic', () => {
  it('encrypting the SAME plaintext twice produces different IVs and different ciphertexts', async () => {
    const plaintext = 'the same secret, encrypted twice';
    const a = await encryptString(plaintext);
    const b = await encryptString(plaintext);

    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);

    // Both still open to the same plaintext — the difference is nonce, not content.
    expect(await decryptString(a)).toBe(plaintext);
    expect(await decryptString(b)).toBe(plaintext);
  });

  it('every IV across many encryptions of one plaintext is unique', async () => {
    const runs = 40;
    const ivs = new Set<string>();
    const cts = new Set<string>();
    for (let i = 0; i < runs; i += 1) {
      const sealed = await encryptString('constant plaintext');
      ivs.add(sealed.iv);
      cts.add(sealed.ct);
    }
    expect(ivs.size).toBe(runs);
    expect(cts.size).toBe(runs);
  });

  it('randomId / randomUuid do not repeat either (they become Dexie primary keys)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i += 1) ids.add(randomId('prof'));
    expect(ids.size).toBe(200);
    expect([...ids][0]).toMatch(/^prof_[0-9a-f]{18}$/);

    const uuids = new Set<string>();
    for (let i = 0; i < 200; i += 1) uuids.add(randomUuid());
    expect(uuids.size).toBe(200);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Authentication — a tampered blob must not open
 * ---------------------------------------------------------------------------------------------- */

describe('tamper detection', () => {
  /** Flip one bit of a base64 payload, keeping it valid base64. */
  function flipOneBit(b64: string): string {
    const bytes = fromBase64(b64);
    const first = bytes[0];
    if (first === undefined) throw new Error('cannot tamper with an empty payload');
    bytes[0] = first ^ 0x01;
    return toBase64(bytes);
  }

  it('a flipped ciphertext bit fails to decrypt', async () => {
    const sealed = await encryptString('do not modify me');
    const tampered = { ...sealed, ct: flipOneBit(sealed.ct) };
    await expect(decryptString(tampered)).rejects.toBeInstanceOf(VaultDecryptError);
  });

  it('a flipped IV bit fails to decrypt', async () => {
    const sealed = await encryptString('do not modify me');
    const tampered = { ...sealed, iv: flipOneBit(sealed.iv) };
    await expect(decryptString(tampered)).rejects.toBeInstanceOf(VaultDecryptError);
  });

  it('a truncated ciphertext (auth tag removed) fails to decrypt', async () => {
    const sealed = await encryptString('do not modify me');
    const bytes = fromBase64(sealed.ct);
    const truncated = toBase64(bytes.slice(0, Math.max(1, bytes.length - 4)));
    await expect(decryptString({ ...sealed, ct: truncated })).rejects.toBeInstanceOf(
      VaultDecryptError,
    );
  });

  it('a wrong-length IV is rejected before WebCrypto is even asked', async () => {
    const sealed = await encryptString('do not modify me');
    const shortIv = toBase64(fromBase64(sealed.iv).slice(0, 8));
    await expect(decryptString({ ...sealed, iv: shortIv })).rejects.toThrow(/IV length/i);
  });

  it('a malformed envelope is rejected by the schema, not by the cipher', async () => {
    await expect(
      decryptString({ ct: '', iv: '' } as unknown as { ct: string; iv: string }),
    ).rejects.toThrow(/malformed sealed envelope/i);
  });

  it('a ciphertext sealed under a DIFFERENT install secret does not open (INV-5)', async () => {
    const sealed = await encryptString('key material from another device');

    // Simulate a different install: shred the material and let a fresh one be generated.
    await destroyVaultMaterial();
    resetVaultCache();
    await getVaultMode(); // forces a brand-new secret + salt

    await expect(decryptString(sealed)).rejects.toBeInstanceOf(VaultDecryptError);
  });

  it('the failure message never echoes the ciphertext or the key (INV-5)', async () => {
    const plaintext = 'AIzaSy-super-secret-0000000000000000000';
    const sealed = await encryptString(plaintext);
    const tampered = { ...sealed, ct: flipOneBit(sealed.ct) };

    await expect(decryptString(tampered)).rejects.toSatisfy((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return (
        !message.includes(plaintext) && !message.includes(sealed.ct) && !message.includes(sealed.iv)
      );
    });
  });

  it('decryptJson rejects a payload that decrypts to non-JSON', async () => {
    const sealed = await encryptString('this is definitely not json');
    await expect(decryptJson(sealed)).rejects.toThrow(/not valid JSON/i);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Material lifecycle
 * ---------------------------------------------------------------------------------------------- */

describe('vault material', () => {
  it('is generated once and then reused — the same key opens every record', async () => {
    const browserMock = installBrowserMock();
    const first = await encryptString('one');
    const materialAfterFirst = JSON.stringify(browserMock.__store[VAULT_SECRET_KEY]);

    const second = await encryptString('two');
    expect(JSON.stringify(browserMock.__store[VAULT_SECRET_KEY])).toBe(materialAfterFirst);

    expect(await decryptString(first)).toBe('one');
    expect(await decryptString(second)).toBe('two');
  });

  it('destroyVaultMaterial shreds the key — SEC 5.3 "delete is instant and shreds ciphertext"', async () => {
    const browserMock = installBrowserMock();
    await encryptString('doomed');
    expect(browserMock.__store[VAULT_SECRET_KEY]).toBeDefined();

    await destroyVaultMaterial();
    expect(browserMock.__store[VAULT_SECRET_KEY]).toBeUndefined();
  });
});
