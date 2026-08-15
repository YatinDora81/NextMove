/**
 * content/overlay/Suggest.ts — the v2.2 ghost-text suggestion layer, whole and self-contained.
 *
 * The "Fill" button (F-03) answers a form in one shot. This module answers the other half of the
 * job: the user is already typing, field by field, and we know what they usually put here. Focus an
 * empty field and the remembered value appears as dim ghost text sitting exactly on the field's own
 * text origin; Tab takes it, Esc refuses it for good, and 🔖 teaches us the answer they typed
 * instead. Nothing is ever written without that explicit key press or click.
 *
 * Why this file owns its own shadow host instead of rendering into `overlay/mount.ts`:
 *
 *   - Lifetime. The overlay host is created once and lives for the page; this layer is switched on
 *     and off by `Settings.enabled` and by `setEnabled()`, and "off" must mean *gone* — no host, no
 *     listeners, nothing left to leak a suggestion into a page we were told to stay out of.
 *   - Blast radius. The ghost tracks a *focused* field on every scroll frame. Keeping it out of the
 *     React-rendered overlay means a mistake here cannot take the review panel down with it.
 *
 * Invariants this file is bound by:
 *
 *   - **INV-1.** Nothing here clicks anything, ever — not a submit control, not even the field it
 *     is anchored to. The only page writes are (a) the accepted value, through the framework-safe
 *     prototype setter, and (b) the field's own `placeholder`, blanked while a ghost covers it and
 *     restored on every teardown path.
 *   - **SEC 4.4.** The UI lives in a *closed* shadow root. A hostile page cannot read the ghost out
 *     of it, which matters: the ghost holds profile data the user has not agreed to hand over yet.
 *   - **SEC 9.2.** Every string that came from the page — label text, option text — is written with
 *     `textContent` or `setAttribute`. The only `innerHTML`-shaped thing here is the static
 *     stylesheet, which contains no interpolation.
 *   - **INV-2 / SEC 5.7.** No I/O of any kind. `lookup` and `remember` are injected, so the answer
 *     bank stays behind the caller's local-only boundary and this file never learns where values
 *     come from or go.
 */

import { createLogger } from '@/platform/logger';

const log = createLogger('suggest');

/* ------------------------------------------------------------------------------------------------
 * Public shapes
 * ---------------------------------------------------------------------------------------------- */

export interface SuggestController {
  destroy(): void;
  setEnabled(on: boolean): void;
}

export interface SuggestDeps {
  /** Resolve a value to offer for this label, or `null` when nothing is known. */
  lookup(labelText: string): Promise<string | null>;
  /** Persist `value` as the answer to `labelText`. */
  remember(labelText: string, value: string): Promise<void>;
  /** Optional surface for the one-line confirmations; the caller owns the real toast stack. */
  onToast?(message: string): void;
  /**
   * "Something else already speaks for this control." Wired to the proactive layer
   * (`FieldControls`), which paints a ghost and a ✓/✗/💾 cluster on every field the matcher
   * recognised, before anything is focused.
   *
   * Without this the two layers would both offer the same field the moment it was focused: two
   * ghosts on the same text origin, and two bars fighting over the same 22px of its right edge.
   * This layer keeps what it is uniquely able to do — an Answer Bank hit on a field the matcher
   * could not place, and 🔖 on radios and checkboxes, neither of which the proactive layer offers.
   */
  owns?(el: Element): boolean;
}

/** The four things a session can be attached to; they differ only in what the bar offers. */
export type SuggestKind = 'text' | 'select' | 'radio' | 'checkbox';

/** Host element id. Deliberately not the overlay host — see the file header. */
export const SUGGEST_HOST_ID = 'nextmove-suggest-root';

/** A fuzzy match this weak is a coincidence, not an answer (v2.2's floor). */
export const OPTION_MATCH_FLOOR = 50;

type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type TextFieldElement = HTMLInputElement | HTMLTextAreaElement;

/* ------------------------------------------------------------------------------------------------
 * Pure text + DOM reading helpers (exported so they can be tested without a session)
 * ---------------------------------------------------------------------------------------------- */

/** Page text arrives with newlines, tabs and NBSPs baked in; every comparison starts here. */
export function collapseText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * v2.2's fuzzy ladder, unchanged: 100 exact · 80 prefix · 60 substring · 50 half the words shared.
 *
 * The rungs are far apart on purpose. Callers compare scores against a single floor
 * (`OPTION_MATCH_FLOOR`) rather than ranking near-ties, so what matters is that "Yes" never
 * outranks "Yes, I am authorised" by a rounding error — not that the numbers are calibrated.
 */
