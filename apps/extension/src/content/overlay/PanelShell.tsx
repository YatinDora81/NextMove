/**
 * content/overlay/PanelShell.tsx — the bottom-right shell: a collapsed bubble, the panel's title
 * bar, and the power switch that has to be reachable from both.
 *
 * JF-001 Rev 3.0 · F-03 (the in-page affordance) · F-06 (review) · `Settings.enabled` (SEC 5.1).
 *
 * The problem this solves. The review panel is 392px of card that only earns its place once there
 * is something to review, and the floating pill it grew up next to was a second widget saying a
 * similar thing in a different shape. So there is one thing in the corner now, in two states: a
 * 48px bubble that promises NextMove is here, and the full panel when the user asks for it. The
 * bubble carries the two facts worth knowing without opening anything — how many suggestions are
 * waiting (the count badge) and whether NextMove is on at all (the power dot).
 *
 * Why the power switch appears twice. `Settings.enabled` is the promise that NextMove can be told to
 * stop touching pages, and a promise the user cannot reach is not one. It is on the bubble and in
 * the panel header, it is the same stored flag as the popup's toggle and Alt+Shift+N, and every
 * surface reads it back off storage rather than keeping a copy — so the four of them cannot disagree.
 *
 * Collapsing is not unmounting. `PanelShell` hides its children with a class instead of removing
 * them, because the panel is meant to come back exactly as it was left: the same filter chip
 * pressed, the same row scrolled to. See `.jf-shell--collapsed` in `mount.ts` for why that is
 * `visibility` and not `display`.
 *
 * INV-1: nothing in this file touches the host page. It renders inside the closed shadow root
 * (SEC 4.4) and reports clicks upward.
 */

import { createElement as h, type ReactElement, type ReactNode } from 'react';

import { ChevronDown, NextMoveMark } from '@/ui/icons';

/** Anything above this is "lots" — the badge is a nudge, not a readout. */
const MAX_BADGE_COUNT = 99;

export interface PowerSwitchProps {
  enabled: boolean;
  onToggle: () => void;
}

/**
 * The switch, as a real `role="switch"` rather than a checkbox with a pretty label: it is a
 * two-state control whose off position is a promise, and a screen reader should read it as one.
 */
export function PowerSwitch({ enabled, onToggle }: PowerSwitchProps): ReactElement {
  return h(
    'button',
    {
      type: 'button',
      role: 'switch',
      className: 'jf-switch',
      'aria-checked': enabled,
      'aria-label': enabled ? 'Turn NextMove off on every site' : 'Turn NextMove on',
      title: `${enabled ? 'Turn off' : 'Turn on'} — Alt+Shift+N`,
      onClick: onToggle,
    },
    h('span', { className: 'jf-switch__track' }, h('span', { className: 'jf-switch__knob' })),
    h('span', null, enabled ? 'On' : 'Off'),
  );
}

export interface PanelBubbleProps {
  enabled: boolean;
  /** Suggestions on this page that nobody has accepted or refused yet. */
  pending: number;
  busy: boolean;
  /** True while the panel is expanded — the bubble stands aside rather than unmounting. */
  hidden: boolean;
  onExpand: () => void;
  onToggleEnabled: () => void;
}

/**
 * The collapsed state. Three targets in 48px, and they must not fight each other: the body expands
 * the panel, the dot flips the power switch *without* expanding anything, and the count badge is
 * decoration (`aria-hidden`) because the button it sits on already says the number out loud.
 */
export function PanelBubble({
  enabled,
  pending,
  busy,
  hidden,
  onExpand,
  onToggleEnabled,
}: PanelBubbleProps): ReactElement {
  const badge = pending > MAX_BADGE_COUNT ? `${String(MAX_BADGE_COUNT)}+` : String(pending);
  // Off, the panel has nothing in it to open — so the whole bubble becomes the way back on rather
  // than a button that does nothing. It is also the only affordance left on the page at that point.
  const summary = enabled
    ? pending === 0
      ? 'NextMove — open the panel'
      : `NextMove — ${String(pending)} suggestion${pending === 1 ? '' : 's'} waiting`
    : 'NextMove is off — turn it back on (Alt+Shift+N)';

  return h(
    'div',
    {
      className:
        `jf-bubble${enabled ? '' : ' jf-bubble--off'}${busy ? ' jf-bubble--busy' : ''}` +
        `${hidden ? ' jf-bubble--hidden' : ''}`,
      role: 'group',
      'aria-label': 'NextMove',
      'aria-hidden': hidden ? true : undefined,
    },
    h(
      'button',
      {
        type: 'button',
        className: 'jf-bubble__open',
        onClick: enabled ? onExpand : onToggleEnabled,
        'aria-label': summary,
        title: summary,
      },
      h(NextMoveMark, { size: 22, className: 'jf-bubble__mark' }),
    ),
    enabled && pending > 0
      ? h('span', { className: 'jf-bubble__count', 'aria-hidden': true }, badge)
      : null,
    h(
      'button',
      {
        type: 'button',
        className: 'jf-bubble__power',
        role: 'switch',
        'aria-checked': enabled,
        onClick: onToggleEnabled,
        'aria-label': enabled ? 'Turn NextMove off on every site' : 'Turn NextMove on',
        title: `NextMove is ${enabled ? 'on' : 'off'} — Alt+Shift+N`,
      },
      h('span', { className: 'jf-bubble__dot' }),
    ),
  );
}

export interface PanelChromeProps {
  enabled: boolean;
  onToggleEnabled: () => void;
  onCollapse: () => void;
}

/**
 * The panel's title bar. It sits above the review header rather than replacing it: what the run did
 * ("Filled 9 of 14 fields") is the panel's own subject, and the name, the power switch and the way
 * out belong to the window around it.
 */
export function PanelChrome({
  enabled,
  onToggleEnabled,
  onCollapse,
}: PanelChromeProps): ReactElement {
  return h(
    'div',
    { className: 'jf-panel__chrome' },
    h(
      'div',
      { className: 'jf-panel__brand' },
      h(NextMoveMark, { size: 15 }),
      h('span', null, 'NextMove'),
    ),
    h(PowerSwitch, { enabled, onToggle: onToggleEnabled }),
    h(
      'button',
      {
        type: 'button',
        className: 'jf-btn jf-btn--ghost jf-btn--tiny',
        onClick: onCollapse,
        'aria-label': 'Minimise NextMove',
        title: 'Minimise (Esc)',
      },
      h(ChevronDown, { size: 14 }),
    ),
  );
}

export interface PanelShellProps {
  collapsed: boolean;
  onCollapse: () => void;
  children?: ReactNode;
}

/**
 * The dock. Esc collapses it, which is the one keyboard convention every floating panel owes its
 * user — and it collapses rather than destroys, so nothing they were reading is thrown away.
 */
export function PanelShell({ collapsed, onCollapse, children }: PanelShellProps): ReactElement {
  return h(
    'div',
    {
      className: `jf-shell${collapsed ? ' jf-shell--collapsed' : ''}`,
      'aria-hidden': collapsed ? true : undefined,
      onKeyDown: (event: { key: string; stopPropagation: () => void }) => {
        if (collapsed || event.key !== 'Escape') return;
        // The page may well use Esc for its own dialog; ours consumed it, so it stops here.
        event.stopPropagation();
        onCollapse();
      },
    },
    children,
  );
}
