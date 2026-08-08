/**
 * content/overlay/FieldMarkers.ts — the per-field outlines drawn over the host page.
 *
 * JF-001 Rev 3.0 · F-06 / SEC 4.3 Flow A step 6: "OverlayUI outlines results — blue = filled,
 * yellow = low confidence, red = unmatched." · SEC 4.4 (closed Shadow DOM) · INV-1.
 *
 * Design constraints this file exists to satisfy:
 *
 *   - **Nothing is added to the host page.** Not a class, not a wrapper, not an inline style, not
 *     a `::before`. Every outline is an absolutely-positioned box living inside the overlay's
 *     closed shadow root, tracking the target's viewport rectangle. A page whose layout depends on
 *     `:last-child`, on sibling counts, or on its own class list is unaffected by review mode.
 *
 *   - **INV-1.** A marker is a rectangle. It never focuses, clicks, or dispatches an event at the
 *     element it points to. `reveal()` scrolls a field into view — the one page interaction here,
 *     and it is a read-only camera move requested by the user, not an activation. The "next step"
 *     marker exists precisely so a human can find the button and press it themselves.
 *
 *   - **Page text is untrusted (SEC 9.2).** Badge and tooltip text is assigned through
 *     `textContent` / `setAttribute`, never `innerHTML`.
 *
 * Tracking strategy: rectangles are read on demand rather than watched. Scroll (capture-phase, so
 * inner scroll containers count), resize, and a slow safety interval all schedule a single
 * rAF-coalesced pass. A pass that finds no geometry change costs one `getBoundingClientRect()` per
 * marker and touches no DOM.
 */

import type { OverlayHandle } from './mount';

/* ------------------------------------------------------------------------------------------------
 * Public shapes
 * ---------------------------------------------------------------------------------------------- */

/** The F-06 legend, plus the INV-1 "next step is here" affordance. */
export type MarkerTone = 'filled' | 'suggested' | 'unmatched' | 'next';

export interface MarkerSpec {
  /** Stable id — the field signature hash for form fields. */
  id: string;
  /** The element to outline. Held weakly in the sense that a disconnected node is simply hidden. */
  el: Element;
  tone: MarkerTone;
  /** Short caption on the badge. Page-derived text is rendered with `textContent` only. */
  badge?: string;
  /** Native tooltip text (`title`). Also page-derived, also text-only. */
  tooltip?: string;
}

/** Widest a badge may get before it is more distracting than useful. */
const MAX_BADGE_CHARS = 42;
const MAX_TOOLTIP_CHARS = 240;

/** Outline inset: 3px of breathing room around the control. */
const PAD = 3;

/** Slow safety sweep for layout shifts nothing else reports (font loads, async images). */
const SAFETY_INTERVAL_MS = 600;

interface MarkerEntry {
  spec: MarkerSpec;
  box: HTMLElement;
  badge: HTMLElement | null;
  /** Last painted geometry, so a no-op pass writes no styles at all. */
  last: { top: number; left: number; width: number; height: number; hidden: boolean } | null;
}

function clampText(value: string, max: number): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/* ------------------------------------------------------------------------------------------------
 * FieldMarkers
 * ---------------------------------------------------------------------------------------------- */

export class FieldMarkers {
  private readonly overlay: OverlayHandle;
  private readonly entries = new Map<string, MarkerEntry>();
  private layer: HTMLElement | null = null;
  private frame: number | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private listening = false;
  private disposed = false;

  constructor(overlay: OverlayHandle) {
    this.overlay = overlay;
  }

  /** How many markers are currently drawn. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Replace the whole marker set. Entries whose id survives keep their DOM node (no flicker), the
   * rest are created or removed.
   */
  set(specs: readonly MarkerSpec[]): void {
    if (this.disposed) return;

    const wanted = new Set<string>();
    for (const spec of specs) {
      if (spec.id.length === 0) continue;
      wanted.add(spec.id);
      this.upsert(spec);
    }

    for (const [id, entry] of [...this.entries]) {
      if (wanted.has(id)) continue;
      entry.box.remove();
      this.entries.delete(id);
    }

    if (this.entries.size === 0) {
      this.stopTracking();
      return;
    }
    this.startTracking();
    this.update();
  }

  /** Add or update one marker without disturbing the rest. */
  add(spec: MarkerSpec): void {
    if (this.disposed || spec.id.length === 0) return;
    this.upsert(spec);
    this.startTracking();
    this.update();
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.box.remove();
    this.entries.delete(id);
    if (this.entries.size === 0) this.stopTracking();
  }

  /** Drop every marker. Called on navigation and on teardown. */
  clear(): void {
    for (const entry of this.entries.values()) entry.box.remove();
    this.entries.clear();
    this.stopTracking();
    this.layer?.replaceChildren();
  }

