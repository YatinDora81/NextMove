/**
 * core/scanner.ts — FormScanner: the DOM → `FieldNode[]` pass.
 *
 * Implements JF-001 Rev 3.0:
 *   SEC 4.3 Flow A step 3 — "FormScanner walks document + same-origin iframes + open shadow roots
 *                            → emits FieldNode[] with signatures"
 *   SEC 4.4 — "Cross-origin iframes without host access remain unreachable — declared limitation,
 *              surfaced honestly in the overlay". This module DETECTS and REPORTS them; it never
 *              pretends to have read them. See `ScanResult.unreachableFrames`.
 *   SEC 6.2 — `FieldNode { el, sig, visible, required }`
 *   SEC 6.5 — legacy iCIMS / Taleo "iframe soup": child-frame results merge into the parent's list
 *
 * The scanner reads. It never writes, never clicks, never focuses, never submits (INV-1). The only
 * DOM mutation anywhere in this file is on a *detached clone* inside `signature.elementText`.
 *
 * Like `signature.ts`, every narrowing here is realm-safe (`nodeType` / `tagName`, never
 * `instanceof`), because elements pulled out of a same-origin iframe belong to another realm.
 */

import type { FieldNode } from '@/shared/types';

import {
  attrOf,
  buildFieldSignature,
  describeElement,
  elementOf,
  matches,
  searchRootOf,
  tagOf,
} from './signature';

/* ------------------------------------------------------------------------------------------------
 * Public shapes
 * ---------------------------------------------------------------------------------------------- */

/** Why a frame could not be read from this context. */
export type UnreachableFrameReason = 'cross-origin' | 'sandboxed' | 'not-loaded';

/**
 * An iframe this frame's scanner cannot see into. SEC 4.4 requires that this be surfaced to the
 * user rather than silently dropped: "this form is inside a frame we can't access".
 *
 * Note the nuance the overlay copy must respect: the extension is injected with `all_frames: true`,
 * so a cross-origin frame is very often scanned by its OWN content-script instance and merged in
 * the top frame over the bus. An entry here means "*this* scanner could not traverse into it",
 * not necessarily "nobody covered it".
 */
export interface UnreachableFrame {
  /** The frame's `src` as authored, or `''`. */
  src: string;
  /** Origin resolved against the host document; `''` when it cannot be parsed. */
  origin: string;
  reason: UnreachableFrameReason;
  /** Short human-readable locator for the overlay ("iframe#application_frame"). */
  description: string;
}

export interface ScanStats {
  /** Reachable browsing contexts traversed, including the root document. */
  frames: number;
  /** Open shadow roots traversed. Closed roots are invisible to any extension by design. */
  shadowRoots: number;
  /** Elements visited across every reachable root. */
  elementsVisited: number;
  /** Controls that matched the fillable predicate before filtering. */
  candidates: number;
  /** Dropped because they were not rendered. */
  skippedHidden: number;
  /** Dropped because they were disabled or readonly — writing them is impossible, not merely rude. */
  skippedInert: number;
  /** Dropped by {@link isHoneypot}. */
  skippedHoneypot: number;
  /** Radio inputs folded into an existing group node. */
  mergedRadios: number;
  durationMs: number;
}

export interface ScanResult {
  fields: FieldNode[];
  /** SEC 4.4 — declared limitation, reported honestly. */
  unreachableFrames: UnreachableFrame[];
  /** True when `maxFields` cut the walk short; the overlay must say so rather than imply totality. */
  truncated: boolean;
  stats: ScanStats;
}

export interface ScanOptions {
  /** Chrome frame id of the frame this scanner runs in. Recorded on every signature. */
  frameId?: number;
  /**
   * Keep controls that are not currently rendered, flagged `visible: false`. Off by default:
   * a hidden control cannot be filled now, and multi-step wizards re-scan on step change
   * (`core/observer.ts`) rather than pre-filling steps the user has not reached.
   */
  includeHidden?: boolean;
  /** Hard ceiling on collected fields. Protects against pathological pages. */
  maxFields?: number;
  /** How deep to recurse through nested shadow roots and frames. */
  maxDepth?: number;
  /** Skip honeypot detection. Only ever useful in tests and fixtures. */
  includeHoneypots?: boolean;
}