export function matchScore(text: string, value: string): number {
  const left = collapseText(text).toLowerCase();
  const right = collapseText(value).toLowerCase();
  if (left.length === 0 || right.length === 0) return 0;
  if (left === right) return 100;
  if (left.startsWith(right) || right.startsWith(left)) return 80;
  if (left.includes(right) || right.includes(left)) return 60;

  const leftWords = new Set(left.split(/[^a-z0-9]+/).filter((word) => word.length > 0));
  const rightWords = right.split(/[^a-z0-9]+/).filter((word) => word.length > 0);
  if (leftWords.size === 0 || rightWords.length === 0) return 0;

  const shared = rightWords.filter((word) => leftWords.has(word)).length;
  return shared / Math.max(rightWords.length, leftWords.size) >= 0.5 ? 50 : 0;
}

/** "Select…", "-- Choose --" and friends are prompts, not answers. */
const PLACEHOLDER_OPTION_RE = /^\s*(select|choose|please|pick|--|—)/i;
const PROMPT_OPTION_RE = /select|choose|please|--|—/i;

/**
 * True when the dropdown is genuinely answered.
 *
 * The empty-value test alone is not enough: plenty of ATS ship a first option with a real value
 * whose text is "Please select". Treating that as an answer would make us skip the field on Fill
 * and hide the accept button here, which is exactly backwards.
 */
export function selectHasRealValue(select: HTMLSelectElement): boolean {
  // A multi-select has no collapsed display, so nothing is selected until something selects it and
  // the placeholder convention does not apply — "Select all that apply" is an instruction, not a
  // stand-in. It also cannot be read through `selectedIndex`, which names only the FIRST selection:
  // a valueless hint row sitting above three real choices would read as unanswered.
  if (select.multiple) {
    for (const option of select.selectedOptions) {
      if (option.value !== '') return true;
    }
    return false;
  }

  const option = select.options.item(select.selectedIndex);
  if (option === null || option.value === '') return false;
  return !PLACEHOLDER_OPTION_RE.test(option.textContent ?? '');
}


/** The option that best answers `value`, or `null` when nothing clears `OPTION_MATCH_FLOOR`. */
export function bestOptionMatch(select: HTMLSelectElement, value: string): HTMLOptionElement | null {
  let best: HTMLOptionElement | null = null;
  let bestScore = 0;

  for (const option of Array.from(select.options)) {
    if (option.disabled) continue;
    if (option.value.length === 0 && PROMPT_OPTION_RE.test(option.textContent ?? '')) continue;
    // Value and text are both worth scoring: "IN" and "India" are the same answer in different columns.
    const score = Math.max(matchScore(option.textContent ?? '', value), matchScore(option.value, value));
    if (score > bestScore) {
      bestScore = score;
      best = option;
    }
  }

  return bestScore >= OPTION_MATCH_FLOOR ? best : null;
}

/** Every scrap of text that describes a field, best first. */
export function describeField(el: FieldElement): string[] {
  const bits: Array<string | null | undefined> = [
    el.labels?.item(0)?.textContent,
    el.closest('label')?.textContent,
    el.getAttribute('aria-label'),
    el instanceof HTMLSelectElement ? null : el.placeholder,
    el.name,
    el.id,
    el.getAttribute('autocomplete'),
  ];
  return bits.map(collapseText).filter((bit) => bit.length > 0);
}

/** A pathological page can hand us a whole paragraph as a "label"; the bank wants a question. */
const LABEL_MAX_LENGTH = 300;

/** The string handed to `lookup`/`remember`. Normalisation belongs to the caller, not to us. */
export function fieldLabel(el: FieldElement): string {
  return (describeField(el)[0] ?? '').slice(0, LABEL_MAX_LENGTH);
}

/** The human-visible text of one radio/checkbox option. */
export function optionLabel(el: HTMLInputElement): string {
  const text =
    el.labels?.item(0)?.textContent ??
    el.closest('label')?.textContent ??
    el.getAttribute('aria-label') ??
    el.value;
  return collapseText(text);
}

/** Every radio sharing this one's name, scoped to its form when it has one. */
export function radioGroup(radio: HTMLInputElement): HTMLInputElement[] {
  const name = radio.name;
  if (name.length === 0) return [radio];

  const root: ParentNode = radio.form ?? document;
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(name) : null;
  if (escaped === null) return [radio];

  try {
    return Array.from(root.querySelectorAll(`input[type="radio"][name="${escaped}"]`)).filter(
      (el): el is HTMLInputElement => el instanceof HTMLInputElement,
    );
  } catch (error) {
    // A name containing something `CSS.escape` could not tame is not worth failing focus over.
    log.debug('could not resolve radio group', error);
    return [radio];
  }
}

