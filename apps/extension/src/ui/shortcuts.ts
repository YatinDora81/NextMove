/**
 * ui/shortcuts.ts — how NextMove's two keyboard shortcuts are named, drawn and re-bound.
 *
 * `wxt.config.ts` declares both commands and Chrome owns the bindings from there: `fill-page`
 * (Alt+J) and `toggle-enabled` (Alt+Shift+N). This module is the single place that turns those
 * declarations into something a human reads, because three surfaces have to say the same thing —
 * the popup, the Options page, and the in-page toasts that confirm the power switch moved.
 *
 * Two details that are easy to get wrong and that this module exists to get right:
 *
 *   - **macOS renders Alt as ⌥.** Chrome maps the `Alt` modifier to Option on macOS, so a popup that
 *     says "Alt + Shift + N" to a Mac user is naming a key that is not on their keyboard.
 *
 *   - **A link to `chrome://extensions/shortcuts` does not work.** Chrome refuses navigation to a
 *     `chrome://` URL from an extension page, and an anchor that silently does nothing is worse than
 *     no anchor. `browser.tabs.create` is allowed, so re-binding is a button, not a link.
 *
 * The bindings themselves are the user's: they can be changed or cleared in the browser, and nothing
 * here can read back what they chose (`browser.commands.getAll` exists in Chrome but not in every
 * target, and returns the *declared* suggestion in practice). So these are the shipped defaults,
 * described as such — with the way to change them one press away.
 */

/** The `commands` keys from `wxt.config.ts`. Kept as literals so a rename here fails the typecheck. */
export type ShortcutId = 'fill-page' | 'toggle-enabled';

export interface ShortcutSpec {
  id: ShortcutId;
  /** What it does, in the user's words. */
  label: string;
  /** The modifiers Chrome was asked for, in `suggested_key` order. */
  modifiers: readonly ('Alt' | 'Shift' | 'Ctrl')[];
  key: string;
}

export const FILL_SHORTCUT: ShortcutSpec = {
  id: 'fill-page',
  label: 'Fill this application',
  modifiers: ['Alt'],
  key: 'J',
};

export const TOGGLE_SHORTCUT: ShortcutSpec = {
  id: 'toggle-enabled',
  label: 'Turn NextMove on or off',
  modifiers: ['Alt', 'Shift'],
  key: 'N',
};

export const SHORTCUTS: readonly ShortcutSpec[] = [FILL_SHORTCUT, TOGGLE_SHORTCUT];

const MAC_SYMBOL: Readonly<Record<string, string>> = {
  Alt: '⌥',
  Shift: '⇧',
  Ctrl: '⌃',
};

/**
 * Is this a Mac? Read from `navigator` at call time rather than at module scope so a test can set it,
 * and defensively, because `userAgentData` is Chromium-only and `platform` is deprecated everywhere.
 */
export function isMacPlatform(): boolean {
  const nav: unknown = typeof navigator === 'undefined' ? undefined : navigator;
  if (typeof nav !== 'object' || nav === null) return false;
  const data = (nav as { userAgentData?: { platform?: unknown } }).userAgentData;
  if (typeof data?.platform === 'string' && data.platform.length > 0) {
    return /mac/i.test(data.platform);
  }
  const legacy = (nav as { platform?: unknown; userAgent?: unknown });
  const hint = typeof legacy.platform === 'string' ? legacy.platform : '';
  const agent = typeof legacy.userAgent === 'string' ? legacy.userAgent : '';
  return /mac/i.test(hint) || /mac os x/i.test(agent);
}

/** The keys to draw, one per `<Kbd>`: `['⌥', '⇧', 'N']` on macOS, `['Alt', 'Shift', 'N']` elsewhere. */
export function shortcutKeys(shortcut: ShortcutSpec, mac: boolean = isMacPlatform()): string[] {
  const modifiers = shortcut.modifiers.map((modifier) =>
    mac ? (MAC_SYMBOL[modifier] ?? modifier) : modifier,
  );
  return [...modifiers, shortcut.key];
}

/** The same thing as one string, for a `title` attribute or a toast. */
export function shortcutText(shortcut: ShortcutSpec, mac: boolean = isMacPlatform()): string {
  return shortcutKeys(shortcut, mac).join(mac ? '' : '+');
}

/**
 * Where the browser keeps its shortcut editor. Firefox has no per-command page, so it gets the
 * add-ons manager, where the "Manage Extension Shortcuts" gear lives.
 */
export function shortcutsPageUrl(): string {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return /firefox/i.test(agent) ? 'about:addons' : 'chrome://extensions/shortcuts';
}

/**
 * Open it. A new tab, not a navigation: this is usually called from the popup, which is closed by
 * the click, and `tabs.create` is the only route to a `chrome://` URL an extension page is given.
 */
export function openShortcutsPage(): void {
  void browser.tabs.create({ url: shortcutsPageUrl() });
}
