/**
 * core/signature.ts — turn a DOM control into a stable, hashable `FieldSignature`.
 *
 * Implements JF-001 Rev 3.0:
 *   SEC 6.2  `FieldSignature` verbatim — label · name · id · placeholder · ariaLabel ·
 *            autocomplete · inputType · sectionHeading · frameId · hash
 *   SEC 6.3  the signals the FieldMatcher scores, and `sectionHeading` as the disambiguator
 *            behind the −20 "conflicting section" modifier
 *   SEC 7.3  `hash` is the key of `jf.mappings[domain]`, so it is a compatibility surface
 *
 * TWO PROPERTIES MATTER MORE THAN ANYTHING ELSE HERE:
 *
 *   STABILITY. `hash` is what a saved user mapping (F-13) is filed under. If the digest for the
 *   same field changes between page loads, every correction the user has ever made silently stops
 *   applying. That is why `frameId` is deliberately EXCLUDED from the fingerprint (Chrome assigns
 *   frame ids per navigation) and why auto-generated ids are stripped of their volatile digits
 *   before hashing — React's `:r3:`, MUI's `mui-1421`, Workday's `input-15` all churn on re-render.
 *
 *   REALM SAFETY. The scanner reaches into same-origin iframes, so elements handed to this module
 *   frequently belong to a *different* JavaScript realm than the one this code runs in. `x
 *   instanceof HTMLInputElement` is false across realms, so every narrowing below is done by
 *   `nodeType` / `tagName` / duck-typing instead. There is not one `instanceof` on a DOM class in
 *   this file, and that is on purpose.
 */

import type { FieldSignature, InputKind } from '@/shared/types';

import { sha1 } from './hash';
import { collapse, normalizeText } from './similarity';

/* ------------------------------------------------------------------------------------------------
 * Realm-safe DOM helpers
 * ---------------------------------------------------------------------------------------------- */

const NODE_ELEMENT = 1;
const NODE_TEXT = 3;
const NODE_DOCUMENT = 9;
const NODE_FRAGMENT = 11;

/** Narrow an untrusted value (e.g. `FieldNode.el`, typed `unknown` in SEC 6.2) to an Element. */
export function elementOf(value: unknown): Element | null {
  if (value === null || typeof value !== 'object') return null;
  const node = value as Partial<Node> & Partial<Element>;
  if (node.nodeType !== NODE_ELEMENT) return null;
  if (typeof node.getAttribute !== 'function') return null;
  return value as Element;
}

/** Lowercase tag name, realm-safe. `''` when the value is not an element. */
export function tagOf(node: unknown): string {
  const el = elementOf(node);
  if (el === null) return '';
  const tag = el.tagName;
  return typeof tag === 'string' ? tag.toLowerCase() : '';
}

