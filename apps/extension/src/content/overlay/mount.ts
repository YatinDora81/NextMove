import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { OVERLAY_HOST_ID } from '@/shared/constants';
import { createLogger } from '@/platform/logger';

const log = createLogger('overlay');

export const OVERLAY_LAYERS = ['markers', 'sparkles', 'pill', 'panel', 'toasts'] as const;

export type OverlayLayer = (typeof OVERLAY_LAYERS)[number];

export interface OverlayHandle {
  readonly host: HTMLElement;
  readonly tagName: string;
  layer(name: OverlayLayer): HTMLElement;
  render(name: OverlayLayer, node: ReactNode): void;
  clear(name: OverlayLayer): void;
  ensureAttached(): void;
  readonly attached: boolean;
  destroy(): void;
}

import overlayTokens from '@/ui/tokens.css?inline';

export const OVERLAY_STYLES = `
:host {
  all: initial;
  color-scheme: light dark;
}

${overlayTokens}

.jf-layer {
  position: fixed;
  inset: 0;
  margin: 0;
  padding: 0;
  border: 0;
  pointer-events: none;
  font-family: var(--jf-font);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.45;
  letter-spacing: normal;
  text-align: left;
  color: var(--jf-fg);
  -webkit-font-smoothing: antialiased;
}

.jf-layer--markers { z-index: 1; }
.jf-layer--sparkles { z-index: 2; }
.jf-layer--pill { z-index: 3; }
.jf-layer--panel { z-index: 4; }
.jf-layer--toasts { z-index: 5; }

.jf-layer * {
  box-sizing: border-box;
  font-family: inherit;
}

button {
  font: inherit;
  color: inherit;
  margin: 0;
  cursor: pointer;
}

.jf-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: var(--jf-radius-sm);
  border: 1px solid var(--jf-border-strong);
  background: var(--jf-surface);
  color: var(--jf-fg);
  font-size: 12px;
  font-weight: 550;
  white-space: nowrap;
}
.jf-btn:hover { background: var(--jf-surface-subtle); }
.jf-btn:focus-visible { outline: 2px solid var(--jf-accent); outline-offset: 1px; }
.jf-btn:disabled { opacity: 0.55; cursor: default; }
.jf-btn--primary {
  background: var(--jf-accent);
  border-color: var(--jf-accent);
  color: var(--jf-accent-contrast);
}
.jf-btn--primary:hover { filter: brightness(1.06); background: var(--jf-accent); }
.jf-btn--ghost { background: transparent; border-color: transparent; color: var(--jf-fg-muted); }
.jf-btn--ghost:hover { background: var(--jf-surface-subtle); color: var(--jf-fg); }
.jf-btn--tiny { padding: 3px 7px; font-size: 11px; }

.jf-card {
  pointer-events: auto;
  background: var(--jf-surface);
  border: 1px solid var(--jf-border);
  border-radius: var(--jf-radius);
  box-shadow: var(--jf-shadow);
  overflow: hidden;
}

.jf-muted { color: var(--jf-fg-muted); }
.jf-subtle { color: var(--jf-fg-subtle); }
.jf-mono { font-family: var(--jf-font-mono); font-size: 11px; }
.jf-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jf-sr {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}

.jf-marker {
  position: fixed;
  pointer-events: none;
  border-radius: 5px;
  border: 2px solid transparent;
  transition: opacity 120ms ease-out;
}
.jf-marker--filled { border-color: var(--jf-accent); background: var(--jf-accent-soft); }
.jf-marker--suggested { border-color: var(--jf-warn); background: var(--jf-warn-soft); }
.jf-marker--unmatched { border-color: var(--jf-danger); background: var(--jf-danger-soft); border-style: dashed; }
.jf-marker--next {
  border-color: var(--jf-ok);
  background: transparent;
  box-shadow: 0 0 0 3px rgba(31, 146, 84, 0.22);
}
.jf-marker--hidden { display: none; }
.jf-marker--pulse { animation: jf-pulse 1.1s ease-out 2; }

@keyframes jf-pulse {
  0% { box-shadow: 0 0 0 0 rgba(47, 109, 246, 0.5); }
  70% { box-shadow: 0 0 0 8px rgba(47, 109, 246, 0); }
  100% { box-shadow: 0 0 0 0 rgba(47, 109, 246, 0); }
}

.jf-marker__badge {
  position: absolute;
  top: -9px;
  left: -2px;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 220px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 650;
  line-height: 16px;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.jf-marker--filled .jf-marker__badge { background: var(--jf-accent); }
.jf-marker--suggested .jf-marker__badge { background: var(--jf-warn); }
.jf-marker--unmatched .jf-marker__badge { background: var(--jf-danger); }
.jf-marker--next .jf-marker__badge { background: var(--jf-ok); }

@media (prefers-reduced-motion: reduce) {
  .jf-marker, .jf-marker--pulse { transition: none; animation: none; }
}

.jf-pill {
  position: fixed;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 4px 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--jf-border);
  background: var(--jf-surface);
  box-shadow: var(--jf-shadow);
  user-select: none;
  touch-action: none;
  max-width: min(320px, calc(100vw - 24px));
}
.jf-pill--dragging { cursor: grabbing; opacity: 0.9; }
.jf-pill__grip {
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: grab;
  padding-right: 4px;
}
.jf-pill__dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--jf-accent);
  flex: none;
}
.jf-pill--busy .jf-pill__dot { animation: jf-blink 900ms ease-in-out infinite; }
@keyframes jf-blink { 0%, 100% { opacity: 1 } 50% { opacity: 0.25 } }
.jf-pill__label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--jf-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.jf-pill__fill {
  border: 0;
  background: var(--jf-accent);
  color: var(--jf-accent-contrast);
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 650;
}
.jf-pill__fill:disabled { opacity: 0.6; cursor: default; }
.jf-pill__close {
  border: 0;
  background: transparent;
  color: var(--jf-fg-subtle);
  padding: 4px 6px;
  border-radius: 999px;
  font-size: 13px;
  line-height: 1;
}
.jf-pill__close:hover { background: var(--jf-surface-subtle); color: var(--jf-fg); }
.jf-pill__power {
  border: 0;
  background: transparent;
  color: var(--jf-fg-subtle);
  padding: 4px 6px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 650;
  line-height: 1;
  letter-spacing: 0.02em;
}
.jf-pill__power:hover { background: var(--jf-danger-soft); color: var(--jf-danger); }



.jf-panel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: min(392px, calc(100vw - 32px));
  max-height: min(74vh, 640px);
  display: flex;
  flex-direction: column;
}
.jf-panel__head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 12px 10px;
  border-bottom: 1px solid var(--jf-border);
}
.jf-panel__title { font-size: 13.5px; font-weight: 700; margin: 0 0 2px; }
.jf-panel__sub { font-size: 11.5px; color: var(--jf-fg-muted); }
.jf-panel__body { overflow-y: auto; overscroll-behavior: contain; padding: 8px 12px 4px; }
.jf-panel__foot {
  border-top: 1px solid var(--jf-border);
  padding: 8px 12px 10px;
  background: var(--jf-surface-subtle);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.jf-panel__note { font-size: 11.5px; color: var(--jf-fg-muted); }
.jf-panel__actions { display: flex; gap: 6px; flex-wrap: wrap; }

.jf-legend { display: flex; gap: 6px; padding: 8px 12px; flex-wrap: wrap; border-bottom: 1px solid var(--jf-border); }
.jf-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--jf-border);
  background: var(--jf-surface);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--jf-fg-muted);
}
.jf-chip[aria-pressed="true"] { border-color: currentColor; }
.jf-chip__swatch { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.jf-chip--filled { color: var(--jf-accent); }
.jf-chip--filled .jf-chip__swatch { background: var(--jf-accent); }
/* "Already answered" is a settled state, not a warning — it borrows the same green as the
   next-step callout so it never competes with the amber/red rows that do want attention. */
.jf-chip--answered { color: var(--jf-ok); }
.jf-chip--answered .jf-chip__swatch { background: var(--jf-ok); }
.jf-chip--suggested { color: var(--jf-warn); }
.jf-chip--suggested .jf-chip__swatch { background: var(--jf-warn); }
.jf-chip--unmatched { color: var(--jf-danger); }
.jf-chip--unmatched .jf-chip__swatch { background: var(--jf-danger); }

.jf-row {
  display: flex;
  gap: 8px;
  padding: 7px 0;
  border-bottom: 1px solid var(--jf-border);
  align-items: flex-start;
}
.jf-row:last-child { border-bottom: 0; }
.jf-row__bar { width: 3px; align-self: stretch; border-radius: 2px; flex: none; }
.jf-row--filled .jf-row__bar { background: var(--jf-accent); }
.jf-row--answered .jf-row__bar { background: var(--jf-ok); }
.jf-row--suggested .jf-row__bar { background: var(--jf-warn); }
.jf-row--unmatched .jf-row__bar { background: var(--jf-danger); }
.jf-row--focused { background: color-mix(in srgb, var(--jf-accent) 9%, transparent); border-radius: 8px; }
.jf-row--focused .jf-row__bar { background: var(--jf-accent); }
.jf-row__main { min-width: 0; flex: 1; }
.jf-row__label { font-size: 12.5px; font-weight: 600; overflow-wrap: anywhere; }
.jf-row__meta { font-size: 11px; color: var(--jf-fg-muted); overflow-wrap: anywhere; }
.jf-row__value { font-size: 11.5px; color: var(--jf-fg-muted); overflow-wrap: anywhere; }
.jf-row__side { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: none; }
.jf-row__score { font-size: 10.5px; font-family: var(--jf-font-mono); color: var(--jf-fg-subtle); }

.jf-map { display: flex; gap: 6px; margin-top: 5px; align-items: center; flex-wrap: wrap; }
.jf-map select {
  font: inherit;
  font-size: 11.5px;
  padding: 3px 6px;
  max-width: 210px;
  border-radius: var(--jf-radius-sm);
  border: 1px solid var(--jf-border-strong);
  background: var(--jf-surface);
  color: var(--jf-fg);
}

.jf-callout {
  margin: 8px 0;
  padding: 8px 10px;
  border-radius: var(--jf-radius-sm);
  border: 1px solid var(--jf-border);
  background: var(--jf-surface-subtle);
  font-size: 11.5px;
  color: var(--jf-fg-muted);
}
.jf-callout strong { color: var(--jf-fg); font-weight: 650; }
.jf-callout--next { border-color: var(--jf-ok); background: rgba(31, 146, 84, 0.08); }
.jf-callout__row { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.jf-callout ul { margin: 6px 0 0; padding-left: 16px; }
.jf-callout li { margin: 2px 0; overflow-wrap: anywhere; }

.jf-spark {
  position: fixed;
  pointer-events: auto;
  border: 1px solid var(--jf-border);
  background: var(--jf-surface);
  box-shadow: var(--jf-shadow);
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--jf-fg);
}
.jf-spark:hover { border-color: var(--jf-accent); color: var(--jf-accent); }
.jf-spark:disabled { opacity: 0.6; cursor: progress; }
.jf-spark__icon { flex: none; display: block; }

.jf-answer {
  position: fixed;
  width: min(420px, calc(100vw - 32px));
  max-height: min(70vh, 560px);
  display: flex;
  flex-direction: column;
}
.jf-answer__head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--jf-border);
}
.jf-answer__title { font-size: 12.5px; font-weight: 700; }
.jf-answer__q { font-size: 11.5px; color: var(--jf-fg-muted); overflow-wrap: anywhere; }
.jf-answer__body { padding: 10px 12px; overflow-y: auto; overscroll-behavior: contain; }
.jf-answer__foot {
  border-top: 1px solid var(--jf-border);
  padding: 8px 12px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
  background: var(--jf-surface-subtle);
}
.jf-answer textarea {
  width: 100%;
  min-height: 132px;
  resize: vertical;
  font: inherit;
  font-size: 12.5px;
  line-height: 1.5;
  padding: 8px;
  border-radius: var(--jf-radius-sm);
  border: 1px solid var(--jf-border-strong);
  background: var(--jf-surface);
  color: var(--jf-fg);
}
.jf-answer textarea:focus-visible { outline: 2px solid var(--jf-accent); outline-offset: 0; }

.jf-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 650;
  border: 1px solid currentColor;
}
.jf-tag--ai { color: var(--jf-warn); background: var(--jf-warn-soft); }
.jf-tag--saved { color: var(--jf-accent); background: var(--jf-accent-soft); }
.jf-tag--similar { color: var(--jf-fg-muted); background: var(--jf-surface-subtle); }

.jf-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.jf-compare__col {
  border: 1px solid var(--jf-border);
  border-radius: var(--jf-radius-sm);
  padding: 8px;
  background: var(--jf-surface-subtle);
  min-width: 0;
}
.jf-compare__head { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--jf-fg-subtle); margin-bottom: 4px; }
.jf-compare__text { font-size: 11.5px; overflow-wrap: anywhere; white-space: pre-wrap; max-height: 150px; overflow-y: auto; }

.jf-preview {
  font-size: 12.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 220px;
  overflow-y: auto;
  padding: 8px;
  border-radius: var(--jf-radius-sm);
  background: var(--jf-surface-subtle);
  border: 1px solid var(--jf-border);
}

.jf-spinner {
  width: 13px; height: 13px; flex: none;
  border-radius: 50%;
  border: 2px solid var(--jf-border-strong);
  border-top-color: var(--jf-accent);
  animation: jf-spin 700ms linear infinite;
}
@keyframes jf-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .jf-spinner { animation-duration: 2s; } }

.jf-toasts {
  position: fixed;
  right: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  align-items: flex-end;
  max-width: min(360px, calc(100vw - 32px));
}
.jf-toast { padding: 10px 12px; display: flex; gap: 9px; align-items: flex-start; width: 100%; }
.jf-toast__mark { width: 3px; align-self: stretch; border-radius: 2px; flex: none; background: var(--jf-fg-subtle); }
.jf-toast--cooldown .jf-toast__mark, .jf-toast--daily .jf-toast__mark { background: var(--jf-warn); }
.jf-toast--error .jf-toast__mark { background: var(--jf-danger); }
.jf-toast--no-keys .jf-toast__mark { background: var(--jf-accent); }
.jf-toast--success .jf-toast__mark { background: var(--jf-ok); }
.jf-toast__main { min-width: 0; flex: 1; }
.jf-toast__title { font-size: 12.5px; font-weight: 650; overflow-wrap: anywhere; }
.jf-toast__msg { font-size: 11.5px; color: var(--jf-fg-muted); overflow-wrap: anywhere; }
.jf-toast__countdown { font-family: var(--jf-font-mono); font-variant-numeric: tabular-nums; }
.jf-toast__actions { display: flex; gap: 6px; margin-top: 7px; flex-wrap: wrap; }
`;

