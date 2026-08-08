import { createLogger } from '@/platform/logger';

import type { OverlayHandle } from './overlay/mount';

const log = createLogger('pill');

export const PILL_STORAGE_KEY = 'jf.pill';

export interface PillPosition {
  left: number;
  top: number;
}

export interface PillState {
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

export async function isPillDismissed(domain: string): Promise<boolean> {
  if (domain.length === 0) return false;
  const state = await readState();
  return Object.prototype.hasOwnProperty.call(state.dismissed, domain);
}

export async function dismissPillForDomain(domain: string): Promise<void> {
  if (domain.length === 0) return;
  const state = await readState();
  state.dismissed[domain] = Date.now();
  await writeState(state);
}

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

export interface FillPillOptions {
  overlay: OverlayHandle;
  onFill: () => void;
  onDismiss?: () => void;
  domain?: string;
  label?: string;
}

const DEFAULT_LABEL = 'Fill this application';
const EDGE_MARGIN = 16;
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

  private defaultPosition(): PillPosition {
    const height = this.root?.offsetHeight ?? 40;
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