/** Defaults, exported so tests and the overlay can describe the scanner's behaviour accurately. */
export const DEFAULT_SCAN_OPTIONS: Required<ScanOptions> = {
  frameId: 0,
  includeHidden: false,
  maxFields: 400,
  maxDepth: 8,
  includeHoneypots: false,
};

/* ------------------------------------------------------------------------------------------------
 * What counts as a fillable control
 * ---------------------------------------------------------------------------------------------- */

/** `<input type>` values JobFill will never write: page furniture or credentials. */
const NON_FILLABLE_INPUT_TYPES: ReadonlySet<string> = new Set([
  'hidden',
  'submit',
  'reset',
  'button',
  'image',
  'password', // the vault holds no passwords, and account creation is not an application
]);

/** ARIA roles that mark a non-native widget as a fillable control (Workday, Ashby, iCIMS). */
const FILLABLE_ROLES: ReadonlySet<string> = new Set([
  'combobox',
  'listbox',
  'textbox',
  'searchbox',
  'radio',
  'checkbox',
  'switch',
  'spinbutton',
]);

/**
 * Is this element something the FillEngine could write to?
 *
 * Native controls first; ARIA-only widgets second, and only when they do not *wrap* a native
 * control (otherwise Ashby's `<div role="combobox"><input/></div>` would be collected twice and
 * the FillEngine would type into the wrapper).
 */
export function isFillableControl(el: Element): boolean {
  const tag = tagOf(el);

  if (tag === 'textarea' || tag === 'select') return true;

  if (tag === 'input') {
    const type = attrOf(el, 'type').toLowerCase();
    return !NON_FILLABLE_INPUT_TYPES.has(type);
  }

  // `<label>` and `<option>` are never targets. `<button>` / `<a>` normally are not either — but
  // Workday renders its dropdowns as `<button role="combobox" data-automation-id="...">`, so one
  // carrying a fillable ARIA role is a genuine control. A plain submit button has no such role and
  // stays excluded, which is also the first line of defence for INV-1.
  if (tag === 'label' || tag === 'option') return false;
  if (tag === 'button' || tag === 'a') {
    const buttonRole = attrOf(el, 'role');
    return buttonRole.length > 0 && FILLABLE_ROLES.has(buttonRole) && !containsNativeControl(el);
  }

  const editable = attrOf(el, 'contenteditable').toLowerCase();
  if (editable === 'true' || editable === 'plaintext-only' || (editable === '' && el.hasAttribute('contenteditable'))) {
    return !containsNativeControl(el);
  }

  const role = attrOf(el, 'role');
  if (role.length > 0 && FILLABLE_ROLES.has(role)) {
    return !containsNativeControl(el);
  }

  return false;
}