function randomSuffix(): string {
  const c: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(4));
    let hex = '';
    for (let i = 0; i < bytes.length; i += 1) {
      const byte = bytes[i];
      if (byte === undefined) continue;
      hex += byte.toString(16).padStart(2, '0');
    }
    return hex;
  }
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0');
}

function uniqueTagName(): string {
  return `${OVERLAY_HOST_ID}-${randomSuffix()}`;
}

const HOST_INLINE_STYLE: ReadonlyArray<readonly [string, string]> = [
  ['all', 'initial'],
  ['position', 'fixed'],
  ['top', '0'],
  ['left', '0'],
  ['width', '0'],
  ['height', '0'],
  ['margin', '0'],
  ['padding', '0'],
  ['border', '0'],
  ['overflow', 'visible'],
  ['pointer-events', 'none'],
  ['z-index', '2147483647'],
  ['display', 'block'],
  ['visibility', 'visible'],
  ['opacity', '1'],
  ['transform', 'none'],
  ['filter', 'none'],
  ['clip-path', 'none'],
  ['contain', 'none'],
];

interface OverlayInternals {
  host: HTMLElement;
  shadow: ShadowRoot;
  tagName: string;
  layers: Map<OverlayLayer, HTMLElement>;
  roots: Map<OverlayLayer, Root>;
}

