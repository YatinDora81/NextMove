/**
 * tracker/submit-watch.ts — the submit-time signal (JF-001 Rev 3.0 SEC 6.7 "Status flip", v2.2
 * Phase 3).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════════
 *  INV-1 — THIS MODULE WATCHES A SUBMISSION. IT NEVER CAUSES ONE.
 *
 *  There is no `.click()`, no form submission, no synthetic event and no navigation anywhere in this
 *  file, and there never may be. Every listener below is registered in the CAPTURE phase precisely
 *  so it can observe a press *without* being able to influence what the page does with it: capture
 *  listeners run before the page's own handlers and this one neither cancels nor re-dispatches.
 * ══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `./detectors` can only recognise a submission that already LANDED somewhere — a thank-you URL, a
 * confirmation cue rendered into the DOM. A large share of real applications produce neither: the
 * SPA replaces the form with a toast that never matches a cue, or the ATS iframe navigates away
 * before the observer's next sweep. Those applications were silently never tracked.
 *
 * This watcher supplies the one moment that is always available — the instant the user themselves
 * pressed Submit. It is a HINT, not a verdict: it reports `{ reason, label }` and stops there. The
 * caller decides whether the page is worth logging (`looksLikeJobPage()` in `./detectors`) and what
 * status to write.
 *
 * BOTH paths demand positive evidence that what was sent was an APPLICATION, because neither the
 * event nor the caller's gate can supply it. `submit` is a document-level event that the site's
 * job-search box, its login form and its newsletter signup all raise, and `looksLikeJobPage()` is
 * true for an entire careers host — so "some form was submitted on a careers site" would mint an
 * `applied` row for a job nobody applied to. A press is credited only when the control says in words
 * that it sends an application (`SUBMIT_LABEL_PATTERN`), or the form is shaped like one (a résumé
 * upload, or several of name / e-mail / phone / résumé / cover letter). With no evidence, nothing is
 * reported: a missed application costs the user one click in the tracker, an invented one costs
 * their trust in it.
 *
 * SEC 9.2: the label handed back is page-derived text. It is read through `controlLabel()`
 * (attributes and `textContent` only, never `innerHTML`) and clipped before it leaves this module.
 */

import { CONTROL_SELECTOR, controlLabel } from '@/core/adapters';

/* ------------------------------------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------------------------------- */

export interface SubmitSignal {
  /**
   * `form` — a `submit` event from a form that showed application evidence; `button` — a trusted
   * press on an apply/submit-shaped control.
   */
  reason: 'form' | 'button';
  /** Visible label of the control that was pressed; empty when a form submit named no submitter. */
  label: string;
}

export interface SubmitWatchOptions {
  onSubmit(signal: SubmitSignal): void;
  /** Injection point for tests; defaults to the live document. */
  doc?: Document;
  /** Signals arriving inside this window describe one press and are collapsed. */
  debounceMs?: number;
}

export interface SubmitWatchHandle {
  destroy(): void;
}

/* ------------------------------------------------------------------------------------------------
 * Vocabulary
 * ---------------------------------------------------------------------------------------------- */

/**
 * Labels that mean "this press sends the application".
 *
 * Whole-label matches, never substrings: "Apply filters" and "Submit a referral" are ordinary page
 * furniture, and treating either as a submission writes an application the user never made.
 */
export const SUBMIT_LABEL_PATTERN =
  /^(?:apply(?:\s+now)?|easy\s*apply|submit(?:\s+(?:your\s+)?application)?|send\s+application|review\s+and\s+submit|submit\s*(?:&|and)\s*continue|finish)$/i;

/**
 * `CONTROL_SELECTOR` already covers `button`, `[role="button"]` and button-shaped links; iCIMS and
 * Taleo still ship image inputs as their submit control.
 */
const PRESS_SELECTOR = `${CONTROL_SELECTOR}, input[type="image"]`;

/**
 * The vocabularies an application form is built out of.
 *
 * Whole tokens only (the signature is normalised to space-separated words first): `username` must
 * never read as a `name` field, or every login box on the web becomes an application.
 */
const APPLICATION_FIELD_PATTERNS: readonly { readonly kind: string; readonly pattern: RegExp }[] = [
  { kind: 'name', pattern: /\b(?:first|last|given|family|legal|full|preferred|middle)?\s?name\b/ },
  { kind: 'email', pattern: /\be?mail\b/ },
  { kind: 'phone', pattern: /\b(?:phone|mobile|telephone|tel)\b/ },
  { kind: 'resume', pattern: /\b(?:resume|resum|cv|curriculum\s?vitae)\b/ },
  { kind: 'cover', pattern: /\bcover\s?letter\b/ },
];

/**
 * Words that turn a `name`-shaped token into somebody else's name. `username` survives
 * normalisation as one token and never matches, but `user_name` and `company name` do.
 */
