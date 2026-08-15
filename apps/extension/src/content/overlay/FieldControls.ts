/**
 * content/overlay/FieldControls.ts — the proactive per-field layer: a ghost preview of the value
 * NextMove would write, and the ✓ / ✗ / 💾 cluster that decides what happens to it.
 *
 * JF-001 Rev 3.0 · F-06 (review before submit, extended to *before the fill*) · SEC 4.4 (closed
 * Shadow DOM) · INV-1 · INV-4.
 *
 * What changed, and why this file exists. Until now a suggestion was something the user found out
 * about *after* asking for a fill, or by focusing one field at a time (`Suggest.ts`). Both mean the
 * user has to commit before they can see what NextMove knows. This layer inverts that: the moment a
 * page is scanned, every recognised control says what it would receive, and the user accepts it,
 * refuses it, or teaches us a better answer — one field at a time, at a glance, having written
 * nothing yet.
 *
 * The constraints this file is built around:
 *
 *   - **INV-4, in its strongest form.** Proactive means *propose*, never write. Nothing in this
 *     module writes a value; `onAccept` hands the field's id back to the orchestrator, which runs
 *     the real fill engine so the write goes through the same strategies, the same submit guard and
 *     the same verification as ⚡ Fill.
 *
 *   - **The page is not modified at all.** Not one attribute. The focused-field ghost in
 *     `Suggest.ts` blanks the control's `placeholder` while it covers it, which is fine for one
 *     transient field and is *not* fine here: `placeholder` is part of `signatureFingerprint`
 *     (`core/signature.ts`), so blanking it on forty controls at once silently changes forty field
 *     hashes — and those hashes are the identity that `jf.mappings`, the ✗ ledger and the wizard's
 *     step detection are all keyed by. A ghost that renames the field it is describing is worse
 *     than no ghost, so this one paints its own opaque backdrop over the placeholder instead (see
 *     `resolveBackdrop`) and leaves the DOM exactly as it found it.
 *
 *   - **INV-1.** Nothing here focuses, clicks or dispatches an event at a page element. The cluster
 *     swallows its own `pointerdown` so pressing a button cannot even blur the field the user is
 *     typing in.
 *
 *   - **Page text is untrusted (SEC 9.2).** Labels and values reach the DOM through `textContent`
 *     and `setAttribute` only. There is no `innerHTML` in this file.
 *
 *   - **A hundred fields is a normal Workday step.** So: one shared listener set for the whole
 *     layer rather than per-field handlers, geometry read on demand and coalesced into a single
 *     rAF pass (the `FieldMarkers` strategy), computed font metrics cached per entry and refreshed
 *     only when the control's box actually changes, and a pass that finds nothing moved writes no
 *     styles at all.
 *
 * Ownership boundary with `Suggest.ts`: that layer still owns the *focused* field it is the only one
 * that can help with — a banked answer that has to be fuzzy-matched against a dropdown's option list,
 * and 🔖 on radios and checkboxes. Its `owns()` dependency is wired to `hasOffer()` here, not to
 * `has()`: this layer keeps an entry for every eligible control so 💾 is ready the moment the user
 * types, and claiming all of those would have retired half of `Suggest.ts` while offering nothing in
 * its place. Two layers, one ghost per control.
 */

import { createLogger } from '@/platform/logger';

import type { OverlayHandle } from './mount';
import { optionLabel, radioGroup, selectHasRealValue } from './Suggest';

const log = createLogger('field-controls');

/* ------------------------------------------------------------------------------------------------
 * Public shapes
 * ---------------------------------------------------------------------------------------------- */

/**
 * How one control's offer currently stands.
 *
 *   offer      a value is proposed and untouched — ✓ ✗ 💾
 *   accepted   the user took it (or answered the field themselves) — 💾 only
 *   dismissed  the user refused it — 💾 only, and the orchestrator has persisted the refusal
 */
export type FieldControlState = 'offer' | 'accepted' | 'dismissed';

export interface FieldControlSpec {
  /** The field signature hash — the same stable identity the dismissal ledger is keyed by. */
  id: string;
  el: HTMLElement;
  /** The field's own label, for the tooltips and the accessible names. Page-derived, text-only. */
  label: string;
  /**
   * The value NextMove proposes, already formatted the way the fill engine would write it. Empty
   * means there is nothing to offer and the cluster carries 💾 alone.
   */
  suggestion: string;
  /** Paint the ghost preview inside the control. False for anything that is not text-shaped. */
  ghost: boolean;
  /** Something else is already anchored to this control's right edge (the ✨ button). */
  crowded?: boolean;
}