/** Trimmed attribute value, `''` when absent. Never throws on exotic hosts. */
export function attrOf(el: Element, name: string): string {
  try {
    const value = el.getAttribute(name);
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

/** `true` when `node` is a Document or ShadowRoot that supports id/selector lookups. */
function isSearchRoot(node: unknown): node is Document | ShadowRoot {
  if (node === null || typeof node !== 'object') return false;
  const candidate = node as Partial<Node>;
  return candidate.nodeType === NODE_DOCUMENT || candidate.nodeType === NODE_FRAGMENT;
}

/**
 * The root an id reference resolves against: the element's shadow root when it lives in one
 * (ids are scoped to the shadow tree), otherwise its document.
 */
export function searchRootOf(el: Element): Document | ShadowRoot | null {
  try {
    const root = typeof el.getRootNode === 'function' ? el.getRootNode() : null;
    if (isSearchRoot(root)) return root;
  } catch {
    /* getRootNode is unavailable on some legacy hosts — fall through to ownerDocument */
  }
  return el.ownerDocument ?? null;
}

/** `getElementById` on either a Document or a ShadowRoot, without cross-realm `instanceof`. */
function byId(root: Document | ShadowRoot, id: string): Element | null {
  if (id.length === 0) return null;
  const lookup = (root as Partial<Document>).getElementById;
  if (typeof lookup === 'function') {
    try {
      return lookup.call(root, id) ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

/** `querySelector` that swallows invalid-selector errors instead of blowing up a whole scan. */
function query(root: ParentNode, selector: string): Element | null {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

/** CSS.escape with a conservative fallback, so `label[for="weird:id"]` still resolves. */
function cssEscape(value: string): string {
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

/* ------------------------------------------------------------------------------------------------
 * Text extraction
 * ---------------------------------------------------------------------------------------------- */

/** Longest label / heading we will carry. Screening questions are long; page copy is longer. */
const MAX_TEXT_LENGTH = 300;

/** Descendants that are never part of a label's text. */
const NON_LABEL_TAGS = new Set([
  'input',
  'select',
  'textarea',
  'button',
  'script',
  'style',
  'noscript',
  'svg',
  'template',
  'option',
  'iframe',
]);

/** Trailing/leading rendering noise: required markers, colons, optionality hints. */
function trimLabelNoise(text: string): string {
  return collapse(
    text
      .replace(/[*∗٭]+/g, ' ')
      .replace(/\((?:required|optional|opcional|obligatoire)\)/gi, ' ')
      .replace(/\s*[:：]\s*$/, ' '),
  );
}

/**
 * Visible text of an element with nested controls removed, collapsed and de-noised.
 *
 * The element is cloned before pruning, so the host page's DOM is never mutated — JobFill reads
 * pages, it does not rewrite them.
 */
export function elementText(el: Element | null | undefined): string {
  if (!el) return '';

  const raw = el.textContent;
  if (typeof raw !== 'string' || raw.length === 0) return '';

  // Fast path: nothing to prune, so skip the clone entirely.
  if (raw.length <= MAX_TEXT_LENGTH * 2 && query(el, 'input,select,textarea,button,svg') === null) {
    return trimLabelNoise(raw).slice(0, MAX_TEXT_LENGTH);
  }

  let text = raw;
  try {
    const clone = el.cloneNode(true) as Element;
    for (const tag of NON_LABEL_TAGS) {
      const nested = clone.querySelectorAll(tag);
      for (let i = 0; i < nested.length; i++) {
        nested[i]?.remove();
      }
    }
    const hidden = clone.querySelectorAll('[aria-hidden="true"]');
    for (let i = 0; i < hidden.length; i++) {
      hidden[i]?.remove();
    }
    text = clone.textContent ?? '';
  } catch {
    /* cloneNode can fail on exotic custom elements — the raw textContent is a fine fallback */
  }

  return trimLabelNoise(text).slice(0, MAX_TEXT_LENGTH);
}

/** Text of a bare node: text nodes contribute their data, elements their pruned text. */
function nodeText(node: Node): string {
  if (node.nodeType === NODE_TEXT) {
    return trimLabelNoise(node.nodeValue ?? '').slice(0, MAX_TEXT_LENGTH);
  }
  if (node.nodeType !== NODE_ELEMENT) return '';
  const el = node as Element;
  const tag = tagOf(el);
  if (NON_LABEL_TAGS.has(tag)) return '';
  // A wrapper that contains a control is structure, not a label.
  if (query(el, 'input,select,textarea') !== null) return '';
  return elementText(el);
}

/** Join the text of every element an `aria-labelledby` / `aria-describedby` list points at. */
function textFromIdRefs(el: Element, attribute: string): string {
  const refs = attrOf(el, attribute);
  if (refs.length === 0) return '';
  const root = searchRootOf(el);
  if (root === null) return '';

  const parts: string[] = [];
  for (const id of refs.split(/\s+/)) {
    if (id.length === 0) continue;
    const target = byId(root, id);
    if (target === null) continue;
    const text = elementText(target);
    if (text.length > 0) parts.push(text);
  }
  return collapse(parts.join(' ')).slice(0, MAX_TEXT_LENGTH);
}

/* ------------------------------------------------------------------------------------------------
 * SEC 6.2 — label resolution
 * ---------------------------------------------------------------------------------------------- */

/** Which strategy produced a label. Surfaced in the overlay's "why did this match" popover. */
export type LabelSource =
  | 'label-for'
  | 'label-wrapping'
  | 'aria-labelledby'
  | 'aria-label'
  | 'preceding-text'
  | 'table-cell'
  | 'definition-list'
  | 'title-attr'
  | 'group-legend'
  | 'none';

export interface ResolvedLabel {
  text: string;
  source: LabelSource;
}

/** How far up the tree we look for a label before giving up. */
const LABEL_ANCESTOR_DEPTH = 4;
/** How many previous siblings we inspect at each level. */
const LABEL_SIBLING_HOPS = 6;

/**
 * Resolve a field's label in the exact priority order of SEC 6.2:
 *
 *   1. `<label for=id>`            — explicit and authoritative
 *   2. wrapping `<label>`          — the other half of the HTML contract
 *   3. `aria-labelledby`           — the accessible name proper
 *   4. `aria-label`                — the accessible name as a literal
 *   5. preceding sibling text      — the "div soup" case; most custom ATS widgets land here
 *   6. closest table-cell / `<dt>` — Taleo and other table-laid-out legacy forms
 *
 * Falls back to `title`, then to the empty string. It never invents text: an unlabelled field must
 * score low and be flagged, not be guessed at (INV-4).
 */
export function resolveLabel(el: Element): ResolvedLabel {
  // 1 — <label for="id">
  const id = attrOf(el, 'id');
  if (id.length > 0) {
    const root = searchRootOf(el);
    if (root !== null) {
      const explicit = query(root, `label[for="${cssEscape(id)}"]`);
      const text = elementText(explicit);
      if (text.length > 0) return { text, source: 'label-for' };
    }
  }

  // 2 — wrapping <label>
  const wrapping = closest(el, 'label');
  if (wrapping !== null) {
    const text = elementText(wrapping);
    if (text.length > 0) return { text, source: 'label-wrapping' };
  }

  // 3 — aria-labelledby
  const labelledBy = textFromIdRefs(el, 'aria-labelledby');
  if (labelledBy.length > 0) return { text: labelledBy, source: 'aria-labelledby' };

  // 4 — aria-label
  const ariaLabel = trimLabelNoise(attrOf(el, 'aria-label'));
  if (ariaLabel.length > 0) return { text: ariaLabel.slice(0, MAX_TEXT_LENGTH), source: 'aria-label' };

  // 5 — preceding sibling text
  const preceding = precedingText(el);
  if (preceding.length > 0) return { text: preceding, source: 'preceding-text' };

  // 6a — table cell (legacy iCIMS / Taleo layouts)
  const fromCell = tableCellLabel(el);
  if (fromCell !== null) return fromCell;

  // 6b — definition list
  const dd = closest(el, 'dd');
  if (dd !== null) {
    const dt = previousElementMatching(dd, 'dt');
    const text = elementText(dt);
    if (text.length > 0) return { text, source: 'definition-list' };
  }

  const title = trimLabelNoise(attrOf(el, 'title'));
  if (title.length > 0) return { text: title.slice(0, MAX_TEXT_LENGTH), source: 'title-attr' };

  return { text: '', source: 'none' };
}

/** `Element.closest` with a realm-safe guard and no throw on odd selectors. */
function closest(el: Element, selector: string): Element | null {
  if (typeof el.closest !== 'function') return null;
  try {
    return el.closest(selector);
  } catch {
    return null;
  }
}

/** Walk previous element siblings until one matches `selector`. */
function previousElementMatching(el: Element, selector: string): Element | null {
  let current: Element | null = el.previousElementSibling;
  let hops = 0;
  while (current !== null && hops < LABEL_SIBLING_HOPS) {
    if (matches(current, selector)) return current;
    current = current.previousElementSibling;
    hops++;
  }
  return null;
}

/** `Element.matches` that never throws on a malformed selector (remote config is untrusted). */
export function matches(el: Element, selector: string): boolean {
  if (typeof el.matches !== 'function') return false;
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

/**
 * The nearest text that visually precedes the control. Walks previous siblings at the element's
 * own level, then at each ancestor level, stopping as soon as it finds a node that reads like a
 * caption rather than structure.
 */
function precedingText(el: Element): string {
  let anchor: Node | null = el;

  for (let depth = 0; anchor !== null && depth < LABEL_ANCESTOR_DEPTH; depth++) {
    let sibling: Node | null = anchor.previousSibling;
    let hops = 0;
    while (sibling !== null && hops < LABEL_SIBLING_HOPS) {
      const text = nodeText(sibling);
      if (text.length > 0) return text;
      sibling = sibling.previousSibling;
      hops++;
    }
    const parent: Node | null = anchor.parentNode;
    anchor = parent !== null && parent.nodeType === NODE_ELEMENT ? parent : null;
  }
  return '';
}

/** Label from a `<td>`'s row header or the cell to its left. */
function tableCellLabel(el: Element): ResolvedLabel | null {
  const cell = closest(el, 'td,th');
  if (cell === null) return null;

  const left = cell.previousElementSibling;
  if (left !== null) {
    const text = elementText(left);
    if (text.length > 0) return { text, source: 'table-cell' };
  }

  const row = closest(cell, 'tr');
  if (row !== null) {
    const header = query(row, 'th');
    if (header !== null && header !== cell) {
      const text = elementText(header);
      if (text.length > 0) return { text, source: 'table-cell' };
    }
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * SEC 6.2 — section heading
 * ---------------------------------------------------------------------------------------------- */

const HEADING_SELECTOR = 'h1,h2,h3,h4,legend,[role="heading"]';
/** How many ancestors we climb looking for the section a field sits in. */
const HEADING_ANCESTOR_DEPTH = 15;
/** How many previous siblings we inspect at each ancestor level. */
const HEADING_SIBLING_HOPS = 8;

/**
 * Nearest h1–h4 or `<fieldset><legend>` above the field — the signal SEC 6.3's −20 "conflicting
 * section heading" modifier runs on. A "Name" under *References* must not take the applicant's
 * name, and this is the value that lets the matcher know.
 *
 * Also honours `aria-labelledby` on a `role="group"` / `role="radiogroup"` ancestor, which is how
 * Workday and Ashby label their question groups.
 */
export function resolveSectionHeading(el: Element): string {
  let node: Element | null = el;

  for (let depth = 0; node !== null && depth < HEADING_ANCESTOR_DEPTH; depth++) {
    const tag = tagOf(node);

    if (tag === 'fieldset') {
      const legend = query(node, 'legend');
      const text = elementText(legend);
      if (text.length > 0) return text;
    }

    const role = attrOf(node, 'role');
    if (role === 'group' || role === 'radiogroup' || role === 'region') {
      const labelled = textFromIdRefs(node, 'aria-labelledby');
      if (labelled.length > 0) return labelled;
      const aria = trimLabelNoise(attrOf(node, 'aria-label'));
      if (aria.length > 0) return aria.slice(0, MAX_TEXT_LENGTH);
    }

    let sibling: Element | null = node.previousElementSibling;
    let hops = 0;
    while (sibling !== null && hops < HEADING_SIBLING_HOPS) {
      const heading = headingTextOf(sibling);
      if (heading.length > 0) return heading;
      sibling = sibling.previousElementSibling;
      hops++;
    }

    node = node.parentElement;
  }
  return '';
}

/** `el` itself if it is a heading, else the LAST heading inside it (the one nearest our field). */
function headingTextOf(el: Element): string {
  if (matches(el, HEADING_SELECTOR)) return elementText(el);

  let nested: NodeListOf<Element>;
  try {
    nested = el.querySelectorAll(HEADING_SELECTOR);
  } catch {
    return '';
  }
  for (let i = nested.length - 1; i >= 0; i--) {
    const text = elementText(nested[i] ?? null);
    if (text.length > 0) return text;
  }
  return '';
}

/* ------------------------------------------------------------------------------------------------
 * SEC 6.2 — input type inference
 * ---------------------------------------------------------------------------------------------- */

/** `<input type>` values that map straight onto an `InputKind`. */
const NATIVE_INPUT_TYPES: Readonly<Record<string, InputKind>> = {
  email: 'email',
  tel: 'tel',
  url: 'url',
  date: 'date',
  month: 'date',
  week: 'date',
  'datetime-local': 'date',
  time: 'date',
  file: 'file',
  checkbox: 'checkbox',
  radio: 'radio',
  text: 'text',
  search: 'text',
  number: 'text',
  password: 'text',
};

/** Input types that can legitimately be driven as a typeahead (SEC 6.4 combobox strategy). */
const TYPEABLE_KINDS: ReadonlySet<InputKind> = new Set<InputKind>(['text', 'email', 'tel', 'url']);

/**
 * True when the element participates in an ARIA combobox / typeahead pattern.
 *
 * Deliberately does NOT treat a native `list=` / `<datalist>` input as a combobox: a datalist
 * input is filled by writing its value like any other text field, whereas an ARIA combobox needs
 * the per-character type → await-listbox → click-option dance from SEC 6.4.
 */
export function isComboboxPattern(el: Element): boolean {
  if (attrOf(el, 'role') === 'combobox') return true;

  const autocompleteAria = attrOf(el, 'aria-autocomplete').toLowerCase();
  if (autocompleteAria === 'list' || autocompleteAria === 'both' || autocompleteAria === 'inline') {
    return true;
  }

  const haspopup = attrOf(el, 'aria-haspopup').toLowerCase();
  if (haspopup === 'listbox') return true;

  // aria-controls / aria-owns pointing at a listbox is the ARIA 1.1 combobox shape.
  const root = searchRootOf(el);
  if (root !== null) {
    for (const attribute of ['aria-controls', 'aria-owns'] as const) {
      const refs = attrOf(el, attribute);
      if (refs.length === 0) continue;
      for (const id of refs.split(/\s+/)) {
        if (id.length === 0) continue;
        const target = byId(root, id);
        if (target === null) continue;
        if (attrOf(target, 'role') === 'listbox') return true;
      }
    }
  }

  // An input wrapped in a role=combobox container — the ARIA 1.2 pattern.
  const container = closest(el, '[role="combobox"]');
  if (container !== null && container !== el) return true;

  return false;
}

/**
 * Classify a control into one of the 11 `FieldSignature.inputType` kinds (SEC 6.2).
 *
 * Native elements are read from their tag/type; custom widgets (Workday's button-driven selects,
 * Ashby's div comboboxes) are read from their ARIA role. `combobox` is checked only for controls
 * that could plausibly be typed into, so a checkbox inside a combobox container stays a checkbox.
 */
export function inferInputType(el: Element): InputKind {
  const tag = tagOf(el);

  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') {
    return isComboboxPattern(el) ? 'combobox' : 'select';
  }

  if (tag === 'input') {
    const rawType = attrOf(el, 'type').toLowerCase();
    const kind = NATIVE_INPUT_TYPES[rawType] ?? 'text';
    if (TYPEABLE_KINDS.has(kind) && isComboboxPattern(el)) return 'combobox';
    return kind;
  }

  // Custom / ARIA-only widgets.
  const role = attrOf(el, 'role');
  switch (role) {
    case 'combobox':
      return 'combobox';
    case 'listbox':
    case 'menu':
      return 'select';
    case 'radio':
    case 'radiogroup':
      return 'radio';
    case 'checkbox':
    case 'switch':
      return 'checkbox';
    case 'searchbox':
      return isComboboxPattern(el) ? 'combobox' : 'text';
    case 'textbox': {
      const multiline = attrOf(el, 'aria-multiline').toLowerCase();
      if (multiline === 'true') return 'textarea';
      return isComboboxPattern(el) ? 'combobox' : 'text';
    }
    default:
      break;
  }

  const editable = attrOf(el, 'contenteditable').toLowerCase();
  if (editable === '' && el.hasAttribute('contenteditable')) return 'textarea';
  if (editable === 'true' || editable === 'plaintext-only') return 'textarea';

  if (isComboboxPattern(el)) return 'combobox';
  return 'text';
}

/* ------------------------------------------------------------------------------------------------
 * Normalization & hashing
 * ---------------------------------------------------------------------------------------------- */

/**
 * Patterns that mark an id/name as machine-generated and therefore unstable across renders.
 * Each one is a real generator seen in the wild on ATS pages.
 */
const AUTO_ID_PATTERNS: readonly RegExp[] = [
  /^:r[0-9a-z]+:$/i, // React 18 useId
  /\d{3,}/, // long counters, timestamps, tenant ids
  /[0-9a-f]{8,}/i, // uuid fragments / hashed ids
  /^(?:mui|radix|headlessui|downshift|ember|reach|chakra|mantine|ant|rc)[-_]/i,
  /^(?:ext-gen|yui|gwt|ctl|ContentPlaceHolder)/i,
  /--[0-9a-z]{5,}$/i, // CSS-module-style suffixes
  /_\d+_\d+/, // Workday-ish "input_3_1"
];

/**
 * `true` when an id/name looks generated rather than authored.
 *
 * Note what is NOT matched: `address2`, `line1`, `phone2`. A single trailing digit carries meaning
 * on a form — stripping it would let "Address line 2" collide with "Address line 1", which is
 * precisely the bug SEC 6.3's −30 duplicate-path modifier exists to catch. Only runs of three or
 * more digits, hex blobs and known generator prefixes count as noise.
 */
export function looksAutoGenerated(identifier: string): boolean {
  if (identifier.length === 0) return false;
  return AUTO_ID_PATTERNS.some((pattern) => pattern.test(identifier));
}

/**
 * Normalize an id/name for hashing: lowercased, compound-split, punctuation collapsed, and — when
 * the identifier looks generated — stripped of its volatile digits so the alphabetic skeleton is
 * all that survives (`input-1421` → `input`, `:r7:` → `r`).
 */
export function normalizeIdentifier(identifier: string): string {
  if (identifier.length === 0) return '';
  const cleaned = looksAutoGenerated(identifier) ? identifier.replace(/\d+/g, ' ') : identifier;
  return normalizeText(cleaned);
}

/**
 * Bumped only when the fingerprint FORMAT changes. It is baked into the hashed string so that a
 * future format change produces obviously-different digests instead of silent collisions, and so
 * a migration can recognise which generation a stored mapping key belongs to.
 */
export const SIGNATURE_FINGERPRINT_VERSION = 'jf1';

/** Everything that is hashed. `hash` is excluded (it is the output) and so is `frameId`. */
export type HashableSignature = Omit<FieldSignature, 'hash'>;

/**
 * The exact string fed to SHA-1. Exported because "why did my mapping stop applying?" is only
 * debuggable if you can see both fingerprints side by side.
 *
 * `frameId` is intentionally absent: Chrome assigns frame ids per navigation, so including it
 * would invalidate every saved mapping on every page load (SEC 7.3 — `jf.mappings` is keyed by
 * `(domain, sigHash)` and must survive reloads).
 */
export function signatureFingerprint(sig: HashableSignature): string {
  return [
    SIGNATURE_FINGERPRINT_VERSION,
    normalizeText(sig.label),
    normalizeIdentifier(sig.name),
    normalizeIdentifier(sig.id),
    normalizeText(sig.placeholder),
    normalizeText(sig.ariaLabel),
    sig.autocomplete.toLowerCase().trim(),
    sig.inputType,
    normalizeText(sig.sectionHeading),
  ].join('|');
}

/** `sha1(normalized signature)` — SEC 6.2. The key of `jf.mappings[domain]`. */
export function signatureHash(sig: HashableSignature): string {
  return sha1(signatureFingerprint(sig));
}

/* ------------------------------------------------------------------------------------------------
 * Signature construction
 * ---------------------------------------------------------------------------------------------- */

export interface BuildSignatureOptions {
  /** Chrome frame id of the frame the element lives in. Recorded, never hashed. */
  frameId?: number;
  /**
   * Treat the element as the representative of a radio group. Label resolution then prefers the
   * group's question (fieldset legend / radiogroup label) over the individual option's caption,
   * so a "Yes/No" radio pair is signed as the QUESTION rather than as the word "Yes".
   */
  groupLabel?: boolean;
  /** Force the label (an adapter may know better than the DOM does). */
  labelOverride?: string;
  /** Force the name — used when a radio group's shared `name` is the stable identity. */
  nameOverride?: string;
}

/**
 * Build the full SEC 6.2 `FieldSignature` for a control.
 *
 * Accepts a bare frame id as the second argument for call-site convenience:
 * `buildFieldSignature(el, 0)` and `buildFieldSignature(el, { frameId: 0 })` are equivalent.
 */
export function buildFieldSignature(
  el: Element,
  frameIdOrOptions: number | BuildSignatureOptions = 0,
): FieldSignature {
  const options: BuildSignatureOptions =
    typeof frameIdOrOptions === 'number' ? { frameId: frameIdOrOptions } : frameIdOrOptions;
  const frameId = options.frameId ?? 0;

  const inputType = inferInputType(el);

  const label =
    options.labelOverride !== undefined
      ? trimLabelNoise(options.labelOverride).slice(0, MAX_TEXT_LENGTH)
      : options.groupLabel === true
        ? resolveGroupLabel(el)
        : resolveLabel(el).text;

  const name = options.nameOverride ?? attrOf(el, 'name');

  // Radio groups are identified by their shared `name`; the per-option id churns and would make
  // the group's hash unstable, so it is dropped when the group's name is available.
  const id = options.groupLabel === true && name.length > 0 ? '' : attrOf(el, 'id');

  const sig: HashableSignature = {
    label,
    name,
    id,
    placeholder: attrOf(el, 'placeholder').slice(0, MAX_TEXT_LENGTH),
    ariaLabel: trimLabelNoise(attrOf(el, 'aria-label')).slice(0, MAX_TEXT_LENGTH),
    autocomplete: attrOf(el, 'autocomplete').toLowerCase(),
    inputType,
    sectionHeading: resolveSectionHeading(el),
    frameId,
  };

  return { ...sig, hash: signatureHash(sig) };
}

/**
 * Label for a radio/checkbox group: the question, not the option.
 * fieldset legend → role=radiogroup accessible name → the group container's own label →
 * the normal per-element chain as a last resort.
 */
function resolveGroupLabel(el: Element): string {
  const fieldset = closest(el, 'fieldset');
  if (fieldset !== null) {
    const legend = query(fieldset, 'legend');
    const text = elementText(legend);
    if (text.length > 0) return text;
  }

  const group = closest(el, '[role="radiogroup"],[role="group"]');
  if (group !== null) {
    const labelled = textFromIdRefs(group, 'aria-labelledby');
    if (labelled.length > 0) return labelled;
    const aria = trimLabelNoise(attrOf(group, 'aria-label'));
    if (aria.length > 0) return aria.slice(0, MAX_TEXT_LENGTH);
  }

  const heading = resolveSectionHeading(el);
  if (heading.length > 0) return heading;

  return resolveLabel(el).text;
}

/**
 * A short, human-readable identifier for a control — used in overlay debug chips and log lines.
 * Never persisted: only `hash` is stable enough for storage.
 */
export function describeElement(el: Element): string {
  const tag = tagOf(el) || 'node';
  const id = attrOf(el, 'id');
  const name = attrOf(el, 'name');
  const automation = attrOf(el, 'data-automation-id');

  let description = tag;
  if (id.length > 0) description += `#${id}`;
  if (name.length > 0) description += `[name="${name}"]`;
  if (automation.length > 0) description += `[data-automation-id="${automation}"]`;
  return description;
}
