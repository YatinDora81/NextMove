/**
 * core/adapters/types.ts — the ATS adapter contract (JF-001 Rev 3.0 SEC 6.5).
 *
 * An adapter is four things and nothing more:
 *   1. a *detection rule*  (URL pattern + DOM fingerprint),
 *   2. a *field map*       (css selector → profile path, remote-overridable — F-14),
 *   3. *quirks*            (how this ATS wants to be driven: date format, typeahead pacing, …),
 *   4. optional *steps*    (multi-page wizards: Workday, iCIMS, Taleo).
 *
 * SEC 6.7 adds two more declarative blocks that used to live in the tracker:
 *   5. `capture`      — where the company / role header lives (auto-capture priority chain, step 2),
 *   6. `confirmation` — what a submitted / thank-you state looks like. **Observed only.**
 *
 * INV-1 is a *structural* property of this module, not a promise in a comment:
 *   - `FillQuirks.submitSelectors` exists so the fill engine can EXCLUDE those controls;
 *   - `AdapterSteps.nextButton()` LOCATES a control and returns it — every implementation in this
 *     folder carries the INV-1 comment and none of them calls `.click()` / `.submit()`;
 *   - `mergeQuirks()` can only ever ADD to `submitSelectors` — a remote config can extend the
 *     exclusion list but can never shrink it.
 *
 * SEC 14.1 R-3: this module imports only from `@/shared/**`. No `@repo/ui`, no `@repo/db`.
 */

import { LISTBOX_WAIT_MS, TYPEAHEAD_JITTER_MS } from '@/shared/constants';
import type { AtsId, ProfilePath } from '@/shared/types';

/** Re-exported so an adapter file needs exactly one import to write its field map. */
export type { AtsId, ProfilePath };

/* ------------------------------------------------------------------------------------------------
 * SEC 6.5 — the contract
 * ---------------------------------------------------------------------------------------------- */

/** What `detect()` is handed: the page's URL and its Document. Nothing else — detection is pure. */
export interface AdapterContext {
  url: URL;
  doc: Document;
}

/**
 * Per-ATS knobs for the FillEngine (SEC 6.4). Every field is remote-overridable (F-14) and every
 * consumer should read the *resolved* quirks from the registry rather than an adapter's raw block.
 */
export interface FillQuirks {
  /**
   * Text format typed into widget date pickers (`MM/DD/YYYY`, `DD/MM/YYYY`, `YYYY-MM-DD`).
   * Native `<input type="date">` always uses ISO; this is for the ATS's own calendar widgets,
   * whose popup is never opened (SEC 6.4).
   */
  dateFormat: string;
  /** Per-character delay while driving a combobox / typeahead. */
  typeaheadDelayMs: number;
  /** Hard cap on waiting for a listbox to appear after typing; past it the field is `suggest`. */
  listboxWaitMs: number;
  /** Drop targets to try when the real `<input type="file">` is hidden behind a styled zone. */
  dropzoneSelectors: string[];
  /**
   * Submit and "next step" controls.
   *
   * INV-1: these are EXCLUDED from the fill set and are never clicked. The review overlay locates
   * and highlights them so a human presses them. Nothing in this codebase may call `.click()` or
   * `.submit()` on anything matching these selectors.
   */
  submitSelectors: string[];
  /** Root of the current wizard step; the scanner narrows to it on multi-page ATS. */
  stepContainerSelector: string;
}

/** SEC 6.7 step 2 — where this ATS puts the posting header. */
export interface AdapterCapture {
  /** Selectors whose resolved text is the hiring company. Highest priority first. */
  company: string[];
  /** Selectors whose resolved text is the role title. Highest priority first. */
  role: string[];
}

/**
 * SEC 6.7 step 4 — what "this application was submitted" looks like.
 *
 * INV-1: purely OBSERVED. The PageObserver flips a tracker row `draft → applied` when it *sees*
 * one of these; nothing here is ever navigated to, clicked, or triggered.
 */
export interface AdapterConfirmation {
  /**
   * Matched case-insensitively against the full URL. A pattern wrapped in `re:` is compiled as a
   * regular expression (`re:/thank[-_]?you/`); anything else is a plain substring test.
   */
  urlPatterns: string[];
  /** DOM cues; presence of any one of them means the page is showing a confirmation state. */
  selectors: string[];
}

/** Multi-page wizard navigation (Workday, iCIMS, Taleo). */
export interface AdapterSteps {
  /** True when the document is one page of a multi-step application flow. */
  isStepPage(doc: Document): boolean;
  /** Human-readable name of the step currently on screen; `''` when it cannot be determined. */
  currentStep(doc: Document): string;
  /**
   * Locates the control that advances the wizard.
   *
   * INV-1: located and highlighted, NEVER clicked. Returning an element is the whole job.
   */
  nextButton?(doc: Document): HTMLElement | null;
}

