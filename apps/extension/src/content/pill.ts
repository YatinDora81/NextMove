/**
 * content/pill.ts — the floating "Fill this application" pill (F-03).
 *
 * JF-001 Rev 3.0 · F-03 ("Triggered by toolbar click, floating pill button, or shortcut Alt+J") ·
 * SEC 4.3 Flow A step 1 · SEC 9.2 ("No fingerprinting the user's browsing — JobFill activates its
 * UI only when a form scan finds application-shaped fields").
 *
 * Rules this file follows:
 *
 *   - It renders **nothing** until the orchestrator has decided the page is application-shaped.
 *     `content.ts` owns that decision; this module simply never mounts otherwise. Nothing about a
 *     page that is not an application is recorded anywhere.
 *
 *   - The pill lives inside the overlay's closed shadow root (SEC 4.4), so a host page cannot
 *     restyle it, click it, or detect it through the DOM.
 *
 *   - Dismissal is remembered per domain, in the extension's own storage under a single dedicated
 *     key. The host page's `localStorage` is never touched: writing there would leak the fact that
 *     JobFill is installed to any script on the page.
 *
 *   - INV-1 has nothing to fear here — the pill's only action is to ask the orchestrator to run a
 *     fill. It never touches a page control of any kind.
 *
 * Plain DOM rather than React on purpose: the pill is three elements that exist on every detected
 * application page, and it must be cheap (SEC 03: "keep the bundle small for store review").
 */

import { createLogger } from '@/platform/logger';

import type { OverlayHandle } from './overlay/mount';

const log = createLogger('pill');

/* ------------------------------------------------------------------------------------------------
 * Persistence — one dedicated key, outside the SEC 7.1 slot map
 * ---------------------------------------------------------------------------------------------- */

/**
 * `jf.pill` holds only UI preferences: which domains the user waved the pill away on, and where
 * they dragged it. No page content, no URLs beyond the hostname the user explicitly dismissed on,
 * nothing that survives an uninstall.
 */
export const PILL_STORAGE_KEY = 'jf.pill';

export interface PillPosition {
  left: number;
  top: number;
}

export interface PillState {
  /** hostname → epoch ms of the dismissal. */
  dismissed: Record<string, number>;
  position: PillPosition | null;
}

const EMPTY_STATE: PillState = { dismissed: {}, position: null };

function parseState(raw: unknown): PillState {
  if (typeof raw !== 'object' || raw === null) return { dismissed: {}, position: null };
  const record = raw as { dismissed?: unknown; position?: unknown };

  const dismissed: Record<string, number> = {};
  if (typeof record.dismissed === 'object' && record.dismissed !== null) {
    for (const [domain, at] of Object.entries(record.dismissed as Record<string, unknown>)) {
      if (typeof at === 'number' && Number.isFinite(at)) dismissed[domain] = at;
    }
  }

  let position: PillPosition | null = null;
  if (typeof record.position === 'object' && record.position !== null) {
    const candidate = record.position as { left?: unknown; top?: unknown };
    if (
      typeof candidate.left === 'number' &&
      typeof candidate.top === 'number' &&
      Number.isFinite(candidate.left) &&
      Number.isFinite(candidate.top)
    ) {
      position = { left: candidate.left, top: candidate.top };
    }
  }

  return { dismissed, position };
}

async function readState(): Promise<PillState> {
  try {
    const bag = await browser.storage.local.get(PILL_STORAGE_KEY);
    return parseState((bag as Record<string, unknown>)[PILL_STORAGE_KEY]);
  } catch (error) {
    log.debug('could not read pill state', error);
    return { ...EMPTY_STATE, dismissed: {} };
  }
}

async function writeState(state: PillState): Promise<void> {
  try {
    await browser.storage.local.set({ [PILL_STORAGE_KEY]: state });
  } catch (error) {
    log.debug('could not persist pill state', error);
  }
}

