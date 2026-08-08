/**
 * tracker/detectors.ts — confirmation detection for the Application Tracker
 * (JF-001 Rev 3.0 SEC 6.7 "Status flip", F-12).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════════
 *  INV-1 — THIS MODULE IS PURE OBSERVATION. IT NEVER CLICKS ANYTHING.
 *
 *  JobFill never auto-submits an application. There is no `.click()`, no `.submit()`, no
 *  `requestSubmit()`, no synthetic pointer event and no navigation anywhere in this file, and there
 *  never may be. The tracker flips a row from `draft` to `applied` only because it OBSERVED a
 *  confirmation state that the *user's own* submit produced — a thank-you URL, or a confirmation
 *  cue rendered in the page. Reading the page is the entire contract.
 *
 *  If a future change here needs to interact with the page, it belongs somewhere else.
 * ══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * SEC 9.2: the page text inspected below is untrusted. It is read via `textContent` only, never
 * `innerHTML`, is length-capped, and is used solely to decide a boolean.
 */

/* ------------------------------------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------------------------------- */

/**
 * The adapter's `confirmation` block (SEC 6.5 / 6.7). Structurally compatible with
 * `ResolvedAdapterConfig['confirmation']`, so a resolved adapter config can be passed straight in.
 * Patterns arrive as strings because they are shipped as remote JSON DATA (F-14, MV3-legal).
 */
export interface ConfirmationRules {
  urlPatterns?: readonly string[];
  selectors?: readonly string[];
}

export type ConfirmationSource =
  | 'adapter-selector'
  | 'adapter-url'
  | 'url'
  | 'dom-landmark'
  | 'dom-text'
  | 'none';

export interface ConfirmationSignal {
  /** True once `confidence >= CONFIRMATION_MIN_CONFIDENCE`. The tracker requires this to flip. */
  confirmed: boolean;
  source: ConfirmationSource;
  /** Human-readable proof — the matched pattern, selector, or the cue sentence (truncated). */
  evidence: string;
  /** 0–1. */
  confidence: number;
}

/* ------------------------------------------------------------------------------------------------
 * The shipped rules
 * ---------------------------------------------------------------------------------------------- */