/**
 * SEC 6.5 adapter contract, extended with the SEC 6.7 declarative blocks.
 *
 * `id` is the closed `AtsId` union rather than the doc's `… | string` because every consumer
 * (`CONFIG_GET`, `ApplicationRow.ats`, `atsIdSchema`) keys off that union; a new ATS ships as a
 * new member of the union plus a new file in this folder, never as an ad-hoc string.
 */
export interface AtsAdapter {
  id: AtsId;
  /** URL pattern + DOM fingerprint. Must be cheap, must not throw, must not mutate the document. */
  detect(ctx: AdapterContext): boolean;
  /** css selector → profile path. Remote-overridable per key (F-14). */
  fieldMap(): Record<string, ProfilePath>;
  quirks?: Partial<FillQuirks>;
  steps?: AdapterSteps;
  capture?: Partial<AdapterCapture>;
  confirmation?: Partial<AdapterConfirmation>;
  /**
   * Extra remote-config keys this URL should pick up, lowest priority first.
   *
   * SEC 6.5 (Workday row): "per-tenant variance ⇒ remote config per tenant slug". Workday returns
   * `['workday:<tenant>']` so a single tenant can be hot-fixed from the CDN without touching the
   * shared `workday` block. Adapters with no per-tenant variance omit this.
   */
  configKeys?(url: URL): readonly string[];
}

/* ------------------------------------------------------------------------------------------------
 * Derived paths — the three adapter targets that are NOT dot paths into `Profile`
 * ---------------------------------------------------------------------------------------------- */

/**
 * A `ProfilePath` is normally a dot path into the vault (`personal.firstName`, `work[0].title`).
 * Three targets that virtually every ATS asks for have no home in the SEC 7.2 profile shape, so
 * adapters address them through these reserved pseudo-paths and the FillEngine resolves them:
 *
 *   - `personal.fullName` — composed as `personal.firstName + ' ' + personal.lastName`
 *     (Lever's `input[name="name"]`, Ashby's `_systemfield_name`).
 *   - `resume`            — the default `ResumeRecord` blob for the active profile (Dexie `resumes`).
 *   - `coverLetter`       — a resume-table record tagged `cover-letter`, if one exists.
 *
 * They are declared here so there is exactly one spelling of each across all eight adapters.
 */
export const DERIVED_PATHS = {
  fullName: 'personal.fullName',
  resume: 'resume',
  coverLetter: 'coverLetter',
} as const;

export type DerivedPath = (typeof DERIVED_PATHS)[keyof typeof DERIVED_PATHS];

export const DERIVED_PATH_LIST: readonly ProfilePath[] = [
  DERIVED_PATHS.fullName,
  DERIVED_PATHS.resume,
  DERIVED_PATHS.coverLetter,
];

/** True when `path` is one of the reserved pseudo-paths above rather than a real vault path. */
export function isDerivedPath(path: ProfilePath): boolean {
  return (DERIVED_PATH_LIST as readonly string[]).includes(path);
}

/** True when `path` addresses a file input (resume / cover letter) rather than a text value. */
export function isFilePath(path: ProfilePath): boolean {
  return path === DERIVED_PATHS.resume || path === DERIVED_PATHS.coverLetter;
}

/* ------------------------------------------------------------------------------------------------
 * Shipped defaults
 * ---------------------------------------------------------------------------------------------- */

/** Midpoint of the SEC 6.4 per-character jitter band — a concrete default for a single number. */
const DEFAULT_TYPEAHEAD_DELAY_MS = Math.round(
  (TYPEAHEAD_JITTER_MS.min + TYPEAHEAD_JITTER_MS.max) / 2,
);

/**
 * The floor every adapter inherits. Deliberately conservative: the generic engine has to survive
 * the long tail of hand-rolled career pages, so the submit exclusion list is broad (INV-1 — it is
 * always safer to refuse to touch a control than to touch the wrong one).
 */
