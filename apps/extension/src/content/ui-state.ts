/**
 * content/ui-state.ts — the one persisted bit of chrome for the collapsible bottom-right panel.
 *
 * Scope is deliberately tiny: whether the user last left the panel collapsed into its bubble.
 * Everything else about the panel (which rows are open, scroll position, the pending count) is
 * derived per-page and must NOT live here — persisting it would make a stale disk read fight the
 * live scan, and the panel is supposed to keep its React state across a collapse anyway.
 *
 * This is a device-local preference, not application data. It is stored at the standalone
 * `jf.ui` key with raw `browser.storage.local` rather than through the six-slot map in
 * `platform/storage.ts` — see the rationale on `STORAGE_KEY_UI` in `shared/constants.ts`. The
 * price of skipping that module is that nothing validates the shape for us, so `parseUiState`
 * treats whatever comes back off disk as hostile: another extension version, a half-written
 * object, or a user poking at `chrome.storage` can all put garbage here, and none of that may
 * stop the panel from rendering.
 *
 * Default is collapsed. NextMove has to earn the screen real estate: a bubble on load is a
 * promise, a full panel on load is an interruption.
 */

import { STORAGE_KEY_UI } from '@/shared/constants';
import { createLogger } from '@/platform/logger';

const log = createLogger('ui-state');

export interface UiState {
  panelCollapsed: boolean;
}

export const UI_STORAGE_KEY = STORAGE_KEY_UI;

export const DEFAULT_UI_STATE: UiState = { panelCollapsed: true };

/**
 * Coerce anything at all into a `UiState`. Pure and total: null, arrays, strings, numbers and
 * objects with wrong-typed members all fall back to the default rather than throwing, because
 * every caller here is on the render path and an exception would cost the user the whole panel.
 */
export function parseUiState(raw: unknown): UiState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_UI_STATE };
  const record = raw as { panelCollapsed?: unknown };
  if (typeof record.panelCollapsed !== 'boolean') return { ...DEFAULT_UI_STATE };
  return { panelCollapsed: record.panelCollapsed };
}

export async function readUiState(): Promise<UiState> {
  try {
    const bag = await browser.storage.local.get(UI_STORAGE_KEY);
    return parseUiState((bag as Record<string, unknown>)[UI_STORAGE_KEY]);
  } catch (error) {
    log.debug('could not read ui state', error);
    return { ...DEFAULT_UI_STATE };
  }
}

/**
 * Persist the collapse preference. Written as a whole object rather than merged, since the state
 * has exactly one member — a read-modify-write here would only widen the window for a lost update
 * between two frames of the same page racing to record the user's click.
 */
export async function setPanelCollapsed(collapsed: boolean): Promise<void> {
  const next: UiState = { panelCollapsed: collapsed };
  try {
    await browser.storage.local.set({ [UI_STORAGE_KEY]: next });
  } catch (error) {
    // A failed write costs the user nothing worse than the panel forgetting its state on the next
    // page load; the in-memory toggle has already applied. Never surface this.
    log.debug('could not persist ui state', error);
  }
}