export interface FieldControlHandlers {
  /** ✓ — the orchestrator runs the fill engine for this field and reports back with `settle`. */
  onAccept(id: string): void;
  /** ✗ — refuse this suggestion, durably. */
  onDismiss(id: string): void;
  /** 💾 — remember whatever the control holds right now. */
  onSave(id: string): void;
  /** The number of live offers changed; the bubble's count badge reads this. */
  onPendingChange?(count: number): void;
}

/* ------------------------------------------------------------------------------------------------
 * Eligibility — what may carry a ghost, and what may carry nothing at all
 * ---------------------------------------------------------------------------------------------- */

/** Below this a "field" is a header search box or a hidden measuring input, not an answer. */
const MIN_FIELD_WIDTH = 60;
const MIN_FIELD_HEIGHT = 18;

/**
 * `<input type>` values a ghost can sit on top of. `password` is absent for the obvious reason;
 * `date`, `month` and `time` are absent for a subtler one — the browser paints its own
 * `mm/dd/yyyy` skeleton inside those, and a ghost lands on top of it rather than instead of it.
 */
const GHOSTABLE_INPUT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'email',
  'tel',
  'url',
  'search',
  'number',
  '',
]);

/**
 * Controls NextMove will not so much as *mention*, however well the matcher scored them.
 *
 * The scanner already refuses `type="password"` outright (`NON_FILLABLE_INPUT_TYPES`), so this is
 * the second belt: a payment card or a one-time code can arrive as `type="text"` with nothing but
 * an `autocomplete` token or a name to give it away, and a ghost over one of those is a suggestion
 * that a credential is ours to complete. There is no ✓, no ✗ and no 💾 on these — remembering a CVV
 * would be worse than proposing one.
 */
export function isBlockedControl(el: Element): boolean {
  const type = el instanceof HTMLInputElement ? el.type.toLowerCase() : '';
  if (type === 'password' || type === 'hidden') return true;

  const autocomplete = (el.getAttribute('autocomplete') ?? '').toLowerCase();
  if (autocomplete.includes('one-time-code')) return true;
  if (autocomplete.includes('current-password') || autocomplete.includes('new-password')) return true;
  // `cc-number`, `cc-csc`, `cc-exp`, `shipping cc-name`, … — the whole `cc-*` family.
  if (/(^|\s)cc-/.test(autocomplete)) return true;

  // `card_cvv`, `cc-csc`, `oneTimeCode`: separators are part of the naming vocabulary, and `_` is a
  // word character — so `\bcvv\b` would never match inside `card_cvv`. Flatten them to spaces first
  // and the word boundaries mean what they look like they mean.
  const naming = `${el.getAttribute('name') ?? ''} ${el.id} ${el.getAttribute('data-automation-id') ?? ''}`
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return /\b(otp|one time|cvv|cvc|csc|card ?number|cardnum|credit ?card|security ?code|passcode)\b/i.test(
    naming,
  );
}

/** Is this control text-shaped, big enough, and free enough for a ghost to sit inside it? */
export function canGhostControl(el: Element): boolean {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false;
  if (el.disabled || el.readOnly) return false;
  if (el instanceof HTMLInputElement && !GHOSTABLE_INPUT_TYPES.has(el.type.toLowerCase())) return false;
  const rect = el.getBoundingClientRect();
  return rect.width >= MIN_FIELD_WIDTH && rect.height >= MIN_FIELD_HEIGHT;
}

/**
 * What a control currently holds, as text. One definition, shared by the 💾 button's enabled state,
 * by the input listener that retires a ghost, and by the orchestrator's save path — three places
 * that must never disagree about whether a field is empty.
 */
export function readControlValue(el: HTMLElement): string {
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    return el.value;
  }
  if (el.isContentEditable) return el.textContent ?? '';
  return '';
}

/**
 * What a control holds *as an answer*, which is not always what it holds as a value.
 *
 * A radio's or a checkbox's `value` is the option's own text and reads non-blank whether or not the
 * box is ticked — so `readControlValue` alone would light 💾 up on every untouched Yes/No question
 * on the page and then save "Yes" for a question the user never answered. For a choice group the
 * answer is *which member is checked*, and its text is what a differently worded option list on the
 * next employer's form will have to fuzzy-match against.
 */