/** Ancestors to climb before giving up on finding the text that introduces a radio group. */
const QUESTION_SEARCH_DEPTH = 6;
const QUESTION_MIN_LENGTH = 6;
const QUESTION_MAX_LENGTH = 180;

/**
 * The question a radio group answers: `<legend>` → the radiogroup's ARIA name → the first piece of
 * non-option text inside the smallest ancestor holding the whole group → the `name` attribute.
 *
 * Radios are the one control whose own label ("Yes") is useless as a key — the same three options
 * appear under twenty different questions in a single application, so the group's *question* is
 * the only thing worth remembering an answer against.
 */
export function groupQuestion(radio: HTMLInputElement): string {
  const legend = collapseText(radio.closest('fieldset')?.querySelector('legend')?.textContent);
  if (legend.length > 0) return legend;

  const group = radio.closest('[role="radiogroup"]');
  if (group !== null) {
    const aria = collapseText(group.getAttribute('aria-label'));
    if (aria.length > 0) return aria;
    const labelledBy = group.getAttribute('aria-labelledby');
    if (labelledBy !== null) {
      const labelText = collapseText(document.getElementById(labelledBy)?.textContent);
      if (labelText.length > 0) return labelText;
    }
  }

  const siblings = radioGroup(radio);
  const last = siblings[siblings.length - 1];
  const first = siblings[0];
  if (siblings.length > 1 && first !== undefined && last !== undefined) {
    let ancestor: HTMLElement | null = radio.parentElement;
    let depth = 0;
    while (ancestor !== null && depth < QUESTION_SEARCH_DEPTH && !(ancestor.contains(first) && ancestor.contains(last))) {
      ancestor = ancestor.parentElement;
      depth += 1;
    }
    if (ancestor !== null && ancestor !== document.body) {
      const optionTexts = new Set(siblings.map((el) => optionLabel(el).toLowerCase()));
      for (const el of Array.from(ancestor.querySelectorAll('legend,label,p,span,div,h1,h2,h3,h4'))) {
        // A node wrapping an input is the option itself, not the question above it.
        if (el.querySelector('input') !== null) continue;
        const text = collapseText(el.textContent);
        if (text.length < QUESTION_MIN_LENGTH || text.length > QUESTION_MAX_LENGTH) continue;
        if (optionTexts.has(text.toLowerCase())) continue;
        return text;
      }
    }
  }

  return radio.name;
}

/* ------------------------------------------------------------------------------------------------
 * Eligibility
 * ---------------------------------------------------------------------------------------------- */

/** Below this a "field" is a search box in a header or a hidden measuring input, not an answer. */
const MIN_FIELD_WIDTH = 60;
const MIN_FIELD_HEIGHT = 18;

const GHOSTABLE_INPUT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'email',
  'tel',
  'url',
  'search',
  'number',
  '',
]);

function isEligibleText(el: EventTarget | null): el is TextFieldElement {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false;
  if (el.disabled || el.readOnly) return false;
  // `password` is absent from the set on purpose: we never ghost a credential.
  if (el instanceof HTMLInputElement && !GHOSTABLE_INPUT_TYPES.has(el.type.toLowerCase())) return false;
  const rect = el.getBoundingClientRect();
  return rect.width >= MIN_FIELD_WIDTH && rect.height >= MIN_FIELD_HEIGHT;
}

function isEligibleSelect(el: EventTarget | null): el is HTMLSelectElement {
  if (!(el instanceof HTMLSelectElement) || el.disabled) return false;
  if (el.options.length <= 1) return false;
  const rect = el.getBoundingClientRect();
  return rect.width >= MIN_FIELD_WIDTH && rect.height > 0;
}

/* ------------------------------------------------------------------------------------------------
 * The framework-safe write (SEC 6.4)
 * ---------------------------------------------------------------------------------------------- */

function fireValueEvents(el: Element): void {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * `el.value = x` is swallowed by React's instance-level value trap — the state behind the field
 * never learns about it, and the next render puts the old value back. Writing through the
 * *prototype* descriptor leaves the tracker's cached value stale, so the `input` event that follows
 * reads as a genuine user edit.
 */
function setNativeValue(el: TextFieldElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  fireValueEvents(el);
}

function setNativeSelectValue(select: HTMLSelectElement, option: HTMLOptionElement): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (setter) setter.call(select, option.value);
  else select.value = option.value;
  fireValueEvents(select);
}

/* ------------------------------------------------------------------------------------------------
 * UI
 * ---------------------------------------------------------------------------------------------- */

