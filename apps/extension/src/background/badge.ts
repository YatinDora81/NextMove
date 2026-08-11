import type { KeyState, KeyStatus } from '@repo/rotation';

import { loadKeyStates } from '@/ai/vault';
import { createLogger } from '@/platform/logger';
import { getSlot } from '@/platform/storage';
import { BADGE_DISABLED, BADGE_KEY_DEAD } from '@/shared/constants';

const log = createLogger('bg:badge');

const DEAD_BADGE_COLOR = '#DC2626';
const OFF_BADGE_COLOR = '#6B7280';
const DEFAULT_TITLE = 'NextMove (Alt+J)';

export interface BadgeState {
  dead: number;
  total: number;
  text: string;
  title: string;
  /** The badge colour to paint behind `text`; `null` leaves the browser default alone. */
  color: string | null;
}


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

/**
 * The badge answers one question at a time, and "am I even switched on?" outranks "is a key dead?" —
 * a dead key is not worth reporting on a page we are not going to touch anyway.
 */
export function deriveBadgeState(states: readonly KeyState[], enabled = true): BadgeState {
  const dead = countByStatus(states, 'DEAD');
  const total = states.length;

  if (!enabled) {
    return {
      dead,
      total,
      text: BADGE_DISABLED,
      title: `${DEFAULT_TITLE} — off. Alt+Shift+N or the popup turns it back on.`,
      color: OFF_BADGE_COLOR,
    };
  }

  if (dead === 0) {
    return { dead: 0, total, text: '', title: DEFAULT_TITLE, color: null };
  }

  const subject = dead === 1 ? 'A Gemini key was rejected' : `${String(dead)} Gemini keys were rejected`;
  return {
    dead,
    total,
    text: BADGE_KEY_DEAD,
    title: `${DEFAULT_TITLE} — ${subject}. Open Options → AI to fix or replace ${dead === 1 ? 'it' : 'them'}.`,
    color: DEAD_BADGE_COLOR,
  };
}


async function paint(state: BadgeState): Promise<void> {
  const surface = action();
  if (surface === null) return;

  try {
    await surface.setBadgeText({ text: state.text });
    await surface.setTitle({ title: state.title });
    if (state.color !== null && typeof surface.setBadgeBackgroundColor === 'function') {
      await surface.setBadgeBackgroundColor({ color: state.color });
    }

  } catch (error) {
    log.debug('could not paint the toolbar badge', error);
  }
}

async function readEnabled(): Promise<boolean> {
  try {
    return (await getSlot('settings')).enabled;
  } catch (error) {
    // A badge is not worth failing over: an unreadable settings slot means "assume on", which is
    // the state the extension boots in anyway.
    log.debug('could not read the power switch for the badge', error);
    return true;
  }
}

export async function refreshKeyBadge(): Promise<BadgeState> {
  const enabled = await readEnabled();

  let states: KeyState[] = [];
  try {
    states = await loadKeyStates();
  } catch (error) {
    log.debug('could not read the key pool for the badge', error);
    const fallback = deriveBadgeState([], enabled);
    await paint(fallback);
    return fallback;
  }

  const state = deriveBadgeState(states, enabled);
  await paint(state);
  return state;
}

export async function clearKeyBadge(): Promise<void> {
  await paint({ dead: 0, total: 0, text: '', title: DEFAULT_TITLE, color: null });
}

