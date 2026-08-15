/**
 * tests/unit/power-switch.test.ts — `Settings.enabled`, and the promise it makes.
 *
 * `shared/types.ts` documents that flag as: *"When false the in-page layer draws nothing, suggests
 * nothing and fills nothing — the toolbar button, Alt+J and the context menu all refuse too."* Four
 * surfaces can flip it (the popup header, the in-page panel header, the bubble's power dot and
 * Alt+Shift+N in the service worker) and before `platform/storage.setEnabled` existed they did it
 * three different ways, one of which forgot to stamp `updatedAt` and one of which repainted the
 * toolbar badge while the others did not.
 *
 * So what is asserted here is the *single writer* property, which is the only thing that makes four
 * surfaces agree:
 *
 *   1. both writers go through the settings slot, stamp `updatedAt`, and leave everything else alone;
 *   2. `toggleEnabled` reads the stored value under the slot lock, so two flips racing each other
 *      cannot end up agreeing that the switch is both on and off;
 *   3. one write is the whole fan-out — `subscribeSlot('settings')` is how every surface, including
 *      the toolbar badge, hears about it, and there is deliberately no `SETTINGS_*` message type;
 *   4. the badge derives "off" from the same flag, so the toolbar cannot contradict the page.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { deriveBadgeState } from '@/background/badge';
import {
  getSettings,
  patchSettings,
  setEnabled,
  setSettings,
  subscribeSlot,
  toggleEnabled,
} from '@/platform/storage';
import { BADGE_DISABLED, DEFAULT_SETTINGS, STORAGE_KEY_SETTINGS } from '@/shared/constants';
import { MESSAGE_TYPES } from '@/shared/messages';
import type { KeyState, Settings } from '@/shared/types';

import { resetBrowserMock, type BrowserMock } from '../setup';

let mock: BrowserMock;

beforeEach(async () => {
  mock = resetBrowserMock();
  await setSettings({ ...DEFAULT_SETTINGS, enabled: true }, 1_000);
});

function stored(): Settings {
  return mock.__store[STORAGE_KEY_SETTINGS] as Settings;
}

describe('the power switch has one writer', () => {
  it('setEnabled writes the flag and stamps updatedAt', async () => {
    const next = await setEnabled(false, 5_000);
    expect(next.enabled).toBe(false);
    expect(next.updatedAt).toBe(5_000);
    expect(stored().enabled).toBe(false);
  });

  it('setEnabled leaves every other preference exactly as it was', async () => {
    await patchSettings({ activeProfileId: 'prof_1', fillThreshold: 81, tone: 'formal' }, 2_000);
    const before = await getSettings();

    await setEnabled(false, 3_000);
    const after = await getSettings();

    expect(after).toEqual({ ...before, enabled: false, updatedAt: 3_000 });
  });

  it('toggleEnabled flips whatever is stored, not whatever the caller last saw', async () => {
    // The shortcut handler has no view of the popup's writes; it must read the slot itself.
    await setEnabled(false, 2_000);
    const next = await toggleEnabled(3_000);
    expect(next.enabled).toBe(true);
    expect(stored().enabled).toBe(true);
  });

  it('two flips racing each other cannot lose one — the slot lock serialises them', async () => {
    await Promise.all([toggleEnabled(2_000), toggleEnabled(3_000)]);
    // Two flips from `true` land back on `true`. Without the lock both would read `true`, both would
    // write `false`, and the switch would disagree with the two presses the user made.
    expect(stored().enabled).toBe(true);

    await Promise.all([toggleEnabled(4_000), toggleEnabled(5_000), toggleEnabled(6_000)]);
    expect(stored().enabled).toBe(false);
  });

  it('a flip reaches every surface through storage, with no message type of its own', async () => {
    // The one subscription in this file, deliberately: `subscribeSlot` installs its
    // `storage.onChanged` hook once per module instance, and `resetBrowserMock()` clears the mock's
    // listener sets — so a second test that subscribed after a reset would hear nothing, for a
    // reason that has nothing to do with the code under test.
    const seen: boolean[] = [];
    const unsubscribe = subscribeSlot('settings', (next) => seen.push(next.enabled));

    await setEnabled(false, 2_000);
    await toggleEnabled(3_000);
    unsubscribe();
    await setEnabled(false, 4_000);

    // The third write changed the flag too; a surface that has gone away must not hear about it.
    expect(seen).toEqual([false, true]);
    expect(stored().enabled).toBe(false);
    // Nothing was sent over the bus: the service worker is not on the path of a preference.
    expect(mock.__sent).toHaveLength(0);
    expect(MESSAGE_TYPES.some((type) => type.startsWith('SETTINGS'))).toBe(false);
  });

  it('lives on disk, not in memory, so a browser restart cannot forget it', async () => {
    await setEnabled(false, 2_000);
    // The assertion that matters is about the *storage bag*: nothing in this module caches the slot,
    // so what a restarted browser reads is exactly this, and `getSettings()` agreeing is a
    // consequence rather than the evidence.
    const bag = await mock.storage.local.get(STORAGE_KEY_SETTINGS);
    expect((bag[STORAGE_KEY_SETTINGS] as Settings).enabled).toBe(false);
    expect((await getSettings()).enabled).toBe(false);
  });
});

describe('the toolbar badge reads the same flag', () => {
  it('says "off" and outranks a dead key, which is not worth reporting on a page we will not touch', () => {
    const dead: KeyState[] = [
      {
        id: 'key_1',
        status: 'DEAD',
        strikes: 3,
        cooldownUntil: 0,
        lastUsedAt: 0,
        rpm: {},
        daily: {},
      } as KeyState,
    ];
    const off = deriveBadgeState(dead, false);
    expect(off.text).toBe(BADGE_DISABLED);
    expect(off.title).toContain('off');

    const on = deriveBadgeState(dead, true);
    expect(on.text).not.toBe(BADGE_DISABLED);
  });

  it('says nothing at all when NextMove is on and the pool is healthy', () => {
    expect(deriveBadgeState([], true).text).toBe('');
  });
});