export const DEFAULT_QUIRKS: FillQuirks = {
  dateFormat: 'MM/DD/YYYY',
  typeaheadDelayMs: DEFAULT_TYPEAHEAD_DELAY_MS,
  listboxWaitMs: LISTBOX_WAIT_MS,
  dropzoneSelectors: [
    '[class*="dropzone" i]',
    '[class*="drop-zone" i]',
    '[class*="file-upload" i]',
    '[data-testid*="dropzone" i]',
    '[data-testid*="upload" i]',
    '[aria-label*="drag" i]',
  ],
  // INV-1: never filled, never clicked — located and highlighted only.
  submitSelectors: [
    'button[type="submit"]',
    'input[type="submit"]',
    'input[type="image"]',
    'button[id*="submit" i]',
    'button[name*="submit" i]',
    'button[class*="submit" i]',
    '[role="button"][id*="submit" i]',
    '[data-testid*="submit" i]',
    '[data-test*="submit" i]',
    '[data-automation-id*="submit" i]',
  ],
  stepContainerSelector: 'form',
};

/** Button-ish elements scanned when a step control has to be found by its visible text. */
export const CONTROL_SELECTOR =
  'button, input[type="submit"], input[type="button"], [role="button"], a.btn, a[class*="button" i]';

/** Visible text of a control that advances a wizard (never clicked — INV-1). */
export const NEXT_TEXT_PATTERN = /^(next|continue|save\s*(and|&)?\s*continue|proceed|forward)\b/i;

/** Visible text of a control that submits an application (never clicked — INV-1). */
export const SUBMIT_TEXT_PATTERN = /\b(submit|send\s+application|apply\s+now|finish|complete)\b/i;

/* ------------------------------------------------------------------------------------------------
 * Merge helpers — used by the registry to overlay seed ⊕ remote on top of an adapter's own block
 * ---------------------------------------------------------------------------------------------- */