export function readAnswerValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) {
    if (el.type === 'checkbox') return el.checked ? 'yes' : '';
    const checked = radioGroup(el).find((radio) => radio.checked);
    return checked === undefined ? '' : optionLabel(checked);
  }
  if (el instanceof HTMLSelectElement) {
    // Plenty of ATS ship a first option carrying a real `value` whose text is "Please select".
    // Reading `.value` calls that an answer, which suppresses the suggestion on the field and lights
    // 💾 up to remember a prompt. `selectHasRealValue` is the engine's own definition of answered.
    if (!selectHasRealValue(el)) return '';
    // `selectedIndex` names only the FIRST selection, which is the wrong read for "Select all that
    // apply": 💾 would store one language out of three, and a valueless hint row selected above them
    // would store the prompt. The selection set is the answer.
    const chosen: string[] = [];
    for (const option of el.selectedOptions) {
      if (option.value.length === 0) continue;
      chosen.push(optionText(option));
    }
    return chosen.join(', ');
  }
  return readControlValue(el);
}

/** Is this a control whose answer is "which member is checked" rather than "what does it say"? */
export function isChoiceControl(el: Element): boolean {
  return el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox');
}

/* ------------------------------------------------------------------------------------------------
 * Geometry constants (shared with Suggest.ts's focused-field bar, deliberately)
 * ---------------------------------------------------------------------------------------------- */

/** Room kept on the right of a control so the ghost never runs under the cluster. */
const GHOST_RIGHT_GUTTER = 84;
/** How far the cluster overlaps *into* the control's right edge. */
const CLUSTER_INSET = 5;
/** A textarea's cluster rides near the top rather than at the centre of a tall box. */
const TEXTAREA_CLUSTER_OFFSET = 16;
/** Extra clearance when the ✨ button already owns this control's top-right corner. */
const SPARKLE_GUTTER = 32;
/** Slow safety sweep for layout shifts nothing else reports (font loads, async images). */
const SAFETY_INTERVAL_MS = 600;
/** A label longer than this is a paragraph the page called a label; tooltips get the front of it. */
const MAX_TOOLTIP_CHARS = 200;

