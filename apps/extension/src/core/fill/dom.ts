/**
 * core/fill/dom.ts — DOM primitives shared by every fill strategy (ISOLATED world).
 *
 * JF-001 Rev 3.0 · SEC 6.4 (FillEngine — strategy per input type) · INV-1 (never auto-submit).
 *
 * A content script shares the host page's DOM but not its JS realm, so everything here reads and
 * writes the *real* nodes while remaining invisible to page scripts. `isSubmitControl` is the
 * ISOLATED-world half of the INV-1 guard; `entrypoints/main-world.content.ts` enforces the exact
 * same rule on the far side of the bridge — the invariant is checked twice, on purpose.
 */

/** Stamped by `bridge.stampSelector` so the MAIN world can address the same node. */
export const JOBFILL_ID_ATTR = 'data-jobfill-id';

/**
 * INV-1 — accessible names that mean "this control submits the application".
 * Fixed by the shared bridge contract; the MAIN-world script uses the identical pattern.
 */
export const SUBMIT_NAME_RE = /submit|apply now|send application/i;

/** Thrown only by `assertNotSubmitControl`; every strategy converts it into a failed result. */
export class SubmitControlError extends Error {
  readonly element: Element;
  readonly op: string;

  constructor(element: Element, op: string) {
    super(`INV-1: refused to ${op} a submit control <${element.tagName.toLowerCase()}>`);
    this.name = 'SubmitControlError';
    this.element = element;
    this.op = op;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Narrowing helpers — FieldNode.el is `unknown` by contract (SEC 6.2)
 * ---------------------------------------------------------------------------------------------- */

export function asElement(node: unknown): HTMLElement | null {
  return node instanceof HTMLElement ? node : null;
}

export function isTextLike(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  const t = el.type.toLowerCase();
  return (
    t === 'text' ||
    t === 'email' ||
    t === 'tel' ||
    t === 'url' ||
    t === 'search' ||
    t === 'number' ||
    t === 'password' ||
    t === ''
  );
}

export function isFileInput(el: Element): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type.toLowerCase() === 'file';
}

export function isCheckable(el: Element): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) return false;
  const t = el.type.toLowerCase();
  return t === 'radio' || t === 'checkbox';
}

/** True when the element advertises typeahead behaviour, whatever the scanner labelled it. */
export function looksLikeCombobox(el: Element): boolean {
  const role = (el.getAttribute('role') ?? '').toLowerCase();
  if (role === 'combobox') return true;
  const auto = (el.getAttribute('aria-autocomplete') ?? '').toLowerCase();
  if (auto === 'list' || auto === 'both') return true;
  if (el.hasAttribute('aria-controls') && el.hasAttribute('aria-expanded')) return true;
  return false;
}

/* ------------------------------------------------------------------------------------------------
 * INV-1 — the submit guard
 * ---------------------------------------------------------------------------------------------- */

/**
 * INV-1: located and highlighted, never clicked.
 *
 * A control is treated as a submit control when it is `type=submit`, `type=image`, a `<button>`
 * with no explicit `type` (HTML defaults such a button to `submit`), or anything button-shaped
 * whose accessible name reads like a submission. `formaction` is also a hard stop — it exists only
 * to submit a form.
 */
export function isSubmitControl(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') ?? '').toLowerCase();

  if (type === 'submit' || type === 'image') return true;
  if (el.hasAttribute('formaction')) return true;

  if (tag === 'button') {
    // A <button> without an explicit type submits its form. Never touch one.
    if (!el.hasAttribute('type')) return true;
    if (SUBMIT_NAME_RE.test(accessibleName(el))) return true;
    return false;
  }

  const role = (el.getAttribute('role') ?? '').toLowerCase();
  if (role === 'button' && SUBMIT_NAME_RE.test(accessibleName(el))) return true;

  if (tag === 'input' && (type === 'button' || type === 'reset')) {
    return SUBMIT_NAME_RE.test(accessibleName(el));
  }

  return false;
}

/** INV-1: throws before any write/click can reach a submit control. */
export function assertNotSubmitControl(el: Element, op: string): void {
  if (isSubmitControl(el)) throw new SubmitControlError(el, op);
}

/**
 * Wizard advance controls. INV-1 is not only about the final Submit button: "Next-step buttons are
 * located/highlighted, never clicked." Advancing a Workday/iCIMS/Taleo step COMMITS the answers on
 * the current page, so it is exactly as forbidden as pressing Apply.
 */
export const NEXT_NAME_RE = /^(next|continue|save\s*(and|&)?\s*continue|proceed|forward)\b/i;

