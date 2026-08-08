/**
 * tests/unit/gesture.test.ts — JF-001 Rev 3.0 SEC 11 (Unit) · INV-2.
 *
 * INV-2: "AI is on-demand only. Every AI_* / RESUME_PARSE bus message must carry a fresh
 * user-gesture nonce (5s TTL). No background/speculative Gemini traffic, ever."
 *
 * `platform/gesture.ts` is the single gate in front of every Gemini request, so the four
 * properties below ARE the invariant:
 *
 *   1. a freshly minted token is accepted exactly ONCE;
 *   2. replaying it fails (it was burned on first use);
 *   3. a token older than GESTURE_TTL_MS (5s) fails;
 *   4. a token nobody minted fails — including empty, null and malformed input.
 *
 * Every function takes `now` explicitly, so expiry is tested by arithmetic rather than by
 * sleeping. That is deliberate: a timing-dependent test of a security gate is a test that gets
 * quarantined the first time CI is slow, and then the gate is untested.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  consumeGesture,
  mintGesture,
  outstandingGestures,
  resetGestures,
} from '@/platform/gesture';
import { GESTURE_TTL_MS } from '@/shared/constants';
import { GESTURE_REQUIRED, MESSAGE_TYPES } from '@/shared/messages';

import { ensureWebCrypto } from '../setup';

beforeAll(() => {
  ensureWebCrypto();
});

beforeEach(() => {
  resetGestures();
});

const T0 = 1_767_225_600_000; // a fixed epoch so every assertion is arithmetic, not wall-clock

describe('INV-2 · a valid token is accepted exactly once', () => {
  it('mints a token with a 5-second expiry', () => {
    const grant = mintGesture('generate-answer', T0);
    expect(grant.gesture).toMatch(/^jfg\.\d+\.[0-9a-f]{32}$/);
    expect(grant.expiresAt).toBe(T0 + GESTURE_TTL_MS);
    expect(outstandingGestures(T0)).toBe(1);
  });

  it('accepts the token once and burns it', () => {
    const { gesture } = mintGesture('generate-answer', T0);
    expect(consumeGesture(gesture, T0 + 100)).toBe(true);
    expect(outstandingGestures(T0 + 100)).toBe(0);
  });

  it('REPLAY fails — the second presentation is indistinguishable from a forgery', () => {
    const { gesture } = mintGesture('generate-cover', T0);
    expect(consumeGesture(gesture, T0 + 1)).toBe(true);
    expect(consumeGesture(gesture, T0 + 2)).toBe(false);
    expect(consumeGesture(gesture, T0 + 3)).toBe(false);
  });

  it('two mints are independent — burning one leaves the other usable', () => {
    const a = mintGesture('a', T0);
    const b = mintGesture('b', T0);
    expect(a.gesture).not.toBe(b.gesture);

    expect(consumeGesture(a.gesture, T0 + 10)).toBe(true);
    expect(consumeGesture(b.gesture, T0 + 10)).toBe(true);
  });

  it('mints unique nonces under repetition', () => {
    const tokens = new Set<string>();
    // MAX_OUTSTANDING is 32, so mint in bursts that are consumed immediately.
    for (let i = 0; i < 200; i += 1) {
      const { gesture } = mintGesture('burst', T0 + i);
      tokens.add(gesture);
      expect(consumeGesture(gesture, T0 + i)).toBe(true);
    }
    expect(tokens.size).toBe(200);
  });
});

describe('INV-2 · expiry after 5 seconds', () => {
  it('is still valid one millisecond before the deadline', () => {
    const { gesture } = mintGesture('generate-answer', T0);
    expect(consumeGesture(gesture, T0 + GESTURE_TTL_MS - 1)).toBe(true);
  });

  it('is refused exactly ON the deadline — the window is half-open', () => {
    const { gesture } = mintGesture('generate-answer', T0);
    expect(consumeGesture(gesture, T0 + GESTURE_TTL_MS)).toBe(false);
  });

  it('is refused after the deadline', () => {
    const { gesture } = mintGesture('generate-answer', T0);
    expect(consumeGesture(gesture, T0 + GESTURE_TTL_MS + 1)).toBe(false);
    expect(consumeGesture(gesture, T0 + 60_000)).toBe(false);
  });

  it('an expired token is swept out of memory rather than accumulating', () => {
    mintGesture('one', T0);
    mintGesture('two', T0);
    expect(outstandingGestures(T0)).toBe(2);
    expect(outstandingGestures(T0 + GESTURE_TTL_MS + 1)).toBe(0);
  });
});

describe('INV-2 · an unknown token fails', () => {
  const bogus: ReadonlyArray<string | null | undefined> = [
    '',
    'jfg.1.deadbeef',
    'jfg.999.00000000000000000000000000000000',
    'not-a-token',
    '{"gesture":"jfg.1.x"}',
    null,
    undefined,
  ];

  for (const token of bogus) {
    it(`refuses ${JSON.stringify(token)}`, () => {
      mintGesture('unrelated', T0); // a valid token exists; it must not help the forgery
      expect(consumeGesture(token, T0 + 1)).toBe(false);
    });
  }

  it('refuses a token minted before a worker restart (nothing is persisted)', () => {
    const { gesture } = mintGesture('generate-answer', T0);
    resetGestures(); // ≈ the service worker being torn down and re-spawned
    expect(consumeGesture(gesture, T0 + 1)).toBe(false);
  });

  it('caps the outstanding pool so a flood cannot exhaust memory', () => {
    for (let i = 0; i < 100; i += 1) mintGesture(`flood-${i}`, T0);
    expect(outstandingGestures(T0)).toBeLessThanOrEqual(32);
  });
});

/* ------------------------------------------------------------------------------------------------
 * The gated message set (SEC 6.6)
 * ---------------------------------------------------------------------------------------------- */

describe('SEC 6.6 · GESTURE_REQUIRED is exactly the AI set', () => {
  it('contains every AI_* message and RESUME_PARSE, and nothing else', () => {
    expect([...GESTURE_REQUIRED].sort()).toEqual(
      ['AI_DISAMBIGUATE', 'AI_GENERATE_ANSWER', 'AI_GENERATE_COVER', 'RESUME_PARSE'].sort(),
    );
  });

  it('every gated type is a real message type', () => {
    for (const type of GESTURE_REQUIRED) {
      expect(MESSAGE_TYPES).toContain(type);
    }
  });

  it('the offline answer-bank lookup is deliberately NOT gated (SEC 5.7 costs no quota)', () => {
    expect(GESTURE_REQUIRED.has('ANSWERS_LOOKUP')).toBe(false);
    expect(GESTURE_REQUIRED.has('ANSWERS_SAVE')).toBe(false);
    expect(GESTURE_REQUIRED.has('FILL_REQUEST')).toBe(false);
  });
});