/** `parseFloat('')` is NaN, and one NaN in the maths puts the ghost at `NaNpx`. */
function num(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampText(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/* ------------------------------------------------------------------------------------------------
 * Internals
 * ---------------------------------------------------------------------------------------------- */

interface Painted {
  top: number;
  left: number;
  width: number;
  height: number;
  hidden: boolean;
}

interface Metrics {
  insetLeft: number;
  insetTop: number;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  /**
   * An opaque colour to paint behind the ghost text, or null when there is nothing to hide. Set
   * only for a control that carries a `placeholder`, because that is the one thing that would
   * otherwise print straight through the suggestion.
   */
  backdrop: string | null;
}

interface Entry {
  spec: FieldControlSpec;
  state: FieldControlState;
  cluster: HTMLElement;
  accept: HTMLButtonElement;
  dismiss: HTMLButtonElement;
  save: HTMLButtonElement;
  ghost: HTMLElement | null;
  /** True while a ghost is wanted for this control — the live half of "is there an offer?". */
  ghosting: boolean;
  /** Last geometry pass said this control is somewhere a human could see it. */
  onScreen: boolean;
  metrics: Metrics | null;
  last: Painted | null;
}

/**
 * A colour that will completely hide whatever is painted under it, walking outward from the control
 * until something opaque turns up, or null if nothing does.
 *
 * A control whose own background is transparent inherits whatever is behind it, and guessing wrong
 * would leave a visible patch across the field — so "no idea" is an answer, and the caller responds
 * by not drawing a ghost at all and leaving the value in the cluster's tooltip.
 */
function resolveBackdrop(el: Element): string | null {
  let node: Element | null = el;
  for (let depth = 0; node !== null && depth < 6; depth += 1) {
    let colour = '';
    try {
      colour = getComputedStyle(node).backgroundColor;
    } catch {
      return null;
    }
    if (isOpaqueColour(colour)) return colour;
    node = node.parentElement;
  }
  return null;
}

/**
 * Is this computed colour guaranteed to hide whatever is painted behind it?
 *
 * Chrome serialises most computed backgrounds as `rgb()`/`rgba()`, but a wide-gamut page yields
 * `color(srgb 1 1 1)`, and the modern space-separated `rgb(0 0 0 / 50%)` is legal too. Anything with
 * an alpha that is not exactly 1 — and any syntax this does not recognise — is "unknown", and the
 * caller answers that by not drawing a ghost rather than by painting a wrong-coloured patch.
 */
function isOpaqueColour(colour: string): boolean {
  const value = colour.trim().toLowerCase();
  if (value.length === 0 || value === 'transparent') return false;
  if (!/^(?:rgba?|color|hsla?|lab|lch|oklab|oklch)\(/.test(value)) return false;

  // Both syntaxes put the alpha last: `rgba(r, g, b, a)` and `rgb(r g b / a)`.
  const body = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')'));
  const slash = body.lastIndexOf('/');
  if (slash !== -1) return alphaIsOne(body.slice(slash + 1));

  const parts = body.split(',');
  if (parts.length < 4) return true; // no alpha channel given at all
  return alphaIsOne(parts[parts.length - 1] ?? '');
}

/** `1`, `100%`, and nothing else. */
function alphaIsOne(raw: string): boolean {
  const text = raw.trim();
  if (text.endsWith('%')) return num(text.slice(0, -1)) === 100;
  return num(text) === 1;
}

/* ------------------------------------------------------------------------------------------------
 * FieldControls
 * ---------------------------------------------------------------------------------------------- */

export class FieldControls {
  private readonly overlay: OverlayHandle;
  private readonly handlers: FieldControlHandlers;
  private readonly entries = new Map<string, Entry>();
  /** Element → id, so the shared document listeners can find an entry in one lookup. */
  private readonly byElement = new WeakMap<Element, string>();

  private layer: HTMLElement | null = null;
  private frame: number | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private listening = false;
  private disposed = false;
  private lastPending = -1;

  constructor(overlay: OverlayHandle, handlers: FieldControlHandlers) {
    this.overlay = overlay;
    this.handlers = handlers;
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * How many controls are still offering a value nobody has accepted or refused.
   *
   * Off `offering()`, the same predicate the visible ✓ and the click handler are gated on. A second,
   * weaker definition here made the bubble read "10 suggestions waiting" on a form the user had just
   * finished typing by hand — the exact failure this file warns about on `applyVisibility`.
   */
  get pending(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (this.offering(entry)) count += 1;
    }
    return count;
  }

  /** Is `el` a control this layer has drawn on at all? */
  has(el: Element): boolean {
    return this.entryForElement(el) !== null;
  }

  /**
   * Does this layer have something to *offer* on `el`? `Suggest.ts` asks before opening a session.
   *
   * "I have an entry here" is the wrong question, and asking it retires half of `Suggest.ts`: this
   * layer keeps an entry for every eligible control so 💾 is ready the moment the user types, and a
   * dropdown the matcher could not place is exactly the case `Suggest.ts` is uniquely able to help
   * with — it can fuzzy-match a banked answer against the option list on focus, which this layer
   * never attempts. Ownership has to mean "there is a live offer here", or the two layers between
   * them do less than either did alone.
   */
  hasOffer(el: Element): boolean {
    const entry = this.entryForElement(el);
    return entry !== null && this.offering(entry);
  }

  /**
   * Replace the whole set. Entries whose id survives keep their DOM nodes — a re-scan fires several
   * times per application flow and rebuilding the cluster under the user's cursor would eat the
   * click they were making.
   */
  set(specs: readonly FieldControlSpec[]): void {
    if (this.disposed) return;

    const wanted = new Set<string>();
    for (const spec of specs) {
      if (spec.id.length === 0) continue;
      if (wanted.has(spec.id)) continue; // two controls, one signature: the first one speaks
      wanted.add(spec.id);
      this.upsert(spec);
    }

    for (const [id, entry] of [...this.entries]) {
      if (wanted.has(id)) continue;
      this.destroyEntry(entry);
      this.entries.delete(id);
    }

    if (this.entries.size === 0) {
      this.stopTracking();
      this.announcePending();
      return;
    }
    this.startTracking();
    this.update();
    this.announcePending();
  }

  /**
   * Record that an offer is over, without waiting for the next scan.
   *
   * The ✓ path calls this only once the fill engine has *verified* the write, which is why a
   * rejected write leaves the offer standing: the field still has no answer, so the suggestion is
   * still the best thing on screen.
   */
  settle(id: string, how: 'accepted' | 'dismissed'): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    entry.state = how;
    this.hideGhost(entry);
    this.paintButtons(entry);
    this.announcePending();
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    this.destroyEntry(entry);
    this.entries.delete(id);
    if (this.entries.size === 0) this.stopTracking();
    this.announcePending();
  }

  /** Drop every control. The page keeps its own placeholders. */
  clear(): void {
    for (const entry of this.entries.values()) this.destroyEntry(entry);
    this.entries.clear();
    this.stopTracking();
    this.layer?.replaceChildren();
    this.announcePending();
  }

  /** Remove listeners, timers and DOM. The instance is unusable afterwards. */
  dispose(): void {
    this.clear();
    this.disposed = true;
    this.layer = null;
  }

  /* ---- construction ------------------------------------------------------------------------- */

  private container(): HTMLElement {
    if (this.layer === null || !this.layer.isConnected) {
      this.overlay.ensureAttached();
      this.layer = this.overlay.layer('fields');
    }
    return this.layer;
  }

  private upsert(spec: FieldControlSpec): void {
    const existing = this.entries.get(spec.id);
    if (existing !== undefined) {
      const moved = existing.spec.el !== spec.el;
      // A suggestion that changed text has to re-offer itself; one that only lost its ghost
      // (because the user typed) keeps whatever state the input listener left it in.
      const changed = existing.spec.suggestion !== spec.suggestion;
      if (moved) {
        // The old element must stop resolving to this entry, or an event from it would be acted on as
        // if it came from the control that replaced it — including a Tab that writes a value.
        this.byElement.delete(existing.spec.el);
        this.byElement.set(spec.el, spec.id);
      }
      existing.spec = spec;
      if (moved || changed) {
        existing.state = 'offer';
        existing.metrics = null;
      }
      existing.last = null; // force a repaint pass
      this.paintButtons(existing);
      this.syncGhost(existing);
      return;
    }

    const cluster = document.createElement('div');
    cluster.className = 'jf-cluster';
    cluster.setAttribute('role', 'group');
    // Without this the mousedown blurs the field, the page's own blur handler runs, and the click
    // lands on a control that has already moved (INV-1: we never focus anything either).
    cluster.addEventListener('pointerdown', (event) => event.preventDefault());

    const accept = this.makeButton('accept', '✓');
    accept.addEventListener('click', () => this.fire(spec.id, 'accept'));
    const dismiss = this.makeButton('dismiss', '✕');
    dismiss.addEventListener('click', () => this.fire(spec.id, 'dismiss'));
    const save = this.makeButton('save', '💾');
    save.addEventListener('click', () => this.fire(spec.id, 'save'));

    cluster.append(accept, dismiss, save);
    this.container().appendChild(cluster);

    const entry: Entry = {
      spec,
      state: 'offer',
      cluster,
      accept,
      dismiss,
      save,
      ghost: null,
      ghosting: false,
      onScreen: false,
      metrics: null,
      last: null,
    };
    this.entries.set(spec.id, entry);
    this.byElement.set(spec.el, spec.id);
    this.paintButtons(entry);
    this.syncGhost(entry);
  }

  private makeButton(kind: 'accept' | 'dismiss' | 'save', glyph: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `jf-cluster__btn jf-cluster__btn--${kind}`;
    button.textContent = glyph;
    return button;
  }

  private destroyEntry(entry: Entry): void {
    entry.ghost?.remove();
    entry.cluster.remove();
  }

  /* ---- what the cluster says ---------------------------------------------------------------- */

  private offering(entry: Entry): boolean {
    if (entry.state !== 'offer') return false;
    if (entry.spec.suggestion.length === 0) return false;
    // Read the control rather than a remembered flag: whatever the page did to the value since the
    // scan, the question "is there still an empty field to fill?" is about the field as it is now.
    return readAnswerValue(entry.spec.el).trim().length === 0;
  }

  /**
   * Is there anything for this cluster to say?
   *
   * Either a live offer, or something already in the box that 💾 could keep. An empty control the
   * matcher could not place has nothing to offer and nothing to remember — and a hundred dim 💾
   * buttons down the side of a Workday step is noise, not a feature. The moment the user types into
   * one of them, this turns true and the cluster appears beside what they are writing.
   */
  private wanted(entry: Entry): boolean {
    if (this.offering(entry)) return true;
    return readAnswerValue(entry.spec.el).trim().length > 0;
  }

  /**
   * The single place either piece is shown or hidden. Two independent conditions decide it — is the
   * control on screen, and is there anything to say about it — and they change at different times
   * (one on scroll, one on a keystroke), which is exactly how a `classList.toggle` in one of those
   * two paths ends up disagreeing with the other.
   */
  private applyVisibility(entry: Entry): void {
    const visible = entry.onScreen && this.wanted(entry);
    entry.cluster.classList.toggle('jf-cluster--show', visible);
    entry.ghost?.classList.toggle('jf-ghost--show', visible && entry.ghosting);
  }

  private paintButtons(entry: Entry): void {
    const label = clampText(entry.spec.label, MAX_TOOLTIP_CHARS);
    const named = label.length > 0 ? label : 'this field';
    const offering = this.offering(entry);

    entry.cluster.classList.toggle('jf-cluster--save-only', !offering);
    entry.cluster.setAttribute('aria-label', `NextMove suggestion for ${named}`);

    if (offering) {
      const preview = clampText(entry.spec.suggestion, MAX_TOOLTIP_CHARS);
      // Tab and Esc are gated on a visible ghost (`onKeyDown`), so a control that never gets one — a
      // dropdown, a radio group — must not advertise them.
      const tab = entry.ghosting ? ' (Tab)' : '';
      const esc = entry.ghosting ? ' (Esc)' : '';
      describe(entry.accept, `Fill “${named}” with “${preview}”${tab}`);
      describe(entry.dismiss, `Don’t suggest anything for “${named}”${esc}`);
      // The preview belongs on the cluster too: a select or a radio group never carries a ghost, so
      // the tooltip is the only place the proposed value is visible before it is accepted.
      entry.cluster.setAttribute('title', preview);
    } else {
      entry.cluster.removeAttribute('title');
    }
    this.applyVisibility(entry);

    const value = readAnswerValue(entry.spec.el).trim();
    const savable = value.length > 0;
    entry.save.setAttribute('aria-disabled', savable ? 'false' : 'true');
    describe(
      entry.save,
      savable
        ? `Remember “${clampText(value, MAX_TOOLTIP_CHARS)}” as your answer to “${named}”`
        : `Type an answer for “${named}” first, then 💾 remembers it`,
    );
  }

  /* ---- the ghost ---------------------------------------------------------------------------- */

  private syncGhost(entry: Entry): void {
    if (!entry.spec.ghost || !this.offering(entry)) {
      this.hideGhost(entry);
      return;
    }
    this.showGhost(entry);
  }

  private showGhost(entry: Entry): void {
    // A control with a placeholder we cannot reliably cover keeps its placeholder: two greys in one
    // box is less use than one, and the proposed value is still one hover away on the cluster.
    if (this.measure(entry).backdrop === null && hasPlaceholder(entry.spec.el)) {
      this.hideGhost(entry);
      return;
    }

    let ghost = entry.ghost;
    if (ghost === null) {
      ghost = document.createElement('div');
      ghost.className = 'jf-ghost';
      ghost.setAttribute('aria-hidden', 'true');
      // Behind the cluster in paint order, which is what a preview should be.
      this.container().insertBefore(ghost, entry.cluster);
      entry.ghost = ghost;
    }
    // SEC 9.2 — the value is profile data and the label is page data; both are assigned as text.
    ghost.textContent = entry.spec.suggestion;

    entry.ghosting = true;
    entry.last = null;
    this.applyVisibility(entry);
  }

  private hideGhost(entry: Entry): void {
    entry.ghosting = false;
    this.applyVisibility(entry);
  }

  /* ---- shared listeners -------------------------------------------------------------------- */

  private startTracking(): void {
    if (this.listening || this.disposed) return;
    this.listening = true;
    // Capture phase throughout: a page that stops propagation on its own inputs (Workday does)
    // must not be able to switch this layer off by accident.
    window.addEventListener('scroll', this.onViewportChange, { passive: true, capture: true });
    window.addEventListener('resize', this.onViewportChange, { passive: true });
    document.addEventListener('input', this.onEdit, true);
    document.addEventListener('change', this.onEdit, true);
    document.addEventListener('keydown', this.onKeyDown, true);
    this.interval = setInterval(this.onViewportChange, SAFETY_INTERVAL_MS);
  }

  private stopTracking(): void {
    if (!this.listening) return;
    this.listening = false;
    window.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange);
    document.removeEventListener('input', this.onEdit, true);
    document.removeEventListener('change', this.onEdit, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  private entryForElement(el: Element): Entry | null {
    const id = this.byElement.get(el);
    if (id !== undefined) {
      const entry = this.entries.get(id);
      if (entry !== undefined) return entry;
    }
    // SEC 6.2 models a radio group as ONE field whose element is the group's first member, so a
    // `change` on any other member has to resolve to the same entry — otherwise ticking the second
    // option leaves the cluster still offering, and 💾 still dim, for a question that is answered.
    if (el instanceof HTMLInputElement && el.type === 'radio') {
      for (const radio of radioGroup(el)) {
        if (radio === el) continue;
        const groupId = this.byElement.get(radio);
        if (groupId === undefined) continue;
        const entry = this.entries.get(groupId);
        if (entry !== undefined) return entry;
      }
    }
    return null;
  }

  /**
   * The entry an event belongs to.
   *
   * `event.target` is the wrong thing to read: the scanner walks into open shadow roots (a real ATS
   * shape), and an event crossing a shadow boundary is *retargeted* to the host — so a control this
   * layer drew on inside one would never match, leaving the ghost painted over a field the user is
   * typing into with its opaque backdrop hiding their own text. `composedPath()[0]` is the node that
   * actually received the event, inside or out.
   */
  private entryFor(event: Event): Entry | null {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const origin = path[0] ?? event.target;
    if (!(origin instanceof Element)) return null;
    return this.entryForElement(origin);
  }

  /**
   * The user typed. The ghost goes at the first keystroke — two values in one box is worse than no
   * suggestion at all — and 💾 wakes up, because what they are typing is exactly what it is for.
   *
   * Clearing the field back to empty brings the offer back, from the same predicate that retired
   * it. A suggestion is not spent by being ignored for a moment.
   */
  private readonly onEdit = (event: Event): void => {
    const entry = this.entryFor(event);
    if (entry === null) return;
    this.paintButtons(entry);
    this.syncGhost(entry);
    this.schedule();
    this.announcePending();
  };

  /**
   * Tab takes the suggestion, Esc refuses it — the v2.2 keyboard, kept alive now that this layer
   * (and not `Suggest.ts`) owns the fields the matcher recognised.
   *
   * Both are gated on `offering`, the same predicate the visible ✓ is gated on, so a key can never
   * do something the cluster is no longer showing.
   */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab' && event.key !== 'Escape') return;
    if (event.key === 'Tab' && event.shiftKey) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const entry = this.entryFor(event);
    if (entry === null || !this.offering(entry) || !entry.ghosting) return;

    if (event.key === 'Tab') {
      event.preventDefault();
      this.fire(entry.spec.id, 'accept');
      return;
    }
    this.fire(entry.spec.id, 'dismiss');
  };

  private fire(id: string, action: 'accept' | 'dismiss' | 'save'): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;

    try {
      if (action === 'save') {
        if (entry.save.getAttribute('aria-disabled') === 'true') return;
        this.handlers.onSave(id);
        return;
      }
      // Same gate as the keyboard, and not the CSS that hides the button: a stray click on a
      // hidden control must not be able to accept or refuse anything either.
      if (!this.offering(entry)) return;
      if (action === 'accept') this.handlers.onAccept(id);
      else this.handlers.onDismiss(id);
    } catch (error) {
      log.debug(`the ${action} handler threw`, error);
    }
  }

  private announcePending(): void {
    const count = this.pending;
    if (count === this.lastPending) return;
    this.lastPending = count;
    try {
      this.handlers.onPendingChange?.(count);
    } catch (error) {
      log.debug('pending-count listener threw', error);
    }
  }

  /* ---- geometry --------------------------------------------------------------------------- */

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

  /** One geometry pass over every entry. Writes only the styles that actually changed. */
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
          entry.onScreen = false;
          this.applyVisibility(entry);
          entry.last = { top: 0, left: 0, width: 0, height: 0, hidden: true };
        }
        continue;
      }

      // `rect` is non-null here: `hidden` is true whenever it is null.
      const box = rect as DOMRect;
      const top = Math.round(box.top);
      const left = Math.round(box.left);
      const width = Math.round(box.width);
      const height = Math.round(box.height);

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
      // A control that changed size may have been restyled; its font is worth reading again.
      if (last === null || last.width !== width || last.height !== height) entry.metrics = null;

      entry.onScreen = true;
      this.paintCluster(entry, box);
      if (entry.ghosting) this.paintGhost(entry, box);
      this.applyVisibility(entry);
      entry.last = { top, left, width, height, hidden: false };
    }
  }

  private paintCluster(entry: Entry, rect: DOMRect): void {
    const isTextarea = entry.spec.el instanceof HTMLTextAreaElement;
    const gutter = entry.spec.crowded === true ? SPARKLE_GUTTER : 0;
    const top = isTextarea ? rect.top + TEXTAREA_CLUSTER_OFFSET : rect.top + rect.height / 2;

    entry.cluster.style.top = `${top}px`;
    entry.cluster.style.left = `${rect.right - CLUSTER_INSET - gutter}px`;
    entry.cluster.style.transform = 'translate(-100%, -50%)';
  }

  /**
   * Everything the ghost needs off the live element, read once and cached.
   *
   * `getComputedStyle` on a hundred controls on every scroll frame is the one thing in this file
   * that could genuinely cost the user frames, so the read is refreshed only when the control's box
   * actually changes size (see `update`).
   */
  private measure(entry: Entry): Metrics {
    const existing = entry.metrics;
    if (existing !== null) return existing;

    const field = entry.spec.el;
    const style = getComputedStyle(field);
    const metrics: Metrics = {
      insetLeft: num(style.paddingLeft) + num(style.borderLeftWidth),
      insetTop: num(style.paddingTop) + num(style.borderTopWidth),
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      backdrop: hasPlaceholder(field) ? resolveBackdrop(field) : null,
    };
    entry.metrics = metrics;
    return metrics;
  }

  /**
   * The ghost has to land on the control's own text origin or it reads as a second, misaligned value.
   * That origin is the control's border + padding, and the type is whatever the page computed — so
   * all of it is copied off the live element rather than guessed.
   */
  private paintGhost(entry: Entry, rect: DOMRect): void {
    const ghost = entry.ghost;
    if (ghost === null) return;
    const field = entry.spec.el;

    const metrics = this.measure(entry);
    ghost.style.fontFamily = metrics.fontFamily;
    ghost.style.fontSize = metrics.fontSize;
    ghost.style.fontWeight = metrics.fontWeight;

    const gutter = GHOST_RIGHT_GUTTER + (entry.spec.crowded === true ? SPARKLE_GUTTER : 0);
    ghost.style.left = `${rect.left + metrics.insetLeft}px`;
    ghost.style.background = metrics.backdrop ?? 'transparent';
    ghost.style.maxWidth = `${Math.max(0, rect.width - metrics.insetLeft - gutter)}px`;

    if (field instanceof HTMLTextAreaElement) {
      // A textarea's first line starts at the padding box, not at the vertical centre.
      ghost.style.alignItems = 'flex-start';
      ghost.style.top = `${rect.top + metrics.insetTop}px`;
      ghost.style.height = 'auto';
      ghost.style.lineHeight = metrics.lineHeight;
    } else {
      ghost.style.alignItems = 'center';
      ghost.style.top = `${rect.top}px`;
      ghost.style.height = `${rect.height}px`;
    }
  }
}

/**
 * What one option reads as. `textContent` is never null on an element, so it is `''` for an option
 * whose label lives in an attribute or in CSS — and `''` would report an answered dropdown as empty,
 * putting this file's three live predicates back at odds with the engine's. The value is the fallback.
 */
function optionText(option: HTMLOptionElement): string {
  const text = (option.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : option.value;
}

/** Does this control print something of its own in the space a ghost would occupy? */
function hasPlaceholder(el: Element): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.placeholder.trim().length > 0;
  }
  return false;
}

/** Tooltip and accessible name in one move; both are page-derived text (SEC 9.2). */
function describe(button: HTMLButtonElement, text: string): void {
  button.title = text;
  button.setAttribute('aria-label', text);
}