/**
 * The CLICK-specific refusal set: everything `isSubmitControl` catches, plus wizard advance and
 * real navigation.
 *
 * This MUST stay identical to `isForbiddenClickTarget` in `entrypoints/main-world.content.ts`.
 * The two halves of the bridge previously disagreed: MAIN refused next-step buttons and real links,
 * the ISOLATED half did not, and `bridge.click()` falls back to the ISOLATED path whenever the MAIN
 * call fails — including when it failed *because MAIN refused on INV-1 grounds*. The net effect was
 * that `<button type="button">Continue</button>`, `<div role="button">Next</div>` and
 * `<a href="/step2">Next</a>` were refused by the strong guard and then clicked by the weak one,
 * advancing a multi-step application. An asymmetric guard is worse than no guard, because it reads
 * as protection.
 */
export function isForbiddenClickTarget(el: Element): boolean {
  if (isSubmitControl(el)) return true;

  const tag = el.tagName.toLowerCase();
  if (tag === 'a') {
    const href = (el.getAttribute('href') ?? '').trim();
    // A real link navigates away, losing everything filled. Only in-page anchors used as ARIA
    // options (href="#...") are legitimate click targets.
    if (href.length > 0 && !href.startsWith('#')) return true;
  }

  const role = (el.getAttribute('role') ?? '').toLowerCase();
  const buttonish = tag === 'button' || tag === 'a' || role === 'button' || role === 'link';
  if (buttonish && NEXT_NAME_RE.test(accessibleName(el))) return true;

  return false;
}

/** INV-1: throws before any CLICK can reach a submit, wizard-advance or navigation control. */
export function assertClickable(el: Element, op: string): void {
  if (isForbiddenClickTarget(el)) throw new SubmitControlError(el, op);
}

/* ------------------------------------------------------------------------------------------------
 * Naming / labelling
 * ---------------------------------------------------------------------------------------------- */

export function rootOf(el: Node): Document | ShadowRoot {
  const root = el.getRootNode();
  if (root instanceof ShadowRoot) return root;
  if (root instanceof Document) return root;
  return el.ownerDocument ?? document;
}

