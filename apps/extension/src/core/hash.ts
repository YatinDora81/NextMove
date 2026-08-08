/**
 * core/hash.ts — a compact, synchronous SHA-1 over a UTF-8 string.
 *
 * Implements JF-001 Rev 3.0 SEC 6.2: `FieldSignature.hash = sha1(normalized signature)`.
 * That hash is the primary key of the learn-from-correction store (F-13 / SEC 7.3:
 * `jf.mappings = { [domain]: { [sigHash]: ProfilePath } }`), so it must be:
 *
 *   1. SYNCHRONOUS. `FormScanner.scan()` and `FieldMatcher.match()` run inside a single
 *      animation-frame-ish budget on a live DOM; `crypto.subtle.digest` is Promise-based and
 *      would force the whole scan/match pipeline to become async for no benefit.
 *   2. DEPENDENCY-FREE. `apps/extension` may only import `@repo/types` / `@repo/rotation`
 *      (SEC 14.1 R-3), and no hashing dependency is in the §3 manifest.
 *   3. STABLE FOREVER. A different digest for the same field means every saved user mapping
 *      silently stops applying. This file therefore contains a textbook FIPS 180-4 SHA-1 with
 *      no "improvements".
 *
 * SHA-1 is used here as a *content fingerprint*, never as a security primitive: nothing about
 * JobFill's threat model depends on collision resistance. Key material is handled by
 * AES-256-GCM in `platform/crypto` (SEC 5.3) and never touches this file.
 *
 * Standard test vectors (FIPS 180-2 / RFC 3174) — all three are asserted by
 * `tests/unit/hash.test.ts` and are reproduced here so a regression is obvious on sight:
 *
 *   sha1("")                                                       =
 *     da39a3ee5e6b4b0d3255bfef95601890afd80709
 *   sha1("abc")                                                    =
 *     a9993e364706816aba3e25717850c26c9cd0d89d
 *   sha1("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq") =
 *     84983e441c3bd26ebaae4aa1f95129e5e54670f1
 *   sha1("a".repeat(1_000_000))                                    =
 *     34aa973cd4c4daa4f61eeb2bdbad27316534016f
 *   sha1("The quick brown fox jumps over the lazy dog")            =
 *     2fd4e1c67a2d28fced849ee1bb76e7391b93eb12
 */

/* ------------------------------------------------------------------------------------------------
 * UTF-8
 * ---------------------------------------------------------------------------------------------- */

/**
 * Encode a JavaScript string (UTF-16, possibly with surrogate pairs) as UTF-8 bytes.
 *
 * Written by hand rather than via `TextEncoder` so the digest is identical in every context the
 * extension runs in — content script, MAIN world, service worker, options page and the
 * happy-dom test environment — with no reliance on a global that a hardened page could shadow.
 * Lone surrogates are emitted as U+FFFD, matching `TextEncoder`'s WHATWG behaviour.
 */
export function utf8Bytes(input: string): Uint8Array {
  const out = new Uint8Array(input.length * 3 + 3);
  let n = 0;

  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);

    if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate — pair it with the following low surrogate if there is one.
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      } else {
        code = 0xfffd; // lone high surrogate
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd; // lone low surrogate
    }

    if (code < 0x80) {
      out[n++] = code;
    } else if (code < 0x800) {
      out[n++] = 0xc0 | (code >> 6);
      out[n++] = 0x80 | (code & 0x3f);
    } else if (code < 0x10000) {
      out[n++] = 0xe0 | (code >> 12);
      out[n++] = 0x80 | ((code >> 6) & 0x3f);
      out[n++] = 0x80 | (code & 0x3f);
    } else {
      out[n++] = 0xf0 | (code >> 18);
      out[n++] = 0x80 | ((code >> 12) & 0x3f);
      out[n++] = 0x80 | ((code >> 6) & 0x3f);
      out[n++] = 0x80 | (code & 0x3f);
    }
  }

  return out.subarray(0, n);
}

/* ------------------------------------------------------------------------------------------------
 * SHA-1 (FIPS 180-4, §6.1.2)
 * ---------------------------------------------------------------------------------------------- */

const K0 = 0x5a827999;
const K1 = 0x6ed9eba1;
const K2 = 0x8f1bbcdc;
const K3 = 0xca62c1d6;

