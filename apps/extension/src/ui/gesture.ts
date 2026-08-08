/**
 * ui/gesture.ts — INV-2 at the UI boundary.
 *
 * "Every `AI_*` / `RESUME_PARSE` bus message must carry a fresh user-gesture nonce (5s TTL). No
 *  background/speculative Gemini traffic, ever."
 *
 * The nonce is minted by the service worker (`GESTURE_MINT`) and burned by the bus router on first
 * use. This module exists so that no panel ever hand-rolls that dance — and so the 5-second TTL is
 * respected by construction: `withGesture` mints *inside* the click handler and sends immediately,
 * never caching a token across renders or awaits it does not control.
 *
 * `GESTURE_MINT` is refused by the router from any origin that is not trusted extension UI, so the
 * popup and the Options page are the only surfaces where this can succeed.
 */

import { sendMessage } from '@/platform/bus';

export class GestureDeniedError extends Error {
  constructor(reason: string, detail: string) {
    super(`Could not confirm the "${reason}" action: ${detail}`);
    this.name = 'GestureDeniedError';
    Object.setPrototypeOf(this, GestureDeniedError.prototype);
  }
}

/**
 * Mint a single-use nonce. Call this from inside a real user-gesture handler and spend it
 * immediately — it dies in 5 seconds (`GESTURE_TTL_MS`) and burns on first use.
 */
export async function mintGesture(reason: string): Promise<string> {
  const reply = await sendMessage('GESTURE_MINT', { reason });
  if (!reply.ok) throw new GestureDeniedError(reason, reply.error.message);
  return reply.data.gesture;
}

/**
 * Mint a nonce and hand it to `run` in one step.
 *
 * ```ts
 * const reply = await withGesture('build profile with Gemini', (gesture) =>
 *   sendMessage('RESUME_PARSE', { resumeId }, gesture),
 * );
 * ```
 *
 * Nothing may sit between the mint and the send: no confirmation dialog, no extra `await` on
 * unrelated work. If a flow needs the user to confirm something first, confirm *then* call this.
 */
export async function withGesture<T>(
  reason: string,
  run: (gesture: string) => Promise<T>,
): Promise<T> {
  const gesture = await mintGesture(reason);
  return run(gesture);
}