/**
 * One below the overlay host's 2147483647: a review panel or a toast must always be able to cover
 * a ghost, never the other way round.
 */
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
  ['z-index', '2147483646'],
  ['display', 'block'],
  ['visibility', 'visible'],
  ['opacity', '1'],
  ['transform', 'none'],
  ['filter', 'none'],
  ['contain', 'none'],
];

/**
 * The ghost colour is a fixed mid-grey rather than a themed token: it is painted over the *page's*
 * field, whose background follows the page's theme and not the OS's. A mid-grey at 75% reads as
 * "not typed yet" on a white field and on a #111 one; a themed token gets it wrong half the time.
 */
const SUGGEST_STYLES = `
:host { all: initial; color-scheme: light dark; }
* { box-sizing: border-box; }

.nm-bar {
  position: fixed;
  display: none;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid rgb(23 23 27 / 14%);
  background: #ffffff;
  box-shadow: 0 6px 18px rgb(9 9 11 / 18%);
  pointer-events: auto;
  font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.nm-bar--show { display: inline-flex; }
.nm-bar--remember-only .nm-btn--accept,
.nm-bar--remember-only .nm-btn--dismiss { display: none; }

.nm-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  line-height: 1;
}
.nm-btn:hover { background: rgb(23 23 27 / 8%); }
.nm-btn:focus-visible { outline: 2px solid #4353e8; outline-offset: 1px; }
.nm-btn--accept { color: #177a4c; }
.nm-btn--dismiss { color: #b32e3c; }
.nm-btn--remember { color: #4353e8; }

.nm-ghost {
  position: fixed;
  display: none;
  align-items: center;
  pointer-events: none;
  overflow: hidden;
  white-space: nowrap;
  color: #8a8a93;
  opacity: 0.75;
}
.nm-ghost--show { display: flex; }

@media (prefers-color-scheme: dark) {
  .nm-bar {
    background: #141417;
    border-color: rgb(244 244 246 / 14%);
    box-shadow: 0 6px 18px rgb(0 0 0 / 45%);
  }
  .nm-btn:hover { background: rgb(244 244 246 / 10%); }
  .nm-btn--accept { color: #5cc98c; }
  .nm-btn--dismiss { color: #ee8b95; }
  .nm-btn--remember { color: #8492ff; }
}
`;

interface SuggestUi {
  host: HTMLElement;
  bar: HTMLElement;
  ghost: HTMLElement;
  accept: HTMLButtonElement;
  dismiss: HTMLButtonElement;
  remember: HTMLButtonElement;
}

interface Session {
  readonly field: FieldElement;
  /** What the bar is pinned to — the field itself, or a custom-styled radio's visible label. */
  readonly anchor: HTMLElement;
  readonly kind: SuggestKind;
  readonly label: string;
  suggestion: string | null;
  matchedOption: HTMLOptionElement | null;
  ghostVisible: boolean;
  savedPlaceholder: string | null;
}

/** Room reserved on the right of a text field so the ghost never runs under the bar. */
const GHOST_RIGHT_GUTTER = 96;
/** Gap between a select and a bar parked outside it. */
const BAR_OUTSIDE_GAP = 8;
/** Used before the bar has been laid out (offsetWidth is 0 until it is shown). */
const BAR_FALLBACK_WIDTH = 84;
/** How far the bar overlaps *into* a text field's right edge. */
const BAR_INSET = 6;
/** A textarea's bar rides near the top rather than at the vertical centre of a tall box. */
const TEXTAREA_BAR_OFFSET = 16;
/** Clicking a bar button moves focus for an instant; do not tear the session down over that. */
const BLUR_GRACE_MS = 150;