export function cssEscape(value: string): string {
  const g = globalThis as { CSS?: { escape?: (v: string) => string } };
  const escaper = g.CSS?.escape;
  if (typeof escaper === 'function') return escaper(value);
  return value.replace(/["'\\\][:.#>+~*^$|()=% ,]/g, '\\$&');
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function referencedText(el: Element, attr: string): string {
  const ids = (el.getAttribute(attr) ?? '').split(/\s+/).filter((id) => id.length > 0);
  if (ids.length === 0) return '';
  const root = rootOf(el);
  const parts: string[] = [];
  for (const id of ids) {
    const target = root.querySelector(`#${cssEscape(id)}`);
    if (target) parts.push(collapse(target.textContent ?? ''));
  }
  return collapse(parts.join(' '));
}

/** Best-effort accessible name — enough to recognise a submit control or a listbox option. */
export function accessibleName(el: Element): string {
  const labelledBy = referencedText(el, 'aria-labelledby');
  if (labelledBy) return labelledBy;

  const ariaLabel = collapse(el.getAttribute('aria-label') ?? '');
  if (ariaLabel) return ariaLabel;

  if (el instanceof HTMLInputElement) {
    const t = el.type.toLowerCase();
    if (t === 'submit' || t === 'button' || t === 'reset') {
      const v = collapse(el.value);
      if (v) return v;
    }
    if (t === 'image') {
      const alt = collapse(el.alt);
      if (alt) return alt;
    }
  }

  const text = collapse(el.textContent ?? '');
  if (text) return text;

  return collapse(el.getAttribute('title') ?? '');
}

/** The visible label for a form control, walking the same chain the scanner uses (SEC 6.2). */
export function labelTextFor(el: Element): string {
  const labelledBy = referencedText(el, 'aria-labelledby');
  if (labelledBy) return labelledBy;

  const ariaLabel = collapse(el.getAttribute('aria-label') ?? '');
  if (ariaLabel) return ariaLabel;

  const id = el.getAttribute('id');
  if (id) {
    const root = rootOf(el);
    const forLabel = root.querySelector(`label[for="${cssEscape(id)}"]`);
    if (forLabel) {
      const t = collapse(forLabel.textContent ?? '');
      if (t) return t;
    }
  }

  const wrapping = el.closest('label');
  if (wrapping) {
    const clone = wrapping.cloneNode(true) as HTMLElement;
    for (const control of Array.from(clone.querySelectorAll('input, select, textarea'))) {
      control.remove();
    }
    const t = collapse(clone.textContent ?? '');
    if (t) return t;
  }

  const title = collapse(el.getAttribute('title') ?? '');
  if (title) return title;

  const placeholder = collapse(el.getAttribute('placeholder') ?? '');
  if (placeholder) return placeholder;

  // Custom-styled controls often put the caption in the very next sibling.
  const sibling = el.nextElementSibling;
  if (sibling) {
    const t = collapse(sibling.textContent ?? '');
    if (t && t.length <= 120) return t;
  }

  const parent = el.parentElement;
  if (parent) {
    const t = collapse(parent.textContent ?? '');
    if (t && t.length <= 120) return t;
  }

  const value = collapse(el.getAttribute('value') ?? '');
  return value;
}

/** The clickable proxy for a visually hidden input (custom-styled radios/checkboxes). */
export function labelElementFor(el: Element): HTMLElement | null {
  const id = el.getAttribute('id');
  if (id) {
    const root = rootOf(el);
    const forLabel = root.querySelector(`label[for="${cssEscape(id)}"]`);
    if (forLabel instanceof HTMLElement) return forLabel;
  }
  const wrapping = el.closest('label');
  return wrapping instanceof HTMLElement ? wrapping : null;
}

/* ------------------------------------------------------------------------------------------------
 * Visibility
 * ---------------------------------------------------------------------------------------------- */

/**
 * `Element.checkVisibility` is the authority when it exists — the manifest requires Chrome 116, so
 * in production it always does. It understands `display`, `visibility`, `opacity` and
 * `content-visibility` in one call, which is exactly the set of tricks ATS use to hide a real input
 * behind a styled proxy. The computed-style path below is the fallback for DOM implementations
 * without it; a bounding rect alone is not usable, because a layout-less DOM reports zero for
 * everything and would declare the whole page invisible.
 */
export function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  const html = el as HTMLElement;
  if (typeof html.checkVisibility === 'function') {
    return html.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  }
  const view = el.ownerDocument?.defaultView;
  if (view) {
    const style = view.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (style.opacity !== '' && Number(style.opacity) === 0) return false;
  }
  if (el.hasAttribute('hidden')) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 || typeof html.checkVisibility !== 'function';
}

/** True for the classic "real input hidden behind a styled span" pattern. */
export function isVisuallyHidden(el: Element): boolean {
  return el.isConnected && !isVisible(el);
}

/* ------------------------------------------------------------------------------------------------
 * Reading values back (verification without a bridge round-trip)
 * ---------------------------------------------------------------------------------------------- */

export function readLocalValue(el: Element): string | null {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLSelectElement) return el.value;
  const html = el as HTMLElement;
  if (html.isContentEditable) return html.textContent ?? '';
  const attr = el.getAttribute('value');
  if (attr !== null) return attr;
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * Event helpers
 * ---------------------------------------------------------------------------------------------- */

/**
 * Dispatch a synthetic key event. Deliberately never used for `Enter` inside a form: a page
 * handler could turn that into a submission, and INV-1 forbids us creating that opportunity.
 */
export function dispatchKey(el: Element, type: 'keydown' | 'keyup' | 'keypress', key: string): void {
  const view = el.ownerDocument?.defaultView ?? window;
  const init: KeyboardEventInit = {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    bubbles: true,
    cancelable: true,
    composed: true,
    view,
  };
  el.dispatchEvent(new KeyboardEvent(type, init));
}

export function dispatchInputAndChange(el: Element): void {
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

/* ------------------------------------------------------------------------------------------------
 * Timing
 * ---------------------------------------------------------------------------------------------- */

/** Inclusive integer in [min, max]. Human-ish pacing (SEC 6.4 / SEC 13 bot-detection mitigation). */
export function jitter(min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/**
 * Abort check behind a function call. Reading `signal.aborted` inline lets TypeScript narrow the
 * property to `false` for the rest of the scope, which silently disables every later check.
 */
export function isAborted(signal?: AbortSignal): boolean {
  return signal !== undefined && signal.aborted;
}

/** Resolves early (never rejects) when `signal` aborts — callers check `signal.aborted`. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Wait for the next animation/microtask flush so a framework can react to our events. */
export function nextTick(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/* ------------------------------------------------------------------------------------------------
 * SEC 6.4 — the framework-safe write primitive
 * ---------------------------------------------------------------------------------------------- */

/** Sets `value` through the prototype setter without firing anything. */
export function setNativeValueRaw(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value); // bypasses React's value trap
  else el.value = value;
}

export type ValueEventName = 'input' | 'change' | 'blur';

export function dispatchValueEvents(el: Element, events: readonly ValueEventName[]): void {
  for (const name of events) el.dispatchEvent(new Event(name, { bubbles: true }));
}
