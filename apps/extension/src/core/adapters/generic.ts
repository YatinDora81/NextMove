/**
 * core/adapters/generic.ts — the universal fallback (JF-001 Rev 3.0 SEC 6.5, "Generic" row).
 *
 * `detect()` is always true and it is registered LAST, so it only ever runs when none of the seven
 * dedicated adapters fingerprinted the page. It ships an empty field map on purpose: a generic
 * selector that scored 98 ("adapter map hit") would out-rank the autocomplete attribute and the
 * label synonyms, which are far better evidence on an unknown page. The generic adapter therefore
 * contributes *quirks, capture and confirmation* only, and lets the SEC 6.3 heuristics do the
 * matching. That is the reason JobFill works on the long tail of hand-rolled career pages.
 *
 * Its `capture` / `confirmation` blocks are also layered underneath every other adapter by the
 * registry, so a globally-useful selector can be hot-fixed once from the CDN (F-14).
 */

import {
  DEFAULT_QUIRKS,
  NEXT_TEXT_PATTERN,
  SUBMIT_TEXT_PATTERN,
  findControlByText,
  matchesAny,
  queryFirst,
  readCaptureValue,
} from './types';
import type { AtsAdapter, ProfilePath } from './types';

/** Stepper fingerprints shared by most hand-rolled multi-page forms. */
const STEPPER_SELECTORS: readonly string[] = [
  '[role="progressbar"]',
  '[class*="stepper" i]',
  '[class*="step-indicator" i]',
  '[class*="progress-bar" i]',
  '[data-testid*="stepper" i]',
  'ol[class*="steps" i]',
  'ul[class*="steps" i]',
];

/** Where the "you are here" marker usually lives inside a stepper. */
const ACTIVE_STEP_SELECTORS: readonly string[] = [
  '[aria-current="step"]',
  '[role="progressbar"] [aria-selected="true"]',
  '[class*="step" i][class*="active" i]',
  '[class*="step" i][class*="current" i]',
  '[class*="stepper" i] .active',
];

export const genericAdapter: AtsAdapter = {
  id: 'generic',

  /** Always true — this is the floor of the detection chain (SEC 6.5). */
  detect(): boolean {
    return true;
  },

  /**
   * Deliberately empty. See the module comment: on an unknown page the heuristic tiers are better
   * evidence than any selector we could guess, and an adapter hit would out-score all of them.
   */
  fieldMap(): Record<string, ProfilePath> {
    return {};
  },

  quirks: {
    ...DEFAULT_QUIRKS,
    dropzoneSelectors: [...DEFAULT_QUIRKS.dropzoneSelectors],
    // INV-1: excluded from the fill set, located and highlighted only — never clicked.
    submitSelectors: [
      ...DEFAULT_QUIRKS.submitSelectors,
      'button[id*="apply" i][type="submit"]',
      'button[class*="next" i]',
      'button[id*="next" i]',
      '[role="button"][class*="next" i]',
    ],
  },

  capture: {
    company: [
      'meta[property="og:site_name"]',
      '[itemprop="hiringOrganization"] [itemprop="name"]',
      '[itemprop="hiringOrganization"]',
      '[data-testid*="company" i]',
      '[class*="company-name" i]',
      '[class*="employer-name" i]',
      'header [class*="logo" i] img',
    ],
    role: [
      '[itemprop="title"]',
      '[data-testid*="job-title" i]',
      '[class*="job-title" i]',
      '[class*="posting-title" i]',
      'meta[property="og:title"]',
      'h1',
    ],
  },

  /** INV-1: observed only. Seeing one of these flips a tracker row draft → applied (SEC 6.7). */
  confirmation: {
    urlPatterns: [
      'thank-you',
      'thankyou',
      '/thanks',
      'confirmation',
      'application-received',
      'application-submitted',
      'applicationsubmitted',
      're:/apply\\/(complete|success|done)/',
    ],
    selectors: [
      '[class*="thank-you" i]',
      '[class*="thankyou" i]',
      '[class*="application-confirmation" i]',
      '[class*="application-complete" i]',
      '[id*="confirmation" i]',
      '[data-testid*="application-submitted" i]',
    ],
  },

  steps: {
    isStepPage(doc: Document): boolean {
      return matchesAny(doc, STEPPER_SELECTORS);
    },

    currentStep(doc: Document): string {
      const active = queryFirst(doc, ACTIVE_STEP_SELECTORS);
      const label = readCaptureValue(active);
      if (label.length > 0) return label;
      const heading = queryFirst(doc, ['form h1', 'form h2', 'main h1', 'h1']);
      return readCaptureValue(heading);
    },

    /**
     * Locates the control that would advance or submit this form.
     *
     * INV-1: located and highlighted, NEVER clicked. On a single-page form there is no "next", so
     * the submit control is returned instead — the review overlay (F-06) points at it and the
     * human presses it.
     */
    nextButton(doc: Document): HTMLElement | null {
      return (
        findControlByText(doc, NEXT_TEXT_PATTERN) ??
        findControlByText(doc, SUBMIT_TEXT_PATTERN) ??
        queryFirst(doc, ['button[type="submit"]', 'input[type="submit"]'])
      );
    },
  },
};

export default genericAdapter;