/** `parseFloat('')` is NaN, and one NaN in the maths puts the ghost at `NaNpx`. */
function num(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/* ------------------------------------------------------------------------------------------------
 * The controller
 * ---------------------------------------------------------------------------------------------- */

class SuggestOverlay implements SuggestController {
  private readonly deps: SuggestDeps;

  /**
   * Refused fields, for the life of the page. A `WeakSet` and not a `Set`: single-page ATS churn
   * thousands of nodes through a long application, and a strong Set would pin every one of them.
   */
  private readonly refused = new WeakSet<Element>();

  private ui: SuggestUi | null = null;
  private session: Session | null = null;
  private enabled = true;
  private destroyed = false;
  private listening = false;
  private blurTimer: number | null = null;

  constructor(deps: SuggestDeps) {
    this.deps = deps;
    this.attach();
  }

  setEnabled(on: boolean): void {
    if (this.destroyed || this.enabled === on) return;
    this.enabled = on;
    if (on) {
      this.attach();
      return;
    }
    // "Off" means gone, not hidden: no host in the page, no listeners on the document.
    this.detach();
    this.teardown();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.enabled = false;
    this.detach();
    this.teardown();
  }

  /* ---------------------------------------------------------------------------------------------
   * Wiring
   * ------------------------------------------------------------------------------------------- */

  private attach(): void {
    if (this.listening || this.destroyed) return;
    this.listening = true;
    // Capture phase throughout: a page that stops propagation on its own inputs (Workday does)
    // must not be able to switch this layer off by accident.
    document.addEventListener('focusin', this.onFocusIn, true);
    document.addEventListener('focusout', this.onFocusOut, true);
    document.addEventListener('input', this.onInput, true);
    document.addEventListener('change', this.onChange, true);
    document.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('scroll', this.onReposition, true);
    window.addEventListener('resize', this.onReposition);
  }

  private detach(): void {
    if (!this.listening) return;
    this.listening = false;
    document.removeEventListener('focusin', this.onFocusIn, true);
    document.removeEventListener('focusout', this.onFocusOut, true);
    document.removeEventListener('input', this.onInput, true);
    document.removeEventListener('change', this.onChange, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('scroll', this.onReposition, true);
    window.removeEventListener('resize', this.onReposition);
  }

  private teardown(): void {
    this.endSession();
    if (this.blurTimer !== null) {
      window.clearTimeout(this.blurTimer);
      this.blurTimer = null;
    }
    this.ui?.host.remove();
    this.ui = null;
  }

  private ensureUi(): SuggestUi {
    const existing = this.ui;
    if (existing !== null && existing.host.isConnected) return existing;

    const host = document.createElement('div');
    host.id = SUGGEST_HOST_ID;
    host.setAttribute('aria-hidden', 'false');
    for (const [property, value] of HOST_INLINE_STYLE) {
      try {
        host.style.setProperty(property, value, 'important');
      } catch (error) {
        // A property this engine does not know is not worth failing the mount over.
        log.debug(`could not pin host style ${property}`, error);
      }
    }

    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = SUGGEST_STYLES;

    const ghost = document.createElement('div');
    ghost.className = 'nm-ghost';

    const bar = document.createElement('div');
    bar.className = 'nm-bar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'NextMove suggestion');
    // Without this the mousedown blurs the field, the session dies, and the click lands on nothing.
    bar.addEventListener('pointerdown', (event) => event.preventDefault());

    const accept = this.makeButton('accept', '✓', 'Use this suggestion (Tab)');
    accept.addEventListener('click', () => this.accept());
    const dismiss = this.makeButton('dismiss', '✕', 'Dismiss (Esc)');
    dismiss.addEventListener('click', () => this.dismiss());
    const remember = this.makeButton('remember', '🔖', 'Remember this answer for next time');
    remember.addEventListener('click', () => this.remember());

    bar.append(accept, dismiss, remember);
    shadow.append(style, ghost, bar);
    (document.body ?? document.documentElement).appendChild(host);

    const ui: SuggestUi = { host, bar, ghost, accept, dismiss, remember };
    this.ui = ui;
    return ui;
  }

  private makeButton(kind: 'accept' | 'dismiss' | 'remember', glyph: string, label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `nm-btn nm-btn--${kind}`;
    button.textContent = glyph;
    button.title = label;
    button.setAttribute('aria-label', label);
    return button;
  }

  /* ---------------------------------------------------------------------------------------------
   * Sessions
   * ------------------------------------------------------------------------------------------- */

  private readonly onFocusIn = (event: Event): void => {
    if (!this.enabled) return;
    const target = event.target;
    if (target instanceof Element && this.deps.owns?.(target) === true) return;
    if (isEligibleSelect(target)) this.beginSelect(target);
    else if (isEligibleText(target)) this.beginText(target);
  };

  private readonly onFocusOut = (event: Event): void => {
    const session = this.session;
    if (session === null || event.target !== session.field) return;
    if (this.blurTimer !== null) window.clearTimeout(this.blurTimer);
    this.blurTimer = window.setTimeout(() => {
      this.blurTimer = null;
      const current = this.session;
      if (current !== null && document.activeElement !== current.field) this.endSession();
    }, BLUR_GRACE_MS);
  };

  private beginText(field: TextFieldElement): void {
    const session = this.openSession(field, field, 'text');
    // Nothing to offer against a field the user already answered or already refused — and no
    // reason to ask the bank for a value that could not be shown anyway.
    if (field.value.trim().length > 0 || this.refused.has(field)) return;
    void this.offer(session);
  }

  private beginSelect(field: HTMLSelectElement): void {
    const session = this.openSession(field, field, 'select');
    if (selectHasRealValue(field) || this.refused.has(field)) return;
    void this.offer(session);
  }

  /** A radio picked or a checkbox ticked: no suggestion to make, only an answer worth learning. */
  private beginChoice(field: HTMLInputElement, kind: 'radio' | 'checkbox'): void {
    const label = kind === 'radio' ? groupQuestion(field) : optionLabel(field) || fieldLabel(field);
    if (label.length === 0) return;
    const anchor = field.labels?.item(0) ?? field.closest('label') ?? field;
    this.openSession(field, anchor, kind, label.slice(0, LABEL_MAX_LENGTH));
  }

  private openSession(field: FieldElement, anchor: HTMLElement, kind: SuggestKind, label?: string): Session {
    this.endSession();
    const ui = this.ensureUi();

    const session: Session = {
      field,
      anchor,
      kind,
      label: label ?? fieldLabel(field),
      suggestion: null,
      matchedOption: null,
      ghostVisible: false,
      savedPlaceholder: null,
    };
    this.session = session;

    ui.remember.title = this.rememberHint(kind);
    ui.remember.setAttribute('aria-label', ui.remember.title);
    ui.bar.classList.add('nm-bar--show');
    this.syncBar();
    this.position();
    return session;
  }

  /**
   * The one answer to "is an accept actually on offer right now?".
   *
   * Both the ✓/✕ buttons and the Tab/Esc keys are gated on this and on nothing else. They used to
   * be gated on different things — the bar on a CSS class, the key handler on `matchedOption` — and
   * they disagreed in the one case that matters: the user ignores the offered option, picks their
   * own from the dropdown, and Tabs onward. The button was gone from the bar, but Tab still reached
   * `accept()` and replaced the answer they had just given on a live job application.
   *
   * It reads the field rather than a remembered flag so it cannot drift out of date: whatever the
   * page did to the value since the offer was made, the answer here is about the field as it is now.
   */
  private acceptOnOffer(session: Session): boolean {
    const field = session.field;
    if (field instanceof HTMLSelectElement) {
      // `matchedOption` deliberately outlives the user answering (see `hideGhost`), so being
      // unanswered is the live half of the test, not a formality.
      return session.matchedOption !== null && !selectHasRealValue(field);
    }
    return session.ghostVisible && session.suggestion !== null && field.value.length === 0;
  }

  /** Point the bar at `acceptOnOffer`. Every path that changes the offer ends here. */
  private syncBar(): void {
    const session = this.session;
    const ui = this.ui;
    if (session === null || ui === null) return;
    ui.bar.classList.toggle('nm-bar--remember-only', !this.acceptOnOffer(session));
  }

  private rememberHint(kind: SuggestKind): string {
    if (kind === 'radio') return 'Remember this answer to this question';
    if (kind === 'checkbox') return 'Remember this choice';
    if (kind === 'select') return 'Remember the chosen option for this field';
    return 'Remember this value for this field';
  }

  /** Ask the bank, then re-check the world: an await is long enough for focus to have moved on. */
  private async offer(session: Session): Promise<void> {
    // An unlabelled field has no question to look an answer up by; asking anyway would only give
    // the bank a chance to answer the wrong one.
    if (session.label.length === 0) return;

    let value: string | null = null;
    try {
      value = await this.deps.lookup(session.label);
    } catch (error) {
      log.debug('suggestion lookup failed', error);
      return;
    }

    const suggestion = collapseText(value);
    if (suggestion.length === 0) return;
    if (this.session !== session || !session.field.isConnected) return;
    if (this.refused.has(session.field)) return;

    session.suggestion = suggestion;
    if (session.field instanceof HTMLSelectElement) this.offerOption(session, session.field, suggestion);
    else this.showGhost(session, session.field, suggestion);
  }

  private offerOption(session: Session, field: HTMLSelectElement, suggestion: string): void {
    if (selectHasRealValue(field)) return;
    const option = bestOptionMatch(field, suggestion);
    if (option === null) return;

    const ui = this.ensureUi();
    session.matchedOption = option;
    const hint = `Use "${collapseText(option.textContent) || option.value}"`;
    ui.accept.title = hint;
    ui.accept.setAttribute('aria-label', hint);
    this.syncBar();
    this.position();
  }

  private showGhost(session: Session, field: TextFieldElement, suggestion: string): void {
    if (field.value.length > 0) return;
    const ui = this.ensureUi();

    ui.ghost.textContent = suggestion;
    // The page's own placeholder would print straight through the ghost; it is put back by
    // `hideGhost`/`endSession`, which every teardown path runs through.
    if (session.savedPlaceholder === null && field.placeholder.length > 0) {
      session.savedPlaceholder = field.placeholder;
      field.placeholder = '';
    }
    session.ghostVisible = true;
    ui.ghost.classList.add('nm-ghost--show');
    ui.accept.title = 'Use this suggestion (Tab)';
    ui.accept.setAttribute('aria-label', 'Use this suggestion');
    this.syncBar();
    this.position();
  }

  /**
   * Drop the offer, keep the bar: 🔖 is still the point of the session once the user types.
   *
   * `matchedOption` is deliberately left alone — a user who flips a dropdown back to "Select…"
   * should get the accept button back, and `acceptOnOffer` gives it back from exactly this field.
   * That is only safe because the keyboard is gated on `acceptOnOffer` too, not on `matchedOption`.
   */
  private hideGhost(): void {
    const session = this.session;
    if (session === null) return;
    this.restorePlaceholder(session);
    session.ghostVisible = false;
    this.ui?.ghost.classList.remove('nm-ghost--show');
    this.syncBar();
  }

  private restorePlaceholder(session: Session): void {
    const saved = session.savedPlaceholder;
    if (saved === null) return;
    session.savedPlaceholder = null;
    const field = session.field;
    if (field instanceof HTMLSelectElement || !field.isConnected) return;
    field.placeholder = saved;
  }

  private endSession(): void {
    const session = this.session;
    if (session === null) return;
    this.restorePlaceholder(session);
    this.session = null;
    this.ui?.ghost.classList.remove('nm-ghost--show');
    this.ui?.bar.classList.remove('nm-bar--show');
  }

  /* ---------------------------------------------------------------------------------------------
   * Geometry
   * ------------------------------------------------------------------------------------------- */

  private readonly onReposition = (): void => {
    this.position();
  };

  private position(): void {
    const session = this.session;
    const ui = this.ui;
    if (session === null || ui === null) return;
    if (!session.field.isConnected) {
      this.endSession();
      return;
    }

    const rect = session.anchor.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      this.endSession();
      return;
    }

    if (session.ghostVisible && !(session.field instanceof HTMLSelectElement)) {
      this.positionGhost(ui, session.field, rect);
    }

    const isTextarea = session.field instanceof HTMLTextAreaElement;
    ui.bar.style.top = `${session.kind === 'text' && isTextarea ? rect.top + TEXTAREA_BAR_OFFSET : rect.top + rect.height / 2}px`;

    if (session.kind === 'text') {
      ui.bar.style.left = `${rect.right - BAR_INSET}px`;
      ui.bar.style.transform = 'translate(-100%, -50%)';
      return;
    }

    // A select's dropdown arrow lives inside its right edge, and a radio's label is its whole
    // hitbox — so the bar parks *outside* those, and only falls back to overlapping when parking
    // outside would push it off screen.
    const barWidth = ui.bar.offsetWidth > 0 ? ui.bar.offsetWidth : BAR_FALLBACK_WIDTH;
    if (rect.right + BAR_OUTSIDE_GAP + barWidth <= window.innerWidth - 4) {
      ui.bar.style.left = `${rect.right + BAR_OUTSIDE_GAP}px`;
      ui.bar.style.transform = 'translate(0, -50%)';
    } else {
      ui.bar.style.left = `${rect.right - BAR_INSET}px`;
      ui.bar.style.transform = 'translate(-100%, -50%)';
    }
  }

  /**
   * The ghost has to land on the field's own text origin or it reads as a second, misaligned
   * value. That origin is the field's border + padding, and the type is whatever the page computed
   * — so all of it is copied off the live element rather than guessed.
   */
  private positionGhost(ui: SuggestUi, field: TextFieldElement, rect: DOMRect): void {
    const style = getComputedStyle(field);
    const insetLeft = num(style.paddingLeft) + num(style.borderLeftWidth);
    const insetTop = num(style.paddingTop) + num(style.borderTopWidth);

    ui.ghost.style.left = `${rect.left + insetLeft}px`;
    ui.ghost.style.maxWidth = `${Math.max(0, rect.width - insetLeft - GHOST_RIGHT_GUTTER)}px`;
    ui.ghost.style.fontFamily = style.fontFamily;
    ui.ghost.style.fontSize = style.fontSize;
    ui.ghost.style.fontWeight = style.fontWeight;

    if (field instanceof HTMLTextAreaElement) {
      // A textarea's first line starts at the padding box, not at the vertical centre.
      ui.ghost.style.alignItems = 'flex-start';
      ui.ghost.style.top = `${rect.top + insetTop}px`;
      ui.ghost.style.height = 'auto';
      ui.ghost.style.lineHeight = style.lineHeight;
    } else {
      ui.ghost.style.alignItems = 'center';
      ui.ghost.style.top = `${rect.top}px`;
      ui.ghost.style.height = `${rect.height}px`;
    }
  }

  /* ---------------------------------------------------------------------------------------------
   * Input, keys and actions
   * ------------------------------------------------------------------------------------------- */

  private readonly onInput = (event: Event): void => {
    const session = this.session;
    if (session === null || event.target !== session.field) return;
    // A radio/checkbox session has no offer to revise — and its `value` ("on") is not an answer.
    if (session.kind !== 'text' && session.kind !== 'select') return;
    const field = session.field;

    if (field instanceof HTMLSelectElement) {
      if (selectHasRealValue(field)) this.hideGhost();
    } else if (field.value.length > 0) {
      this.hideGhost();
    } else if (session.suggestion !== null && !this.refused.has(field)) {
      // Cleared back to empty: the offer stands, and it is already in hand — no second lookup.
      this.showGhost(session, field, session.suggestion);
    }

    // A dropdown put back to "Select…" earns its ✓ back here, off the same predicate that hid it.
    this.syncBar();
    this.position();
  };

  private readonly onChange = (event: Event): void => {
    this.onInput(event);
    if (!this.enabled) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const type = target.type.toLowerCase();
    if (type !== 'radio' && type !== 'checkbox') return;
    if (this.deps.owns?.(target) === true) return;
    this.beginChoice(target, type);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const session = this.session;
    if (session === null || event.target !== session.field) return;
    // Tab and Esc belong to the page unless the ✓/✕ the user can see are on offer — the same
    // predicate, so the keys can never do something the bar is no longer showing.
    if (!this.acceptOnOffer(session)) return;

    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      this.accept();
    } else if (event.key === 'Escape') {
      this.dismiss();
    }
  };

  private accept(): void {
    const session = this.session;
    // The click path is guarded by the same predicate as the key path, not by the CSS that hides
    // the button: a stray click on a hidden control must not be able to write either.
    if (session === null || !this.acceptOnOffer(session)) return;
    const field = session.field;

    if (field instanceof HTMLSelectElement) {
      const option = session.matchedOption;
      if (option === null) return;
      setNativeSelectValue(field, option);
    } else {
      const suggestion = session.suggestion;
      if (suggestion === null) return;
      setNativeValue(field, suggestion);
    }

    session.matchedOption = null;
    this.hideGhost();
    this.position();
  }

  /** Refusal sticks for the life of the page — re-offering something already rejected is nagging. */
  private dismiss(): void {
    const session = this.session;
    if (session === null) return;
    // Same gate as ✓ and Tab: with nothing on offer there is nothing to refuse, and recording a
    // refusal anyway would silence a field the user never turned down.
    if (!this.acceptOnOffer(session)) return;
    this.refused.add(session.field);

    session.suggestion = null;
    session.matchedOption = null;
    this.hideGhost();
  }

  private remember(): void {
    const session = this.session;
    if (session === null) return;

    const value = this.valueToRemember(session);
    if (value.length === 0) {
      this.toast('Nothing to remember here yet');
      return;
    }
    if (session.label.length === 0) {
      this.toast("NextMove can't identify this field");
      return;
    }

    void this.deps
      .remember(session.label, value)
      .then(() => {
        this.toast('Remembered — NextMove will use this next time');
      })
      .catch((error: unknown) => {
        log.debug('could not remember answer', error);
        this.toast("NextMove couldn't save that answer");
      });
  }

  private valueToRemember(session: Session): string {
    const field = session.field;

    if (field instanceof HTMLSelectElement) {
      const option = field.options.item(field.selectedIndex);
      const chosen = selectHasRealValue(field) ? collapseText(option?.textContent) : '';
      return chosen.length > 0 ? chosen : (session.suggestion ?? '');
    }

    if (session.kind === 'radio' && field instanceof HTMLInputElement) {
      // The stored answer is the option's own text: it has to fuzzy-match a differently worded
      // option list on the next employer's form.
      const checked = radioGroup(field).find((radio) => radio.checked) ?? (field.checked ? field : null);
      return checked === null ? '' : optionLabel(checked);
    }

    if (session.kind === 'checkbox' && field instanceof HTMLInputElement) {
      return field.checked ? 'yes' : 'no';
    }

    return field.value.trim() || (session.suggestion ?? '');
  }

  private toast(message: string): void {
    this.deps.onToast?.(message);
  }
}

/**
 * Install the suggestion layer. It starts listening immediately; call `setEnabled(false)` to take
 * it down when the global power switch is off, and `destroy()` when the page goes away.
 */
export function installSuggest(deps: SuggestDeps): SuggestController {
  return new SuggestOverlay(deps);
}
