/**
 * background/badge.ts — the toolbar badge (JF-001 Rev 3.0 SEC 5.6).
 *
 * SEC 5.6, row "Key revoked/invalid": *"Key marked DEAD, badge on extension icon, key row flagged
 * in Options."* This module owns that badge and nothing else.
 *
 * The badge is derived state, never stored state: an MV3 service worker dies between events, so
 * anything cached in module scope would be wrong the moment Chrome recycled the worker. Every
 * call re-reads `jf.keys` and re-derives the badge from the rotation ledgers that are already the
 * source of truth (SEC 5.4). Callers therefore only have to say "something might have changed" —
 * they never have to know what the badge should say.
 *
 * INV-5: nothing here touches ciphertext or a plaintext key. `loadKeyStates()` returns rotation
 * state only (`id`, `status`, ledgers) — no `ct`, no `iv`, and nothing that is logged.
 */

import type { KeyState, KeyStatus } from '@repo/rotation';

import { loadKeyStates } from '@/ai/vault';
import { createLogger } from '@/platform/logger';
import { BADGE_KEY_DEAD } from '@/shared/constants';

const log = createLogger('bg:badge');

/** Chrome renders roughly four characters; `!` is deliberately the whole vocabulary. */
const DEAD_BADGE_COLOR = '#DC2626';
const DEFAULT_TITLE = 'NextMove (Alt+J)';

/** What the badge is currently telling the user. */
export interface BadgeState {
  /** Number of quarantined keys. `0` ⇒ no badge. */
  dead: number;
  /** Number of keys that exist at all — `0` means "no vault", which is NOT an error state. */
  total: number;
  text: string;
  title: string;
}

/**
 * `browser.action` is absent in a plain vitest run and in any context without the `action` key in
 * the manifest. Resolving it lazily (and tolerating its absence) keeps the badge a pure
 * nice-to-have that can never take down a bus handler.
 */
function action(): typeof browser.action | null {
  try {
    const surface: typeof browser.action | undefined = browser.action;
    if (!surface || typeof surface.setBadgeText !== 'function') return null;
    return surface;
  } catch {
    return null;
  }
}

function countByStatus(states: readonly KeyState[], status: KeyStatus): number {
  let count = 0;
  for (const state of states) if (state.status === status) count += 1;
  return count;
}

/** Pure: the badge that a given pool implies. Exported so tests do not need `browser.action`. */
export function deriveBadgeState(states: readonly KeyState[]): BadgeState {
  const dead = countByStatus(states, 'DEAD');
  const total = states.length;

  if (dead === 0) {
    return { dead: 0, total, text: '', title: DEFAULT_TITLE };
  }

  const subject = dead === 1 ? 'A Gemini key was rejected' : `${String(dead)} Gemini keys were rejected`;
  return {
    dead,
    total,
    text: BADGE_KEY_DEAD,
    // SEC 5.6: DEAD is user-fixable only, so the tooltip has to say where to go.
    title: `${DEFAULT_TITLE} — ${subject}. Open Options → AI to fix or replace ${dead === 1 ? 'it' : 'them'}.`,
  };
}

async function paint(state: BadgeState): Promise<void> {
  const surface = action();
  if (surface === null) return;

  try {
    await surface.setBadgeText({ text: state.text });
    await surface.setTitle({ title: state.title });
    if (state.text !== '' && typeof surface.setBadgeBackgroundColor === 'function') {
      await surface.setBadgeBackgroundColor({ color: DEAD_BADGE_COLOR });
    }
  } catch (error) {
    // A badge is cosmetic. Losing it must never turn into a failed KEYS_TEST or a failed fill.
    log.debug('could not paint the toolbar badge', error);
  }
}

/**
 * Re-derive and repaint the badge from `jf.keys`.
 *
 * Call this after anything that can change a key's status: `KEYS_ADD` / `KEYS_TEST` /
 * `KEYS_DELETE`, every AI request (rotation can quarantine a key even on a request that
 * ultimately succeeded on a different one), and service-worker start-up.
 *
 * Never throws — the caller's own result is more important than the badge.
 */
export async function refreshKeyBadge(): Promise<BadgeState> {
  let states: KeyState[] = [];
  try {
    states = await loadKeyStates();
  } catch (error) {
    log.debug('could not read the key pool for the badge', error);
    return { dead: 0, total: 0, text: '', title: DEFAULT_TITLE };
  }

  const state = deriveBadgeState(states);
  await paint(state);
  return state;
}

/** Explicitly clear the badge (vault wipe, "dismiss" affordance). */
export async function clearKeyBadge(): Promise<void> {
  await paint({ dead: 0, total: 0, text: '', title: DEFAULT_TITLE });
}