const NOT_A_PERSON_NAME = /\b(?:user|login|company|employer|school|university|file|card|domain)\s(?:name)\b/;

/** Attributes read to work out what a field is asking for. Attributes only — never `innerHTML`. */
const FIELD_SIGNATURE_ATTRS: readonly string[] = [
  'name',
  'id',
  'autocomplete',
  'placeholder',
  'aria-label',
  'title',
  'data-automation-id',
  'data-testid',
  'data-qa',
];

/**
 * A résumé upload is the single most application-specific thing a form can contain, so it counts
 * for more than one ordinary field — but never for the whole verdict on its own: a "send us your
 * document" widget is not an application.
 */
const FILE_INPUT_WEIGHT = 2;

/**
 * Evidence needed before an unlabelled form submit counts. Three ordinary application fields
 * (name + email + phone), or a résumé upload next to one of them. A search box (one field, zero
 * matches) and a newsletter box (one email) are both far below it.
 */
const MIN_APPLICATION_FIELD_SCORE = 3;

/** Bounds the per-submit cost on pages that ship pathological forms. */
const MAX_FIELDS_SCANNED = 200;


/**
 * A press on a real submit button fires the click AND the form's `submit` event a millisecond
 * apart. Both describe the same application, so the second one is dropped.
 */
const DEFAULT_DEBOUNCE_MS = 1_500;

/** How far up a composed path the pressed control is looked for. Bounds the per-click cost. */
const MAX_PATH_DEPTH = 12;

/** The label is untrusted page text and only exists for the audit trail; it does not need to be long. */
const MAX_LABEL_CHARS = 80;

/* ------------------------------------------------------------------------------------------------
 * Helpers — all read-only
 * ---------------------------------------------------------------------------------------------- */

function collapse(text: string): string {
  return text.replace(/[\s\u00a0]+/g, ' ').trim();
}

function clipLabel(label: string): string {
  const value = collapse(label);
  return value.length <= MAX_LABEL_CHARS ? value : value.slice(0, MAX_LABEL_CHARS);
}

function isPressable(el: Element): boolean {
  try {
    return el.matches(PRESS_SELECTOR);
  } catch {
    return false;
  }
}

/**
 * The control the user actually pressed. `composedPath()` is preferred over `target.closest()`
 * because several ATS render their submit button inside a web component, where `closest()` stops at
 * the shadow boundary and reports nothing.
 */
function pressedControl(event: MouseEvent): Element | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  const depth = Math.min(path.length, MAX_PATH_DEPTH);
  for (let i = 0; i < depth; i += 1) {
    const node = path[i];
    if (node instanceof Element && isPressable(node)) return node;
  }

  const target = event.target;
  return target instanceof Element ? target.closest(PRESS_SELECTOR) : null;
}

/** `SubmitEvent.submitter` is not in every engine (and not in the test DOM), so it is read defensively. */
function submitterOf(event: Event): Element | null {
  const submitter = (event as { submitter?: unknown }).submitter;
  return submitter instanceof Element ? submitter : null;
}

function isForm(node: unknown): node is Element {
  return node instanceof Element && node.tagName.toLowerCase() === 'form';
}

/**
 * The `<form>` that was submitted. Normally `event.target`; the composed path is the fallback for
 * the ATS that raise the event from inside a shadow root, where the target is retargeted to the
 * host. Returning `null` means "no form to inspect", which the caller treats as no evidence.
 */
function submittedForm(event: Event): Element | null {
  if (isForm(event.target)) return event.target;

  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  const depth = Math.min(path.length, MAX_PATH_DEPTH);
  for (let i = 0; i < depth; i += 1) {
    const node = path[i];
    if (isForm(node)) return node;
  }
  return null;
}

