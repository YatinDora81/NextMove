/**
 * platform/gesture.ts — INV-2 enforcement (JF-001 Rev 3.0 SEC 6.6, SEC 9.2).
 *
 * INV-2: "AI is on-demand only. Every AI_* / RESUME_PARSE bus message must carry a fresh
 * user-gesture nonce (5s TTL). No background/speculative Gemini traffic, ever."
 *
 * How it works:
 *   - Trusted extension UI (popup, options page, the shadow-DOM overlay injected by the content
 *     script) calls `GESTURE_MINT` from inside a real user-gesture handler. The router forwards
 *     that to `mintGesture()`.
 *   - `mintGesture()` returns `monotonicCounter + random nonce`, remembered ONLY in
 *     service-worker memory with a GESTURE_TTL_MS (5s) expiry. Nothing is persisted: a token
 *     cannot survive a worker restart, and it cannot be replayed from disk.
 *   - `consumeGesture(token)` verifies **and burns** it. Single use. Expired, replayed, unknown,
 *     malformed, or empty → `false`, always. There is no "peek" that leaves a token usable.
 *
 * A compromised page script therefore cannot spawn a quiet, key-spending Gemini call: it has no
 * way to obtain an unburned nonce, and the MAIN-world script has no extension messaging at all.
 *
 * Memory only, on purpose. Persisting a gesture would let it outlive the click that justified it,
 * which is exactly the thing INV-2 forbids.
 */

import { GESTURE_NONCE_BYTES, GESTURE_TTL_MS } from '@/shared/constants';
import { createLogger } from '@/platform/logger';

const log = createLogger('gesture');

/** Prefix so a token is recognisable in a stack trace without revealing anything useful. */
const TOKEN_PREFIX = 'jfg';

/**
 * Hard ceiling on outstanding tokens. A trusted UI mints one per click; anything approaching this
 * is a bug or an attempt to flood the map, so the oldest are evicted first.
 */
const MAX_OUTSTANDING = 32;

interface GestureEntry {
  /** Monotonic mint order — also the eviction order. */
  seq: number;
  expiresAt: number;
  reason: string;
}

/** What a caller gets back from `mintGesture` — the token plus when it dies. */
export interface GestureGrant {
  gesture: string;
  expiresAt: number;
}

const outstanding = new Map<string, GestureEntry>();
let counter = 0;

function randomNonce(): string {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues is unavailable — cannot mint a gesture nonce');
  }
  const bytes = c.getRandomValues(new Uint8Array(GESTURE_NONCE_BYTES));
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte === undefined) continue;
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

function sweep(now: number): void {
  for (const [token, entry] of outstanding) {
    if (entry.expiresAt <= now) outstanding.delete(token);
  }
}

function evictOldest(): void {
  let oldestToken: string | null = null;
  let oldestSeq = Number.POSITIVE_INFINITY;
  for (const [token, entry] of outstanding) {
    if (entry.seq < oldestSeq) {
      oldestSeq = entry.seq;
      oldestToken = token;
    }
  }
  if (oldestToken !== null) outstanding.delete(oldestToken);
}

/**
 * Mint a single-use gesture token. Called ONLY from the `GESTURE_MINT` bus handler, which the
 * router refuses for untrusted origins — see `platform/bus.ts`.
 *
 * @param reason short, non-sensitive label ("generate-answer", "test-key") kept for diagnostics.
 */
export function mintGesture(reason: string, now: number = Date.now()): GestureGrant {
  sweep(now);
  if (outstanding.size >= MAX_OUTSTANDING) {
    log.warn('gesture pool full — evicting the oldest outstanding token');
    evictOldest();
  }

  counter += 1;
  const gesture = `${TOKEN_PREFIX}.${counter}.${randomNonce()}`;
  const expiresAt = now + GESTURE_TTL_MS;
  outstanding.set(gesture, { seq: counter, expiresAt, reason: reason.slice(0, 64) });
  return { gesture, expiresAt };
}

/**
 * Verify **and burn** a gesture token. INV-2: this is the single gate in front of every Gemini
 * request. Returns true exactly once per minted token, and only inside its 5s window.
 */
export function consumeGesture(token: string | null | undefined, now: number = Date.now()): boolean {
  if (typeof token !== 'string' || token.length === 0) return false;
  sweep(now);

  const entry = outstanding.get(token);
  if (!entry) {
    // Unknown or already burned — a replay looks exactly like a stale token, and both are refused.
    return false;
  }
  // Burn first: even if the caller throws later, the token is spent.
  outstanding.delete(token);
  if (entry.expiresAt <= now) return false;
  return true;
}

/** Diagnostics only: how many unburned, unexpired tokens exist right now. */
export function outstandingGestures(now: number = Date.now()): number {
  sweep(now);
  return outstanding.size;
}

/** Drop every outstanding token — used on sign-out/unpair and by tests. */
export function resetGestures(): void {
  outstanding.clear();
  counter = 0;
}