let internals: OverlayInternals | null = null;

function applyHostStyle(host: HTMLElement): void {
  for (const [prop, value] of HOST_INLINE_STYLE) {
    try {
      host.style.setProperty(prop, value, 'important');
    } catch {
      // A property this engine does not know is not worth failing the mount over.
    }
  }
}

function build(): OverlayInternals {
  const root = document.documentElement;
  if (!root) throw new Error('cannot mount the NextMove overlay: document has no root element');

  const tagName = uniqueTagName();
  const host = document.createElement(tagName);
  host.setAttribute('aria-hidden', 'false');
  applyHostStyle(host);

  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = OVERLAY_STYLES;
  shadow.appendChild(style);

  root.appendChild(host);

  return { host, shadow, tagName, layers: new Map(), roots: new Map() };
}

function layerOf(state: OverlayInternals, name: OverlayLayer): HTMLElement {
  const existing = state.layers.get(name);
  if (existing) return existing;

  const el = document.createElement('div');
  el.className = `jf-layer jf-layer--${name}`;
  const index = OVERLAY_LAYERS.indexOf(name);
  let inserted = false;
  for (const candidate of OVERLAY_LAYERS.slice(index + 1)) {
    const after = state.layers.get(candidate);
    if (after) {
      state.shadow.insertBefore(el, after);
      inserted = true;
      break;
    }
  }
  if (!inserted) state.shadow.appendChild(el);

  state.layers.set(name, el);
  return el;
}