/** URL shapes that mean "you already submitted" across essentially every ATS (SEC 6.7). */
export const CONFIRMATION_URL_PATTERNS: readonly RegExp[] = [
  /thank[-_]?you/i,
  /confirmation/i,
  /application[-_]?(received|submitted|complete[d]?|success)/i,
  /(^|[/?#])(submitted|success|completed)([/?#]|$)/i,
  /applicationsubmitted/i,
  /post[-_]?apply/i,
];

/** In-page cues. Deliberately whole phrases — single words like "submitted" false-positive badly. */
export const CONFIRMATION_TEXT_CUES: readonly RegExp[] = [
  /your application has been (submitted|received|sent)/i,
  /application (has been |was )?(successfully )?(submitted|received)/i,
  /we(?:'ve| have) received your application/i,
  /thank you for (applying|your application|your interest in (applying|this))/i,
  /thanks for (applying|your application)/i,
  /your application (is|was) (complete|submitted)/i,
  /you(?:'ve| have) (successfully )?applied/i,
  /application submitted successfully/i,
  /submission (was )?successful/i,
];

/** Landmarks a confirmation screen tends to use. A cue found inside one of these is stronger. */
const LANDMARK_SELECTORS: readonly string[] = [
  '[role="status"]',
  '[role="alert"]',
  '[aria-live="polite"]',
  '[aria-live="assertive"]',
  '[data-automation-id="confirmationPage"]',
  '#application_confirmation',
  '.application-confirmation',
  '.confirmation',
  '.post-apply',
  '.thank-you',
  'h1',
  'h2',
];

/** Below this the tracker leaves the row as `draft` and lets the user flip it by hand. */
export const CONFIRMATION_MIN_CONFIDENCE = 0.7;

const CONFIDENCE = {
  adapterSelector: 0.95,
  adapterUrl: 0.9,
  url: 0.85,
  domLandmark: 0.8,
  domText: 0.7,
} as const;

/** Body text scanned for cues. A confirmation screen is short; this is plenty and bounds the cost. */
const BODY_TEXT_SCAN_CHARS = 20_000;
/** Remote-config patterns are data we control, but they are still bounded before compiling. */
const MAX_PATTERN_LENGTH = 200;

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------------- */

function collapse(text: string): string {
  return (text ?? '').replace(/[\s\u00a0]+/g, ' ').trim();
}

function clip(text: string, max = 160): string {
  const value = collapse(text);
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Compile adapter/remote-config pattern strings into regexes. Anything malformed or absurdly long
 * is skipped rather than thrown — a bad line in `adapters.json` must never break detection (F-14).
 */
export function compilePatterns(patterns: readonly string[] | undefined): RegExp[] {
  if (patterns === undefined) return [];
  const out: RegExp[] = [];
  for (const pattern of patterns) {
    if (typeof pattern !== 'string') continue;
    const source = pattern.trim();
    if (source.length === 0 || source.length > MAX_PATTERN_LENGTH) continue;
    try {
      out.push(new RegExp(source, 'i'));
    } catch {
      continue;
    }
  }
  return out;
}

/** SEC 9.2: textContent only, and bounded. */
function bodyText(doc: Document): string {
  const body = doc.body;
  if (body === null) return '';
  const raw = body.textContent ?? '';
  return collapse(raw.length > BODY_TEXT_SCAN_CHARS ? raw.slice(0, BODY_TEXT_SCAN_CHARS) : raw);
}

function firstCue(text: string): string {
  for (const cue of CONFIRMATION_TEXT_CUES) {
    const match = cue.exec(text);
    if (match !== null) {
      const start = Math.max(0, match.index - 20);
      return clip(text.slice(start, match.index + match[0].length + 40));
    }
  }
  return '';
}

/* ------------------------------------------------------------------------------------------------
 * Public detection surface — all read-only
 * ---------------------------------------------------------------------------------------------- */

/** Does this URL look like a post-submission destination? */
export function matchesConfirmationUrl(
  url: string,
  extraPatterns?: readonly string[],
): { matched: boolean; pattern: string; fromAdapter: boolean } {
  const value = (url ?? '').trim();
  if (value.length === 0) return { matched: false, pattern: '', fromAdapter: false };

  for (const pattern of compilePatterns(extraPatterns)) {
    if (pattern.test(value)) return { matched: true, pattern: pattern.source, fromAdapter: true };
  }
  for (const pattern of CONFIRMATION_URL_PATTERNS) {
    if (pattern.test(value)) return { matched: true, pattern: pattern.source, fromAdapter: false };
  }
  return { matched: false, pattern: '', fromAdapter: false };
}

/**
 * Does the DOM show a confirmation? Adapter-declared selectors are checked first (a selector the
 * adapter author wrote for this exact ATS is the strongest in-page evidence), then the generic
 * landmarks, then the whole body.
 *
 * INV-1: every branch below is a query and a string test. Nothing is clicked.
 */
export function findConfirmationCue(
  doc: Document,
  selectors?: readonly string[],
): { source: ConfirmationSource; evidence: string } {
  if (selectors !== undefined) {
    for (const selector of selectors) {
      if (typeof selector !== 'string' || selector.trim().length === 0) continue;
      let el: Element | null = null;
      try {
        el = doc.querySelector(selector);
      } catch {
        continue;
      }
      if (el === null) continue;
      const text = collapse(el.textContent ?? '');
      // The adapter says "if this exists, they submitted" — its presence is the evidence.
      return { source: 'adapter-selector', evidence: clip(`${selector} → ${text}`) };
    }
  }

  for (const selector of LANDMARK_SELECTORS) {
    let elements: Element[] = [];
    try {
      elements = Array.from(doc.querySelectorAll(selector));
    } catch {
      continue;
    }
    for (const el of elements) {
      const text = collapse(el.textContent ?? '');
      if (text.length === 0 || text.length > 400) continue;
      const cue = firstCue(text);
      if (cue.length > 0) return { source: 'dom-landmark', evidence: cue };
    }
  }

  const cue = firstCue(bodyText(doc));
  if (cue.length > 0) return { source: 'dom-text', evidence: cue };

  return { source: 'none', evidence: '' };
}

/**
 * SEC 6.7 "Status flip": the single call the PageObserver makes after an SPA route change, a
 * wizard step transition or a full page load.
 *
 * INV-1: this OBSERVES that the user's own submit landed somewhere. It does not cause it, and it
 * cannot — nothing in this file interacts with the page.
 */
export function detectConfirmation(
  doc: Document,
  url: string,
  rules?: ConfirmationRules | null,
): ConfirmationSignal {
  const dom = findConfirmationCue(doc, rules?.selectors);
  if (dom.source === 'adapter-selector') {
    return {
      confirmed: true,
      source: 'adapter-selector',
      evidence: dom.evidence,
      confidence: CONFIDENCE.adapterSelector,
    };
  }

  const urlMatch = matchesConfirmationUrl(url, rules?.urlPatterns);
  if (urlMatch.matched) {
    const confidence = urlMatch.fromAdapter ? CONFIDENCE.adapterUrl : CONFIDENCE.url;
    return {
      confirmed: confidence >= CONFIRMATION_MIN_CONFIDENCE,
      source: urlMatch.fromAdapter ? 'adapter-url' : 'url',
      evidence: `url matches /${urlMatch.pattern}/`,
      confidence,
    };
  }

  if (dom.source === 'dom-landmark' || dom.source === 'dom-text') {
    const confidence =
      dom.source === 'dom-landmark' ? CONFIDENCE.domLandmark : CONFIDENCE.domText;
    return {
      confirmed: confidence >= CONFIRMATION_MIN_CONFIDENCE,
      source: dom.source,
      evidence: dom.evidence,
      confidence,
    };
  }

  return { confirmed: false, source: 'none', evidence: '', confidence: 0 };
}

/** A signal that explicitly did not confirm — handy as a default in callers and tests. */
export const NO_CONFIRMATION: ConfirmationSignal = {
  confirmed: false,
  source: 'none',
  evidence: '',
  confidence: 0,
};