function safeQueryAll(root: Element, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/** Everything a field advertises about itself, normalised to lower-case space-separated words. */
function fieldSignature(el: Element): string {
  const parts: string[] = [];
  for (const attr of FIELD_SIGNATURE_ATTRS) {
    const value = el.getAttribute(attr);
    if (value !== null && value.length > 0) parts.push(value);
  }

  // `type` is a claim about meaning, not just about the keyboard: `email`/`tel` name themselves.
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  if (type === 'email') parts.push('email');
  if (type === 'tel') parts.push('phone');

  return parts.join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** What a form's own fields say about whether it is an application. `null` ⇒ disqualified. */
interface ApplicationShape {
  /** Distinct application field kinds found, with a résumé upload weighted heavier. */
  score: number;
  hasFileInput: boolean;
}

/**
 * Read the form's shape: which of the questions an application asks does it actually ask, and does
 * it take a résumé.
 *
 * A password field vetoes outright (`null`): sign-in and create-an-account steps ask for a name and
 * an e-mail too, and neither one is a submitted application.
 */
function applicationShape(form: Element): ApplicationShape | null {

  const fields = safeQueryAll(form, 'input, select, textarea').slice(0, MAX_FIELDS_SCANNED);

  const kinds = new Set<string>();
  let hasFileInput = false;

  for (const field of fields) {
    const type = (field.getAttribute('type') ?? '').toLowerCase();
    if (type === 'password') return null;

    if (type === 'file') {
      hasFileInput = true;
      continue;
    }
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image') continue;

    const signature = fieldSignature(field);
    if (signature.length === 0) continue;

    for (const { kind, pattern } of APPLICATION_FIELD_PATTERNS) {
      if (kinds.has(kind) || !pattern.test(signature)) continue;
      if (kind === 'name' && NOT_A_PERSON_NAME.test(signature)) continue;
      kinds.add(kind);
    }
  }

  return { score: kinds.size + (hasFileInput ? FILE_INPUT_WEIGHT : 0), hasFileInput };
}

/**
 * The FORM path's filter, and the whole point of this module not being a bogus-row generator.
 *
 * `submit` is a document-level event: the site's job-search box, its login form and its newsletter
 * signup all raise one, and the caller's other gate — `looksLikeJobPage()` — is true for an entire
 * careers host. So the evidence here is deliberately CONJUNCTIVE, and each half exists because the
 * other half alone was demonstrably not enough:
 *
 *   - Words alone are not enough. A bare "Submit" caption sits on search boxes, newsletter signups
 *     and feedback widgets, so the pressed control's label can never carry the verdict by itself.
 *   - Shape alone is not enough either, and shape must come from the SUBMITTED form's own fields.
 *     An earlier version scanned the whole form for any apply-shaped control, which fired on the
 *     ordinary job-board layout where one big search `<form>` wraps the results list and every
 *     result card carries an "Apply now" link — crediting a control nobody pressed.
 *
 * Known floor: a "contact us" form carrying name + email + phone behind a "Submit" button on a
 * careers host still clears both halves. Two outer gates in `entrypoints/content.ts` cover it —
 * the page must also have scanned as application-shaped — and the alternative (demanding a résumé
 * field) would drop the final step of every multi-step ATS, where the upload happened pages ago.
 */
function looksLikeApplicationSubmit(form: Element | null, submitter: Element | null): boolean {
  if (form === null) return false; // Nothing to inspect ⇒ no evidence ⇒ fail closed.

  const shape = applicationShape(form);
  if (shape === null || shape.score < MIN_APPLICATION_FIELD_SCORE) return false;

  const spoken = submitter !== null && SUBMIT_LABEL_PATTERN.test(collapse(controlLabel(submitter)));
  return spoken || shape.hasFileInput;
}


/* ------------------------------------------------------------------------------------------------
 * The watcher
 * ---------------------------------------------------------------------------------------------- */

/**
 * Start watching for the user's own submission. Returns a handle whose `destroy()` detaches
 * everything; calling it twice is safe.
 *
 * INV-1: observation only — see the banner at the top of this file.
 */
export function installSubmitWatch(options: SubmitWatchOptions): SubmitWatchHandle {
  const doc = options.doc ?? document;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let destroyed = false;
  let lastSignalAt = 0;

  function fire(reason: SubmitSignal['reason'], label: string): void {
    if (destroyed) return;

    const at = Date.now();
    if (lastSignalAt > 0 && at - lastSignalAt < debounceMs) return;
    lastSignalAt = at;

    try {
      options.onSubmit({ reason, label: clipLabel(label) });
    } catch {
      // A throwing subscriber must never surface as an error inside the host page.
    }
  }

  const onSubmitEvent = (event: Event): void => {
    const submitter = submitterOf(event);
    // Every form on the page reaches this listener, so the submission has to earn the signal.
    if (!looksLikeApplicationSubmit(submittedForm(event), submitter)) return;

    fire('form', submitter === null ? '' : controlLabel(submitter));
  };

  const onClickEvent = (event: MouseEvent): void => {
    // Only a real human press counts. A page script dispatching its own click is exactly the case
    // that would otherwise log an application nobody made.
    if (!event.isTrusted) return;

    const control = pressedControl(event);
    if (control === null) return;

    const label = controlLabel(control);
    if (!SUBMIT_LABEL_PATTERN.test(collapse(label))) return;

    fire('button', label);
  };

  // Capture phase: an ATS that calls `stopPropagation()` in its own handler (Workday and Lever both
  // do) would otherwise hide the press entirely.
  doc.addEventListener('submit', onSubmitEvent, true);
  doc.addEventListener('click', onClickEvent, true);

  return {
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      doc.removeEventListener('submit', onSubmitEvent, true);
      doc.removeEventListener('click', onClickEvent, true);
    },
  };
}