/** Has the user waved the pill away on this domain? */
export async function isPillDismissed(domain: string): Promise<boolean> {
  if (domain.length === 0) return false;
  const state = await readState();
  return Object.prototype.hasOwnProperty.call(state.dismissed, domain);
}

/** Remember that the user dismissed the pill on this domain. */
export async function dismissPillForDomain(domain: string): Promise<void> {
  if (domain.length === 0) return;
  const state = await readState();
  state.dismissed[domain] = Date.now();
  await writeState(state);
}

/** Bring the pill back everywhere (Options → "show the fill button again"). */
export async function clearPillDismissals(): Promise<void> {
  const state = await readState();
  state.dismissed = {};
  await writeState(state);
}

export async function loadPillPosition(): Promise<PillPosition | null> {
  return (await readState()).position;
}

export async function savePillPosition(position: PillPosition | null): Promise<void> {
  const state = await readState();
  state.position = position;
  await writeState(state);
}

/* ------------------------------------------------------------------------------------------------
 * The pill
 * ---------------------------------------------------------------------------------------------- */

export interface FillPillOptions {
  overlay: OverlayHandle;
  /** The user asked for a fill. The orchestrator owns everything that happens next. */
  onFill: () => void;
  /** The user dismissed the pill. The domain has already been persisted when this fires. */
  onDismiss?: () => void;
  /** Domain the dismissal is remembered against. Defaults to `location.hostname`. */
  domain?: string;
  label?: string;
}

const DEFAULT_LABEL = 'Fill this application';
const EDGE_MARGIN = 16;
/** Movement under this many pixels is a click, not a drag. */
const DRAG_SLOP = 4;

export class FillPill {
  private readonly options: FillPillOptions;
  private readonly domain: string;

  private root: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private fillEl: HTMLButtonElement | null = null;
  private position: PillPosition | null = null;

  private dragging = false;
  private moved = false;
  private pointerId: number | null = null;
  private grabDx = 0;
  private grabDy = 0;
  private shown = false;
  private busy = false;
  private disposed = false;

  constructor(options: FillPillOptions) {
    this.options = options;
    this.domain = options.domain ?? (typeof location === 'undefined' ? '' : location.hostname);
  }

  get visible(): boolean {
    return this.shown;
  }

  /** Mount and show the pill. Restores the user's dragged position on first show. */
  show(): void {
    if (this.disposed) return;
    const root = this.ensureRoot();
    root.style.display = 'flex';
    this.shown = true;
    if (this.position === null) {
      void loadPillPosition().then((saved) => {
        if (this.disposed) return;
        this.position = saved ?? this.defaultPosition();
        this.applyPosition();
      });
    } else {
      this.applyPosition();
    }
    window.addEventListener('resize', this.onResize, { passive: true });
  }

  hide(): void {
    this.shown = false;
    if (this.root) this.root.style.display = 'none';
    window.removeEventListener('resize', this.onResize);
  }

  setLabel(text: string): void {
    if (this.labelEl) this.labelEl.textContent = text;
  }

  /**
   * Busy state during a fill run. The button is disabled so a second click cannot start a second
   * concurrent run over the same form.
   */
  setBusy(busy: boolean, text = 'Filling…'): void {
    this.busy = busy;
    if (this.fillEl) {
      this.fillEl.disabled = busy;
      this.fillEl.textContent = busy ? text : 'Fill';
    }
    this.root?.classList.toggle('jf-pill--busy', busy);
  }

  dispose(): void {
    this.disposed = true;
    this.shown = false;
    window.removeEventListener('resize', this.onResize);
    this.detachDragListeners();
    this.root?.remove();
    this.root = null;
    this.labelEl = null;
    this.fillEl = null;
  }

  /* ---- construction ------------------------------------------------------------------------ */

  private ensureRoot(): HTMLElement {
    if (this.root !== null && this.root.isConnected) return this.root;

    const layer = this.options.overlay.layer('pill');

    const root = document.createElement('div');
    root.className = 'jf-pill';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'NextMove');