function makeHandle(state: OverlayInternals): OverlayHandle {
  return {
    host: state.host,
    tagName: state.tagName,

    get attached(): boolean {
      return state.host.isConnected;
    },

    layer(name: OverlayLayer): HTMLElement {
      return layerOf(state, name);
    },

    render(name: OverlayLayer, node: ReactNode): void {
      const container = layerOf(state, name);
      let root = state.roots.get(name);
      if (!root) {
        root = createRoot(container, {
          onRecoverableError: (error: unknown) => log.debug(`overlay layer ${name} recovered`, error),
        });
        state.roots.set(name, root);
      }
      root.render(node);
    },

    clear(name: OverlayLayer): void {
      const root = state.roots.get(name);
      if (root) {
        root.render(null);
        return;
      }
      state.layers.get(name)?.replaceChildren();
    },

    ensureAttached(): void {
      if (state.host.isConnected) return;
      const root = document.documentElement;
      if (!root) return;
      applyHostStyle(state.host);
      root.appendChild(state.host);
    },

    destroy(): void {
      for (const [name, root] of state.roots) {
        try {
          root.unmount();
        } catch (error) {
          log.debug(`overlay layer ${name} failed to unmount`, error);
        }
      }
      state.roots.clear();
      state.layers.clear();
      try {
        state.host.remove();
      } catch {
        // Already detached by a host-page re-render — nothing to undo.
      }
      if (internals === state) internals = null;
    },
  };
}

let handle: OverlayHandle | null = null;

export function getOverlay(): OverlayHandle {
  if (internals === null || handle === null) {
    internals = build();
    handle = makeHandle(internals);
  } else {
    handle.ensureAttached();
  }
  return handle;
}

export function overlayMounted(): boolean {
  return internals !== null;
}

export function destroyOverlay(): void {
  handle?.destroy();
  handle = null;
  internals = null;
}
