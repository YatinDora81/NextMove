import type { KeyState, KeyStatus } from '@repo/rotation';

import { loadKeyStates } from '@/ai/vault';
import { createLogger } from '@/platform/logger';
import { BADGE_KEY_DEAD } from '@/shared/constants';

const log = createLogger('bg:badge');

const DEAD_BADGE_COLOR = '#DC2626';
const DEFAULT_TITLE = 'NextMove (Alt+J)';

export interface BadgeState {
  dead: number;
  total: number;
  text: string;
  title: string;
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
    log.debug('could not paint the toolbar badge', error);
  }
}

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

export async function clearKeyBadge(): Promise<void> {
  await paint({ dead: 0, total: 0, text: '', title: DEFAULT_TITLE });
}
