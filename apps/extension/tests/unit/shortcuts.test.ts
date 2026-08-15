/**
 * tests/unit/shortcuts.test.ts — how NextMove names its two keyboard shortcuts (`ui/shortcuts.ts`).
 *
 * Small surface, two mistakes that would each be felt immediately:
 *
 *   1. **Telling a Mac user to press a key they do not have.** Chrome maps the `Alt` modifier to
 *      Option on macOS, so "Alt + Shift + N" is the wrong instruction on half the installs — and the
 *      popup, the Options page and the in-page toasts all read their copy from here.
 *   2. **Sending a Chrome user to `about:addons`,** or a Firefox user to a page that does not exist.
 *
 * The declared chords are asserted against `wxt.config.ts`'s `commands` block, because these are a
 * restatement of it and a restatement that drifts is worse than no restatement at all.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { COMMAND_FILL_PAGE, COMMAND_TOGGLE_ENABLED } from '@/shared/constants';
import {
  FILL_SHORTCUT,
  SHORTCUTS,
  TOGGLE_SHORTCUT,
  isMacPlatform,
  shortcutKeys,
  shortcutText,
  shortcutsPageUrl,
} from '@/ui/shortcuts';

/** happy-dom's `navigator` is writable through `defineProperty`; each test restores it. */
function setAgent(patch: { userAgent?: string; platform?: string }): void {
  for (const [key, value] of Object.entries(patch)) {
    Object.defineProperty(navigator, key, { value, configurable: true });
  }
}

const ORIGINAL = { userAgent: navigator.userAgent, platform: navigator.platform };

afterEach(() => {
  setAgent(ORIGINAL);
});

describe('the declared shortcuts match the manifest', () => {
  it('names the same two commands the manifest registers', () => {
    expect(FILL_SHORTCUT.id).toBe(COMMAND_FILL_PAGE);
    expect(TOGGLE_SHORTCUT.id).toBe(COMMAND_TOGGLE_ENABLED);
    expect(SHORTCUTS).toHaveLength(2);
  });

  it('restates `suggested_key` from wxt.config.ts exactly', () => {
    // wxt.config.ts: 'fill-page' → Alt+J, 'toggle-enabled' → Alt+Shift+N.
    expect(shortcutText(FILL_SHORTCUT, false)).toBe('Alt+J');
    expect(shortcutText(TOGGLE_SHORTCUT, false)).toBe('Alt+Shift+N');
  });
});

describe('how the chord is drawn', () => {
  it('uses the symbols a Mac keyboard actually has', () => {
    expect(shortcutKeys(TOGGLE_SHORTCUT, true)).toEqual(['⌥', '⇧', 'N']);
    expect(shortcutText(TOGGLE_SHORTCUT, true)).toBe('⌥⇧N');
    expect(shortcutKeys(FILL_SHORTCUT, true)).toEqual(['⌥', 'J']);
  });

  it('spells the modifiers out everywhere else', () => {
    expect(shortcutKeys(TOGGLE_SHORTCUT, false)).toEqual(['Alt', 'Shift', 'N']);
  });

  it('detects macOS from userAgentData, then from the legacy fields', () => {
    setAgent({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });
    expect(isMacPlatform()).toBe(true);

    setAgent({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
    expect(isMacPlatform()).toBe(false);

    setAgent({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' });
    expect(isMacPlatform()).toBe(false);
  });

  it('defaults to the spelled-out form when the platform cannot be read at all', () => {
    setAgent({ platform: '', userAgent: '' });
    expect(isMacPlatform()).toBe(false);
    expect(shortcutText(TOGGLE_SHORTCUT)).toBe('Alt+Shift+N');
  });
});

describe('where the user goes to change them', () => {
  it('sends Chromium to the per-command editor', () => {
    setAgent({ userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36' });
    expect(shortcutsPageUrl()).toBe('chrome://extensions/shortcuts');
  });

  it('sends Firefox to the add-ons manager, which is the only place it offers', () => {
    setAgent({ userAgent: 'Mozilla/5.0 (Macintosh; rv:128.0) Gecko/20100101 Firefox/128.0' });
    expect(shortcutsPageUrl()).toBe('about:addons');
  });
});