  /**
   * Bring a field into view and flash its outline.
   *
   * INV-1: scrolling is the only host-page interaction in this module. Nothing is focused, and
   * nothing is clicked — including, and especially, the `next`-toned marker.
   */
  reveal(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const el = entry.spec.el;
    if (!el.isConnected) return;

    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    } catch {
      try {
        el.scrollIntoView();
      } catch {
        // Detached or in a scroll container the engine refuses to move — the flash still helps.
      }
    }

    entry.box.classList.remove('jf-marker--pulse');
    // Force a reflow inside our own shadow root so the animation restarts on repeat clicks.
    void entry.box.offsetWidth;
    entry.box.classList.add('jf-marker--pulse');
    this.schedule();
  }

  /** Remove listeners, timers and DOM. The instance is unusable afterwards. */
  dispose(): void {
    this.clear();
    this.disposed = true;
    this.layer = null;
  }

  /* ---- internals --------------------------------------------------------------------------- */

  private container(): HTMLElement {
    if (this.layer === null || !this.layer.isConnected) {
      this.overlay.ensureAttached();
      this.layer = this.overlay.layer('markers');
    }
    return this.layer;
  }

  private upsert(spec: MarkerSpec): void {
    const existing = this.entries.get(spec.id);
    if (existing) {
      existing.spec = spec;
      existing.box.className = `jf-marker jf-marker--${spec.tone}`;
      this.paintBadge(existing, spec);
      existing.last = null; // force a repaint pass
      return;
    }

    const box = document.createElement('div');
    box.className = `jf-marker jf-marker--${spec.tone}`;
    const entry: MarkerEntry = { spec, box, badge: null, last: null };
    this.paintBadge(entry, spec);
    this.container().appendChild(box);
    this.entries.set(spec.id, entry);
  }

  private paintBadge(entry: MarkerEntry, spec: MarkerSpec): void {
    const label = clampText(spec.badge ?? '', MAX_BADGE_CHARS);
    if (label.length === 0) {
      entry.badge?.remove();
      entry.badge = null;
      entry.box.removeAttribute('title');
      return;
    }

    let badge = entry.badge;
    if (badge === null) {
      badge = document.createElement('span');
      badge.className = 'jf-marker__badge';
      entry.box.appendChild(badge);
      entry.badge = badge;
    }
    // SEC 9.2 — page-derived text, assigned as text. Never innerHTML.
    badge.textContent = label;

    const tooltip = clampText(spec.tooltip ?? spec.badge ?? '', MAX_TOOLTIP_CHARS);
    if (tooltip.length > 0) badge.setAttribute('title', tooltip);
    else badge.removeAttribute('title');
  }

  private startTracking(): void {
    if (this.listening || this.disposed) return;
    this.listening = true;
    // Capture phase: a form inside a scrollable panel emits scroll on that panel, not on window.
    window.addEventListener('scroll', this.onViewportChange, { passive: true, capture: true });
    window.addEventListener('resize', this.onViewportChange, { passive: true });
    this.interval = setInterval(this.onViewportChange, SAFETY_INTERVAL_MS);
  }

  private stopTracking(): void {
    if (!this.listening) return;
    this.listening = false;
    window.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange);
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  private readonly onViewportChange = (): void => {
    this.schedule();
  };

  private schedule(): void {
    if (this.disposed || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.update();
    });
  }

  /** One geometry pass. Writes only the styles that actually changed. */
  private update(): void {
    if (this.disposed || this.entries.size === 0) return;
    this.overlay.ensureAttached();

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    for (const entry of this.entries.values()) {
      const el = entry.spec.el;
      let rect: DOMRect | null = null;
      if (el.isConnected) {
        try {
          rect = el.getBoundingClientRect();
        } catch {
          rect = null;
        }
      }

      const hidden =
        rect === null ||
        (rect.width === 0 && rect.height === 0) ||
        rect.bottom < -40 ||
        rect.top > vh + 40 ||
        rect.right < -40 ||
        rect.left > vw + 40;

      if (hidden) {
        if (entry.last?.hidden !== true) {
          entry.box.classList.add('jf-marker--hidden');
          entry.last = { top: 0, left: 0, width: 0, height: 0, hidden: true };
        }
        continue;
      }

      // `rect` is non-null here: `hidden` is true whenever it is null.
      const box = rect as DOMRect;
      const top = Math.round(box.top - PAD);
      const left = Math.round(box.left - PAD);
      const width = Math.round(box.width + PAD * 2);
      const height = Math.round(box.height + PAD * 2);

      const last = entry.last;
      if (
        last !== null &&
        last.hidden === false &&
        last.top === top &&
        last.left === left &&
        last.width === width &&
        last.height === height
      ) {
        continue;
      }

      entry.box.classList.remove('jf-marker--hidden');
      entry.box.style.top = `${top}px`;
      entry.box.style.left = `${left}px`;
      entry.box.style.width = `${width}px`;
      entry.box.style.height = `${height}px`;
      entry.last = { top, left, width, height, hidden: false };
    }
  }
}