function containsNativeControl(el: Element): boolean {
  try {
    return el.querySelector('input,select,textarea') !== null;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Visibility
 * ---------------------------------------------------------------------------------------------- */

function windowOf(el: Element): (Window & typeof globalThis) | null {
  const doc = el.ownerDocument;
  return doc?.defaultView ?? null;
}

function computedStyleOf(el: Element): CSSStyleDeclaration | null {
  const view = windowOf(el);
  if (view === null || typeof view.getComputedStyle !== 'function') return null;
  try {
    return view.getComputedStyle(el);
  } catch {
    return null;
  }
}

function boundingRectOf(el: Element): DOMRect | null {
  const measure = (el as Partial<Element>).getBoundingClientRect;
  if (typeof measure !== 'function') return null;
  try {
    return measure.call(el);
  } catch {
    return null;
  }
}

/**
 * Does this document perform layout at all?
 *
 * `documentElement` always has a non-degenerate box in a rendered page, so a 0×0 root means we are
 * in a non-layout environment — happy-dom / jsdom under the test runner, or a document that has
 * not been painted yet. Geometry is then meaningless and must NOT be read as "hidden", or the
 * scanner would return an empty field list everywhere except a real browser tab.
 *
 * Cached per document: the answer cannot change for a given document.
 */
const layoutCapableDocs = new WeakMap<Document, boolean>();

function hasLayout(el: Element): boolean {
  const doc = el.ownerDocument;
  if (doc === null) return false;

  const cached = layoutCapableDocs.get(doc);
  if (cached !== undefined) return cached;

  let capable = false;
  const root = doc.documentElement;
  if (root !== null && root !== undefined) {
    const rect = boundingRectOf(root);
    capable = rect !== null && (rect.width > 0 || rect.height > 0);
  }
  layoutCapableDocs.set(doc, capable);
  return capable;
}

/**
 * The visible thing that stands in for a styled-away `<input type=file>` (SEC 6.4 / SEC 6.5).
 *
 * Ordered by how much authority each signal carries: a `label[for=…]` and a wrapping `<label>` are
 * the HTML contract — the browser itself routes a click on them into the input — and the class /
 * data-attribute shapes below are the dropzone vocabulary the shipped adapters already declare in
 * `quirks.dropzoneSelectors`.
 */
const FILE_ZONE_SELECTORS: readonly string[] = [
  '[class*="dropzone" i]',
  '[class*="drop-zone" i]',
  '[class*="droparea" i]',
  '[class*="drop-area" i]',
  '[class*="file-upload" i]',
  '[class*="fileupload" i]',
  '[class*="upload" i]',
  '[class*="attachment" i]',
  '[data-testid*="drop" i]',
  '[data-testid*="upload" i]',
  '[data-qa*="drop" i]',
  '[data-qa*="upload" i]',
  '[data-automation-id*="attachment" i]',
  '[data-automation-id*="fileupload" i]',
  '[aria-label*="drop" i]',
  '[role="button"]',
  'label',
];

/** How far up we will look for the zone. Deeper than this and it is somebody else's widget. */
const FILE_ZONE_MAX_DEPTH = 5;

/**
 * Is `el` a file input that a human can still reach, despite its own style saying `display:none`?
 *
 * Answering yes requires a VISIBLE activator, never just "it is a file input". Without that rule
 * the scanner would start offering genuinely dead controls — an attachment input inside a collapsed
 * wizard step, say — and the overlay would ask the user to check a field that is not on screen.
 *
 * Not recursive in practice: an activator is a `<label>` or a container, never a file input, so the
 * `isVisible` call below cannot re-enter this function.
 */
function isFileInputBehindVisibleZone(el: Element): boolean {
  if (tagOf(el) !== 'input') return false;
  if (attrOf(el, 'type').toLowerCase() !== 'file') return false;

  // 1 — <label for="…">: the browser's own click-forwarding contract.
  const id = attrOf(el, 'id');
  if (id.length > 0) {
    const root = searchRootOf(el);
    if (root !== null) {
      try {
        const label = root.querySelector(`label[for="${cssEscapeForScan(id)}"]`);
        if (label !== null && isVisible(label)) return true;
      } catch {
        /* malformed id → not a usable selector; fall through to the ancestor walk */
      }
    }
  }

  // 2 — a wrapping <label>, or a dropzone-shaped ancestor close enough to be this input's widget.
  let parent = el.parentElement;
  for (let depth = 0; parent !== null && depth < FILE_ZONE_MAX_DEPTH; depth++) {
    if (FILE_ZONE_SELECTORS.some((selector) => matches(parent as Element, selector))) {
      if (isVisible(parent)) return true;
    }
    parent = parent.parentElement;
  }

  return false;
}

/** `CSS.escape` with the same conservative fallback `signature.ts` uses. */
function cssEscapeForScan(value: string): string {
  const globalCss = (globalThis as { CSS?: { escape?: (input: string) => string } }).CSS;
  if (globalCss !== undefined && typeof globalCss.escape === 'function') {
    try {
      return globalCss.escape(value);
    } catch {
      /* fall through */
    }
  }
  return value.replace(/[^\w-]/g, (character) => `\\${character}`);
}

/**
 * Is the control actually rendered?
 *
 * Combines the four independent signals, because no single one is sufficient on real ATS markup:
 *   - `display:none` / `visibility:hidden|collapse` / `opacity:0` from the computed style;
 *   - the `hidden` attribute;
 *   - an inherited `aria-hidden="true"`, which is how several ATS hide inactive wizard steps;
 *   - a non-degenerate layout box (client rects), which catches every ancestor-driven case that
 *     the element's own computed style cannot see.
 *
 * `offsetParent` is used only as a corroborating signal: it is `null` for `position: fixed`
 * elements that are perfectly visible, so it can never be the deciding vote on its own.
 */
export function isVisible(el: Element): boolean {
  const html = el as HTMLElement;

  if (html.hidden === true) return false;

  const style = computedStyleOf(el);
  if (style !== null) {
    const styleHides =
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      style.contentVisibility === 'hidden' ||
      (() => {
        const opacity = Number.parseFloat(style.opacity);
        return Number.isFinite(opacity) && opacity <= 0.01;
      })();

    // A `display:none` <input type=file> behind a real dropzone is NOT hidden in the sense that
    // matters here. It is the single most common way an ATS renders an attachment control (SEC 6.4:
    // "if the ATS hides the input behind a dropzone…"): the input is styled away and a labelled
    // zone — the thing the user actually sees, clicks and drops onto — stands in for it. Judging
    // the input by its own computed style drops the whole field, so JobFill never even offers to
    // attach a resume on those sites, and SEC 6.4's `drop`-on-the-zone half becomes unreachable.
    //
    // The exemption is deliberately narrow: only file inputs, and only when a VISIBLE activator
    // (a `label[for=…]`, a wrapping `<label>`, or a nearby dropzone-shaped ancestor) proves the
    // control is reachable by a human. A file input hidden with nothing visible attached to it
    // stays hidden, and no other input type is affected — so pre-rendered wizard steps, collapsed
    // sections and honeypots are all untouched.
    if (styleHides) return isFileInputBehindVisibleZone(el);
  }

  if (ancestorAriaHidden(el)) return false;

  // Nothing in the style said hidden. In a document that does not lay out, that verdict is final:
  // there is no geometry to corroborate it with.
  if (!hasLayout(el)) return true;

  const rect = boundingRectOf(el);
  if (rect !== null && rect.width > 0 && rect.height > 0) return true;

  // Zero-area but possibly laid out across line boxes (rare, but real for inline widgets).
  const getRects = (el as Partial<Element>).getClientRects;
  if (typeof getRects === 'function') {
    try {
      const rects = getRects.call(el);
      for (let i = 0; i < rects.length; i++) {
        const candidate = rects[i];
        if (candidate !== undefined && candidate.width > 0 && candidate.height > 0) return true;
      }
    } catch {
      /* ignore */
    }
  }

  // A file input behind a styled dropzone and a visually-hidden checkbox are both legitimately
  // 0×0 (SEC 6.4), so a degenerate box alone does not condemn them — `offsetParent` decides
  // whether they are merely unpainted or genuinely detached from the layout tree.
  if (rect !== null && html.offsetParent !== null) {
    const tag = tagOf(el);
    if (tag === 'input') {
      const type = attrOf(el, 'type').toLowerCase();
      if (type === 'file' || type === 'checkbox' || type === 'radio') return true;
    }
  }

  return false;
}

function ancestorAriaHidden(el: Element): boolean {
  let node: Element | null = el;
  let depth = 0;
  while (node !== null && depth < 30) {
    if (attrOf(node, 'aria-hidden') === 'true') return true;
    node = node.parentElement;
    depth++;
  }
  return false;
}

/* ------------------------------------------------------------------------------------------------
 * Inert controls & honeypots
 * ---------------------------------------------------------------------------------------------- */

/** Disabled or readonly — the FillEngine cannot write these, native or ARIA. */
export function isInert(el: Element): boolean {
  if (el.hasAttribute('disabled')) return true;
  if (attrOf(el, 'aria-disabled') === 'true') return true;
  if (el.hasAttribute('readonly')) return true;
  if (attrOf(el, 'aria-readonly') === 'true') return true;

  // `inert` on any ancestor takes the whole subtree out of the interaction model.
  let node: Element | null = el;
  let depth = 0;
  while (node !== null && depth < 30) {
    if (node.hasAttribute('inert')) return true;
    if (tagOf(node) === 'fieldset' && node.hasAttribute('disabled')) return true;
    node = node.parentElement;
    depth++;
  }
  return false;
}

/** Names/ids/classes that betray a spam trap. */
const HONEYPOT_PATTERN =
  /honey ?_?-?pot|hp_?field|bot_?field|is_?bot|leave_?-?this_?-?blank|do_?-?not_?-?fill|nofill|spam_?trap|antispam|anti_?bot|winnie|url_?trap|fax_?number_?trap/i;

/** Input kinds a honeypot is ever built from. Checkboxes and file inputs are legitimately 0×0. */
const HONEYPOT_PRONE_TYPES: ReadonlySet<string> = new Set(['text', 'email', 'tel', 'url', 'search', '']);

/**
 * Honeypot detection: a field planted for bots, whose being filled is itself the signal.
 *
 * Filling one gets the application silently discarded, so this is a correctness requirement, not
 * politeness. Two independent tests:
 *
 *   1. NAMING. `name`/`id`/`class`/`autocomplete` matching the well-known trap vocabulary.
 *      Applied to every control.
 *   2. GEOMETRY. Degenerate or far-off-screen boxes. Applied ONLY to text-family inputs, because
 *      visually-hidden checkboxes (styled via a sibling label) and 0×0 file inputs behind a
 *      dropzone are standard, legitimate patterns that must still be fillable (SEC 6.4).
 */
export function isHoneypot(el: Element): boolean {
  const fingerprint = [
    attrOf(el, 'name'),
    attrOf(el, 'id'),
    attrOf(el, 'class'),
    attrOf(el, 'autocomplete'),
    attrOf(el, 'data-testid'),
  ].join(' ');
  if (HONEYPOT_PATTERN.test(fingerprint)) return true;

  if (tagOf(el) !== 'input') return false;
  const type = attrOf(el, 'type').toLowerCase();
  if (!HONEYPOT_PRONE_TYPES.has(type)) return false;
  // Without layout there is no geometry to judge; the naming test above is the only usable signal.
  if (!hasLayout(el)) return false;

  const rect = boundingRectOf(el);
  if (rect !== null && rect.width > 0 && rect.height > 0) {
    // Rendered somewhere. Only a wildly off-canvas position is suspicious.
    const view = windowOf(el);
    const viewportWidth = view?.innerWidth ?? 0;
    const viewportHeight = view?.innerHeight ?? 0;
    if (rect.right < -2000 || rect.bottom < -2000) return true;
    if (viewportWidth > 0 && rect.left > viewportWidth + 10000) return true;
    if (viewportHeight > 0 && rect.top > viewportHeight + 20000) return true;
    return false;
  }

  const style = computedStyleOf(el);
  if (style !== null) {
    if (style.position === 'absolute' || style.position === 'fixed') {
      const left = Number.parseFloat(style.left);
      const top = Number.parseFloat(style.top);
      if (Number.isFinite(left) && left <= -2000) return true;
      if (Number.isFinite(top) && top <= -2000) return true;
    }
    if (style.clipPath === 'inset(100%)' || style.clip === 'rect(0px, 0px, 0px, 0px)') return true;
  }
  return false;
}

/* ------------------------------------------------------------------------------------------------
 * Requiredness
 * ---------------------------------------------------------------------------------------------- */

/** `required` / `aria-required`, plus the visual asterisk conventions ATS actually ship. */
export function isRequired(el: Element): boolean {
  if (el.hasAttribute('required')) return true;
  if (attrOf(el, 'aria-required') === 'true') return true;
  if (attrOf(el, 'data-required') === 'true') return true;
  if (matches(el, '[class*="required" i]')) return true;

  // Greenhouse and friends render "First Name *" — the asterisk is stripped from `sig.label`
  // during normalization, so look at the label element's raw text instead.
  const id = attrOf(el, 'id');
  if (id.length > 0) {
    const doc = el.ownerDocument;
    if (doc !== null) {
      try {
        const label = doc.querySelector(`label[for="${id.replace(/["\\]/g, '\\$&')}"]`);
        if (label !== null && /[*∗]|\(required\)/i.test(label.textContent ?? '')) return true;
      } catch {
        /* ignore */
      }
    }
  }
  return false;
}

/* ------------------------------------------------------------------------------------------------
 * Radio groups
 * ---------------------------------------------------------------------------------------------- */

/**
 * Every radio sharing this element's `name` within the same form (or the same root when the
 * radios are not inside a form).
 *
 * Exported for the FillEngine: SEC 6.4's radio strategy is "resolve group by name; match option
 * label to the profile value; click the target", and the scanner only hands it the group's first
 * member.
 */
export function radioGroupMembers(el: Element): Element[] {
  const name = attrOf(el, 'name');
  if (name.length === 0) return [el];

  const scope = radioScopeOf(el);
  if (scope === null) return [el];

  try {
    const selector = `input[type="radio"][name="${name.replace(/["\\]/g, '\\$&')}"]`;
    const found = scope.querySelectorAll(selector);
    const out: Element[] = [];
    for (let i = 0; i < found.length; i++) {
      const member = found[i];
      if (member !== undefined) out.push(member);
    }
    return out.length > 0 ? out : [el];
  } catch {
    return [el];
  }
}

/** The `<form>` a radio belongs to, else its shadow root / document. */
function radioScopeOf(el: Element): ParentNode | null {
  if (typeof el.closest === 'function') {
    try {
      const form = el.closest('form');
      if (form !== null) return form;
    } catch {
      /* ignore */
    }
  }
  try {
    const root = typeof el.getRootNode === 'function' ? el.getRootNode() : null;
    if (root !== null && typeof (root as Partial<ParentNode>).querySelectorAll === 'function') {
      return root as ParentNode;
    }
  } catch {
    /* ignore */
  }
  return el.ownerDocument;
}

/* ------------------------------------------------------------------------------------------------
 * FormScanner
 * ---------------------------------------------------------------------------------------------- */

interface WalkState {
  fields: FieldNode[];
  unreachable: UnreachableFrame[];
  stats: ScanStats;
  truncated: boolean;
  /** Elements already collected — guards against a node reachable by two paths. */
  seen: Set<Element>;
  /** Radio group key → index into `fields`, so later members merge instead of duplicating. */
  radioGroups: Map<string, number>;
  /** Documents already walked — guards against frame cycles. */
  visitedRoots: Set<unknown>;
}

/**
 * Walks a document, its same-origin frames and its open shadow roots, and returns every fillable
 * control it finds as a `FieldNode` (SEC 6.2), in document order.
 *
 * A scanner instance is cheap and stateless between runs — `core/observer.ts` re-runs `scan()` on
 * every SPA route change and wizard step, so this must be safe to call repeatedly.
 */
export class FormScanner {
  private readonly options: Required<ScanOptions>;

  constructor(options: ScanOptions = {}) {
    this.options = { ...DEFAULT_SCAN_OPTIONS, ...options };
  }

  /** Scan a root. Defaults to the ambient `document` when one exists. */
  scan(root?: Document | ShadowRoot | Element | null): ScanResult {
    const started = now();
    const target = root ?? defaultDocument();

    const state: WalkState = {
      fields: [],
      unreachable: [],
      truncated: false,
      seen: new Set<Element>(),
      radioGroups: new Map<string, number>(),
      visitedRoots: new Set<unknown>(),
      stats: {
        frames: 0,
        shadowRoots: 0,
        elementsVisited: 0,
        candidates: 0,
        skippedHidden: 0,
        skippedInert: 0,
        skippedHoneypot: 0,
        mergedRadios: 0,
        durationMs: 0,
      },
    };

    if (target !== null) {
      state.stats.frames = 1;
      this.walk(target, state, 0);
    }

    state.stats.durationMs = Math.max(0, now() - started);

    return {
      fields: state.fields,
      unreachableFrames: state.unreachable,
      truncated: state.truncated,
      stats: state.stats,
    };
  }

  /** Convenience: just the fields. */
  scanFields(root?: Document | ShadowRoot | Element | null): FieldNode[] {
    return this.scan(root).fields;
  }

  /* ---- traversal --------------------------------------------------------------------------- */

  private walk(root: ParentNode, state: WalkState, depth: number): void {
    if (depth > this.options.maxDepth) return;
    if (state.visitedRoots.has(root)) return;
    state.visitedRoots.add(root);

    let all: NodeListOf<Element>;
    try {
      all = root.querySelectorAll('*');
    } catch {
      return;
    }

    for (let i = 0; i < all.length; i++) {
      if (state.truncated) return;

      const el = all[i];
      if (el === undefined) continue;
      state.stats.elementsVisited++;

      this.consider(el, state);

      const tag = tagOf(el);
      if (tag === 'iframe' || tag === 'frame') {
        this.walkFrame(el, state, depth);
        continue;
      }

      // Open shadow roots only — a closed root returns null here, which is the platform telling
      // every extension "you may not look inside". We honour that rather than working around it.
      const shadow = (el as Partial<HTMLElement>).shadowRoot;
      if (shadow !== null && shadow !== undefined) {
        state.stats.shadowRoots++;
        this.walk(shadow, state, depth + 1);
      }
    }
  }

  private walkFrame(frame: Element, state: WalkState, depth: number): void {
    const doc = frameDocument(frame);
    if (doc !== null) {
      state.stats.frames++;
      this.walk(doc, state, depth + 1);
      return;
    }
    state.unreachable.push(describeUnreachableFrame(frame));
  }

  /* ---- collection -------------------------------------------------------------------------- */

  private consider(el: Element, state: WalkState): void {
    if (!isFillableControl(el)) return;
    if (state.seen.has(el)) return;
    state.stats.candidates++;
    state.seen.add(el);

    if (isInert(el)) {
      state.stats.skippedInert++;
      return;
    }

    if (!this.options.includeHoneypots && isHoneypot(el)) {
      state.stats.skippedHoneypot++;
      return;
    }

    const visible = isVisible(el);
    if (!visible && !this.options.includeHidden) {
      state.stats.skippedHidden++;
      return;
    }

    const isRadio = tagOf(el) === 'input' && attrOf(el, 'type').toLowerCase() === 'radio';
    if (isRadio) {
      const merged = this.mergeRadio(el, state, visible);
      if (merged) return;
    }

    if (state.fields.length >= this.options.maxFields) {
      state.truncated = true;
      return;
    }

    const sig = buildFieldSignature(el, {
      frameId: this.options.frameId,
      groupLabel: isRadio,
    });

    state.fields.push({
      el,
      sig,
      visible,
      required: isRequired(el),
    });

    if (isRadio) {
      const key = radioGroupKey(el, this.options.frameId);
      if (key !== null) state.radioGroups.set(key, state.fields.length - 1);
    }
  }

  /**
   * Fold a radio into an existing group node. SEC 6.2 models a field as one node, and a radio
   * group is one question — the FillEngine re-resolves the members by name when it writes.
   * Returns `true` when the radio was absorbed and must not become its own node.
   */
  private mergeRadio(el: Element, state: WalkState, visible: boolean): boolean {
    const key = radioGroupKey(el, this.options.frameId);
    if (key === null) return false;

    const index = state.radioGroups.get(key);
    if (index === undefined) return false;

    const existing = state.fields[index];
    if (existing === undefined) return false;

    state.stats.mergedRadios++;
    // One visible member is enough to make the question answerable, and one required member makes
    // the whole group required.
    if (visible && !existing.visible) existing.visible = true;
    if (!existing.required && isRequired(el)) existing.required = true;
    return true;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Frames
 * ---------------------------------------------------------------------------------------------- */

/**
 * The frame's document, or `null` when this context may not touch it.
 *
 * Reading `contentDocument` across origins throws a `SecurityError` in some engines and returns
 * `null` in others; both are handled, and neither is ever reported as an empty frame.
 */
function frameDocument(frame: Element): Document | null {
  try {
    const direct = (frame as Partial<HTMLIFrameElement>).contentDocument;
    if (direct !== null && direct !== undefined) return direct;
  } catch {
    return null;
  }
  try {
    const view = (frame as Partial<HTMLIFrameElement>).contentWindow;
    if (view === null || view === undefined) return null;
    return view.document ?? null;
  } catch {
    return null;
  }
}

function describeUnreachableFrame(frame: Element): UnreachableFrame {
  const src = attrOf(frame, 'src');
  const sandbox = frame.hasAttribute('sandbox') ? attrOf(frame, 'sandbox') : null;

  let origin = '';
  let sameOrigin = false;
  const base = frame.ownerDocument?.location?.href;
  if (src.length > 0) {
    try {
      const url = new URL(src, base ?? undefined);
      origin = url.origin;
      sameOrigin = base !== undefined && origin === new URL(base).origin;
    } catch {
      origin = '';
    }
  } else if (base !== undefined) {
    try {
      origin = new URL(base).origin;
      sameOrigin = true;
    } catch {
      origin = '';
    }
  }

  let reason: UnreachableFrameReason;
  if (sandbox !== null && !/\ballow-same-origin\b/.test(sandbox)) {
    reason = 'sandboxed';
  } else if (sameOrigin) {
    // Same origin but no document yet — `about:blank` that has not finished navigating.
    reason = 'not-loaded';
  } else {
    reason = 'cross-origin';
  }

  return { src, origin, reason, description: describeElement(frame) };
}

/* ------------------------------------------------------------------------------------------------
 * Small utilities
 * ---------------------------------------------------------------------------------------------- */

function radioGroupKey(el: Element, frameId: number): string | null {
  const name = attrOf(el, 'name');
  if (name.length === 0) return null;
  const scope = radioScopeOf(el);
  const scopeTag = scope !== null && tagOf(scope) === 'form' ? formIdOf(scope as Element) : 'root';
  return `${frameId}::${scopeTag}::${name}`;
}

/** Stable per-document identity for a `<form>`, without writing anything to the page. */
const formIds = new WeakMap<Element, string>();
let formIdCounter = 0;

function formIdOf(form: Element): string {
  const existing = formIds.get(form);
  if (existing !== undefined) return existing;
  const attributeId = attrOf(form, 'id') || attrOf(form, 'name');
  const assigned = attributeId.length > 0 ? `form:${attributeId}` : `form#${++formIdCounter}`;
  formIds.set(form, assigned);
  return assigned;
}

function defaultDocument(): Document | null {
  const ambient = (globalThis as { document?: Document }).document;
  return ambient ?? null;
}

function now(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf !== undefined && typeof perf.now === 'function' ? perf.now() : Date.now();
}

/* ------------------------------------------------------------------------------------------------
 * Module-level convenience
 * ---------------------------------------------------------------------------------------------- */

/** One-shot scan with default options — the shape `content/` uses for a plain page. */
export function scanForms(
  root?: Document | ShadowRoot | Element | null,
  options: ScanOptions = {},
): ScanResult {
  return new FormScanner(options).scan(root);
}

/** Re-derive a node's element, narrowing SEC 6.2's deliberately-`unknown` `FieldNode.el`. */
export function nodeElement(node: FieldNode): Element | null {
  return elementOf(node.el);
}