/** Left-rotate a 32-bit word. */
function rotl(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

/** Render a 32-bit word as 8 lowercase hex digits. */
function word2hex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

/** SHA-1 over raw bytes. Returns 40 lowercase hex characters. */
export function sha1Bytes(bytes: Uint8Array): string {
  const byteLength = bytes.length;
  const bitLength = byteLength * 8;

  // Pad: message ‖ 0x80 ‖ 0x00* ‖ 64-bit big-endian bit length, to a multiple of 64 bytes.
  const blockCount = Math.floor((byteLength + 8) / 64) + 1;
  const totalBytes = blockCount * 64;
  const padded = new Uint8Array(totalBytes);
  padded.set(bytes, 0);
  padded[byteLength] = 0x80;

  // 64-bit length. Split across two 32-bit halves so lengths ≥ 512 MB still encode correctly.
  const lenHi = Math.floor(bitLength / 0x100000000);
  const lenLo = bitLength >>> 0;
  padded[totalBytes - 8] = (lenHi >>> 24) & 0xff;
  padded[totalBytes - 7] = (lenHi >>> 16) & 0xff;
  padded[totalBytes - 6] = (lenHi >>> 8) & 0xff;
  padded[totalBytes - 5] = lenHi & 0xff;
  padded[totalBytes - 4] = (lenLo >>> 24) & 0xff;
  padded[totalBytes - 3] = (lenLo >>> 16) & 0xff;
  padded[totalBytes - 2] = (lenLo >>> 8) & 0xff;
  padded[totalBytes - 1] = lenLo & 0xff;

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Int32Array(80);

  for (let block = 0; block < blockCount; block++) {
    const base = block * 64;

    for (let t = 0; t < 16; t++) {
      const p = base + t * 4;
      // `?? 0` satisfies noUncheckedIndexedAccess; `padded` is exactly `totalBytes` long so
      // every index touched here is provably in range.
      w[t] =
        ((padded[p] ?? 0) << 24) |
        ((padded[p + 1] ?? 0) << 16) |
        ((padded[p + 2] ?? 0) << 8) |
        (padded[p + 3] ?? 0);
    }
    for (let t = 16; t < 80; t++) {
      w[t] = rotl((w[t - 3] ?? 0) ^ (w[t - 8] ?? 0) ^ (w[t - 14] ?? 0) ^ (w[t - 16] ?? 0), 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let t = 0; t < 80; t++) {
      let f: number;
      let k: number;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = K0;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = K1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = K2;
      } else {
        f = b ^ c ^ d;
        k = K3;
      }

      // Every addend is < 2^32, so the sum is < 2^35 — exact in a float64 before `| 0` wraps it.
      const temp = (rotl(a, 5) + f + e + k + (w[t] ?? 0)) | 0;
      // FIPS 180-4 §6.1.2 step 3: E←D, D←C, C←ROTL30(B), B←A, A←TEMP.
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  return word2hex(h0) + word2hex(h1) + word2hex(h2) + word2hex(h3) + word2hex(h4);
}

/**
 * SHA-1 of a UTF-8 string. 40 lowercase hex characters, synchronous, allocation-light.
 * This is the function SEC 6.2 means by `sha1(normalized signature)`.
 */
export function sha1(input: string): string {
  return sha1Bytes(utf8Bytes(input));
}

/**
 * First `length` hex characters of `sha1(input)`. Handy for log lines and overlay debug chips —
 * never for anything persisted, because `jf.mappings` keys are full-length digests.
 */
export function sha1Short(input: string, length = 12): string {
  const clamped = Math.max(1, Math.min(40, Math.trunc(length)));
  return sha1(input).slice(0, clamped);
}

/**
 * The published test vectors, exported so the unit suite (and anyone debugging a mapping-key
 * drift) can assert against the same table this file documents.
 */
export const SHA1_TEST_VECTORS: ReadonlyArray<{ input: string; digest: string }> = [
  { input: '', digest: 'da39a3ee5e6b4b0d3255bfef95601890afd80709' },
  { input: 'abc', digest: 'a9993e364706816aba3e25717850c26c9cd0d89d' },
  {
    input: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    digest: '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
  },
  {
    input: 'The quick brown fox jumps over the lazy dog',
    digest: '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12',
  },
];

/** Self-check helper: `true` when every vector in {@link SHA1_TEST_VECTORS} reproduces. */
export function sha1SelfTest(): boolean {
  return SHA1_TEST_VECTORS.every((vector) => sha1(vector.input) === vector.digest);
}