/** Order-preserving de-duplication; blank entries are dropped. */
export function uniqueSelectors(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Overlay `override` on top of `base`.
 *
 * Scalars are replaced. Selector lists are UNIONED with the override first, which gives a remote
 * hot-fix priority without ever dropping a shipped entry.
 *
 * INV-1: `submitSelectors` is union-only by construction — a remote config can extend the
 * never-touch list, but it can never remove a control from it.
 */
export function mergeQuirks(base: FillQuirks, override: Partial<FillQuirks> | undefined): FillQuirks {
  if (!override) return { ...base, dropzoneSelectors: [...base.dropzoneSelectors], submitSelectors: [...base.submitSelectors] };
  return {
    dateFormat: override.dateFormat ?? base.dateFormat,
    typeaheadDelayMs: override.typeaheadDelayMs ?? base.typeaheadDelayMs,
    listboxWaitMs: override.listboxWaitMs ?? base.listboxWaitMs,
    stepContainerSelector: override.stepContainerSelector ?? base.stepContainerSelector,
    dropzoneSelectors: uniqueSelectors([
      ...(override.dropzoneSelectors ?? []),
      ...base.dropzoneSelectors,
    ]),
    // INV-1: union, never replace.
    submitSelectors: uniqueSelectors([
      ...(override.submitSelectors ?? []),
      ...base.submitSelectors,
    ]),
  };
}

/** A positive, finite millisecond value or `undefined`. Guards remote config from junk numbers. */
function asDelay(value: unknown, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(Math.round(value), max);
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = uniqueSelectors(value.map((entry) => (typeof entry === 'string' ? entry : undefined)));
  return list.length > 0 ? list : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Narrow the untyped `quirks` bag of a remote config entry (it is `Record<string, unknown>` in
 * `remoteAdapterConfigSchema`) into a `Partial<FillQuirks>`. Unknown keys and wrong-typed values
 * are dropped silently — a malformed CDN file must degrade, never break the fill path.
 */
export function quirksFromRecord(
  raw: Record<string, unknown> | undefined | null,
): Partial<FillQuirks> {
  const out: Partial<FillQuirks> = {};
  if (!raw) return out;

  const dateFormat = asNonEmptyString(raw['dateFormat']);
  if (dateFormat !== undefined) out.dateFormat = dateFormat;

  const typeaheadDelayMs = asDelay(raw['typeaheadDelayMs'], 1_000);
  if (typeaheadDelayMs !== undefined) out.typeaheadDelayMs = typeaheadDelayMs;

  const listboxWaitMs = asDelay(raw['listboxWaitMs'], 15_000);
  if (listboxWaitMs !== undefined) out.listboxWaitMs = listboxWaitMs;

  const stepContainerSelector = asNonEmptyString(raw['stepContainerSelector']);
  if (stepContainerSelector !== undefined) out.stepContainerSelector = stepContainerSelector;

  const dropzoneSelectors = asStringList(raw['dropzoneSelectors']);
  if (dropzoneSelectors !== undefined) out.dropzoneSelectors = dropzoneSelectors;

  const submitSelectors = asStringList(raw['submitSelectors']);
  if (submitSelectors !== undefined) out.submitSelectors = submitSelectors;

  return out;
}

/** Inverse of {@link quirksFromRecord} — the shape `ResolvedAdapterConfig.quirks` carries. */
export function quirksToRecord(quirks: FillQuirks): Record<string, unknown> {
  return {
    dateFormat: quirks.dateFormat,
    typeaheadDelayMs: quirks.typeaheadDelayMs,
    listboxWaitMs: quirks.listboxWaitMs,
    dropzoneSelectors: [...quirks.dropzoneSelectors],
    submitSelectors: [...quirks.submitSelectors],
    stepContainerSelector: quirks.stepContainerSelector,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Tiny DOM helpers shared by the eight adapters
 * ---------------------------------------------------------------------------------------------- */

/**
 * `querySelector` that cannot throw. A single malformed selector — ours or, more likely, one
 * pushed from remote config — must not take the whole detection pass down with it.
 */
export function safeQuery(root: Document | Element, selector: string): HTMLElement | null {
  try {
    return root.querySelector<HTMLElement>(selector);
  } catch {
    return null;
  }
}

/** `querySelectorAll` that cannot throw. */
export function safeQueryAll(root: Document | Element, selector: string): HTMLElement[] {
  try {
    return Array.from(root.querySelectorAll<HTMLElement>(selector));
  } catch {
    return [];
  }
}

/** First element matching any selector, in the order given. */
export function queryFirst(
  root: Document | Element,
  selectors: readonly string[],
): HTMLElement | null {
  for (const selector of selectors) {
    const found = safeQuery(root, selector);
    if (found) return found;
  }
  return null;
}

/** True when any of the selectors matches. Used by every `detect()` for DOM fingerprinting. */
export function matchesAny(root: Document | Element, selectors: readonly string[]): boolean {
  return queryFirst(root, selectors) !== null;
}

/**
 * Resolve the *value* of a capture selector match (SEC 6.7 step 2):
 * `<meta>` → `content`, `<img>` → `alt`, form controls → `value`, everything else → text.
 */
export function readCaptureValue(el: Element | null): string {
  if (!el) return '';
  const tag = el.tagName.toLowerCase();
  if (tag === 'meta') return (el.getAttribute('content') ?? '').trim();
  if (tag === 'img') return (el.getAttribute('alt') ?? '').trim();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const control = el as HTMLInputElement;
    return (control.value ?? '').trim();
  }
  const content = el.getAttribute('content');
  if (content !== null && content.trim().length > 0) return content.trim();
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** First non-empty capture value across an ordered selector list. */
export function captureText(doc: Document, selectors: readonly string[]): string {
  for (const selector of selectors) {
    for (const el of safeQueryAll(doc, selector)) {
      const value = readCaptureValue(el);
      if (value.length > 0) return value;
    }
  }
  return '';
}

/** Normalised visible text of a control, used when a step button can only be found by its label. */
export function controlLabel(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria !== null && aria.trim().length > 0) return aria.replace(/\s+/g, ' ').trim();
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const input = el as HTMLInputElement;
    if (input.value.trim().length > 0) return input.value.replace(/\s+/g, ' ').trim();
  }
  const title = el.getAttribute('title');
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text.length > 0) return text;
  return title === null ? '' : title.replace(/\s+/g, ' ').trim();
}

/**
 * Locate a control by its visible label.
 *
 * INV-1: located and returned for highlighting, never clicked.
 */
export function findControlByText(doc: Document, pattern: RegExp): HTMLElement | null {
  for (const el of safeQueryAll(doc, CONTROL_SELECTOR)) {
    if (pattern.test(controlLabel(el))) return el;
  }
  return null;
}

/** True when the hostname is, or is a subdomain of, any of `domains`. */
export function hostMatches(url: URL, domains: readonly string[]): boolean {
  const host = url.hostname.toLowerCase();
  return domains.some((domain) => {
    const needle = domain.toLowerCase();
    return host === needle || host.endsWith('.' + needle);
  });
}

/**
 * Match a URL against a confirmation pattern list.
 *
 * `re:<source>` compiles as a case-insensitive regular expression; anything else is a plain
 * case-insensitive substring test against the full href.
 */
export function urlMatchesPattern(url: URL | string, pattern: string): boolean {
  const href = (typeof url === 'string' ? url : url.href).toLowerCase();
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.toLowerCase().startsWith('re:')) {
    try {
      return new RegExp(trimmed.slice(3), 'i').test(href);
    } catch {
      return false;
    }
  }
  return href.includes(trimmed.toLowerCase());
}

/** True when any pattern in the list matches. */
export function urlMatchesAny(url: URL | string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => urlMatchesPattern(url, pattern));
}