    const grip = document.createElement('div');
    grip.className = 'jf-pill__grip';
    grip.title = 'Drag to move';

    const dot = document.createElement('span');
    dot.className = 'jf-pill__dot';
    grip.appendChild(dot);

    const label = document.createElement('span');
    label.className = 'jf-pill__label';
    label.textContent = this.options.label ?? DEFAULT_LABEL;
    grip.appendChild(label);

    const fill = document.createElement('button');
    fill.type = 'button';
    fill.className = 'jf-pill__fill';
    fill.textContent = 'Fill';
    fill.title = 'Fill this application with your NextMove profile (Alt+J)';
    fill.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.busy) return;
      this.options.onFill();
    });

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'jf-pill__close';
    close.textContent = '✕';
    close.title = `Hide NextMove on ${this.domain || 'this site'}`;
    close.setAttribute('aria-label', 'Hide NextMove on this site');
    close.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.hide();
      void dismissPillForDomain(this.domain);
      this.options.onDismiss?.();
    });

    grip.addEventListener('pointerdown', this.onPointerDown);

    root.append(grip, fill, close);
    layer.appendChild(root);

    this.root = root;
    this.labelEl = label;
    this.fillEl = fill;
    return root;
  }

  /* ---- placement --------------------------------------------------------------------------- */

  private defaultPosition(): PillPosition {
    const height = this.root?.offsetHeight ?? 40;
    // Bottom-left: the review panel and the toast stack both own the bottom-right corner.
    return { left: EDGE_MARGIN, top: Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN) };
  }

  private clamp(position: PillPosition): PillPosition {
    const width = this.root?.offsetWidth ?? 200;
    const height = this.root?.offsetHeight ?? 40;
    const maxLeft = Math.max(0, window.innerWidth - width - 4);
    const maxTop = Math.max(0, window.innerHeight - height - 4);
    return {
      left: Math.min(Math.max(4, position.left), maxLeft),
      top: Math.min(Math.max(4, position.top), maxTop),
    };
  }

  private applyPosition(): void {
    if (this.root === null) return;
    const position = this.clamp(this.position ?? this.defaultPosition());
    this.position = position;
    this.root.style.left = `${position.left}px`;
    this.root.style.top = `${position.top}px`;
    this.root.style.right = 'auto';
    this.root.style.bottom = 'auto';
  }

  private readonly onResize = (): void => {
    if (!this.shown) return;
    this.applyPosition();
  };

  /* ---- dragging ---------------------------------------------------------------------------- */

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.root === null || event.button !== 0) return;
    const rect = this.root.getBoundingClientRect();
    this.dragging = true;
    this.moved = false;
    this.pointerId = event.pointerId;
    this.grabDx = event.clientX - rect.left;
    this.grabDy = event.clientY - rect.top;
    this.root.classList.add('jf-pill--dragging');

    try {
      (event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is a nicety; the window listeners below carry the drag either way.
    }
    window.addEventListener('pointermove', this.onPointerMove, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    event.preventDefault();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging || this.root === null) return;
    if (this.pointerId !== null && event.pointerId !== this.pointerId) return;

    const next = { left: event.clientX - this.grabDx, top: event.clientY - this.grabDy };
    if (
      !this.moved &&
      Math.abs(next.left - (this.position?.left ?? next.left)) < DRAG_SLOP &&
      Math.abs(next.top - (this.position?.top ?? next.top)) < DRAG_SLOP
    ) {
      return;
    }
    this.moved = true;
    this.position = next;
    this.applyPosition();
    event.preventDefault();
  };

  private readonly onPointerUp = (): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.pointerId = null;
    this.root?.classList.remove('jf-pill--dragging');
    this.detachDragListeners();
    if (this.moved && this.position !== null) void savePillPosition(this.clamp(this.position));
  };

  private detachDragListeners(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  }
}
