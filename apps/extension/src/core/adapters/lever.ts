/**
 * core/adapters/lever.ts — JF-001 Rev 3.0 SEC 6.5, Lever row.
 *
 *   Fingerprint : `jobs.lever.co` · `.application-form`
 *   Quirks      : name-attribute driven; cards UI; resume drop-zone variant.
 *
 * Lever keys everything off `name`, and the interesting names are *bracketed*
 * (`urls[LinkedIn]`, `eeo[gender]`, `cards[<uuid>][field0]`). The bracketed URL and EEO names are
 * stable across every Lever posting; the `cards[…]` names embed a per-posting uuid and are
 * therefore left to the SEC 6.3 heuristics.
 *
 * Lever asks for one combined "Full name" field — see `DERIVED_PATHS.fullName`.
 */

import { DEFAULT_QUIRKS, DERIVED_PATHS, hostMatches, matchesAny, queryFirst, readCaptureValue } from './types';
import type { AdapterContext, AtsAdapter, ProfilePath } from './types';

const HOSTS: readonly string[] = ['lever.co', 'hire.lever.co'];

const FINGERPRINTS: readonly string[] = [
  '.application-form',
  '.application-page',
  'form[action*="lever.co"]',
  'div[data-qa="posting"]',
];

export const leverAdapter: AtsAdapter = {
  id: 'lever',

  detect({ url, doc }: AdapterContext): boolean {
    return hostMatches(url, HOSTS) || matchesAny(doc, FINGERPRINTS);
  },

  fieldMap(): Record<string, ProfilePath> {
    return {
      // --- identity ---------------------------------------------------------------------------
      // One combined field; the FillEngine composes firstName + ' ' + lastName (DERIVED_PATHS).
      'input[name="name"]': DERIVED_PATHS.fullName,
      'input[name="email"]': 'personal.email',
      'input[name="phone"]': 'personal.phone',
      'input[name="location"]': 'personal.address.city',
      '#location-input': 'personal.address.city',

      // --- current employer -------------------------------------------------------------------
      'input[name="org"]': 'work[0].company',

      // --- links (bracketed names are stable across every Lever posting) ------------------------
      'input[name="urls[LinkedIn]"]': 'links.linkedin',
      'input[name="urls[Linkedin]"]': 'links.linkedin',
      'input[name="urls[GitHub]"]': 'links.github',
      'input[name="urls[Github]"]': 'links.github',
      'input[name="urls[Portfolio]"]': 'links.portfolio',
      'input[name="urls[Website]"]': 'links.portfolio',
      'input[name="urls[Other]"]': 'links.other[0]',

      // --- resume (input + the drop-zone variant, see `quirks.dropzoneSelectors`) --------------
      'input[type="file"][name="resume"]': DERIVED_PATHS.resume,
      '#resume-upload-input': DERIVED_PATHS.resume,
      '.application-file-input input[type="file"]': DERIVED_PATHS.resume,

      // --- EEO ---------------------------------------------------------------------------------
      'select[name="eeo[gender]"]': 'eeo.gender',
      'input[name="eeo[gender]"]': 'eeo.gender',
      'select[name="eeo[race]"]': 'eeo.ethnicity',
      'input[name="eeo[race]"]': 'eeo.ethnicity',
      'select[name="eeo[veteran]"]': 'eeo.veteran',
      'input[name="eeo[veteran]"]': 'eeo.veteran',
      'select[name="eeo[disability]"]': 'eeo.disability',
      'input[name="eeo[disability]"]': 'eeo.disability',
    };
  },

  quirks: {
    dateFormat: 'MM/DD/YYYY',
    typeaheadDelayMs: 40,
    listboxWaitMs: 2_500,
    stepContainerSelector: '.application-form',
    dropzoneSelectors: [
      '.application-file-input',
      '.resume-upload-dropzone',
      '[data-qa="resume-upload"]',
      '.filename-drop',
      '.application-question .file-upload',
    ],
    // INV-1: located and highlighted, never clicked.
    submitSelectors: [
      '.template-btn-submit',
      'button[data-qa="btn-submit"]',
      '#btn-submit',
      'button[type="submit"]',
      ...DEFAULT_QUIRKS.submitSelectors,
    ],
  },

  capture: {
    company: [
      '.main-header-logo img',
      '.main-header-content .company-name',
      '[data-qa="company-name"]',
      'meta[property="og:site_name"]',
    ],
    role: [
      '.posting-headline h2',
      'h2.posting-headline',
      '[data-qa="posting-name"]',
      '.posting-header h2',
      'meta[property="og:title"]',
    ],
  },

  /** INV-1: observed only. Lever redirects to `…/<posting-id>/thanks` after the human submits. */
  confirmation: {
    urlPatterns: ['/thanks', '/thank-you', '/applied', '/confirmation'],
    selectors: [
      '.application-confirmation',
      '[data-qa="thanks"]',
      '.postings-wrapper .thanks',
      '.thanks-header',
    ],
  },

  steps: {
    /** Lever is a single-page application form. */
    isStepPage(): boolean {
      return false;
    },

    currentStep(doc: Document): string {
      return readCaptureValue(
        queryFirst(doc, ['.posting-headline h2', '[data-qa="posting-name"]', '.posting-header h2']),
      );
    },

    /**
     * Lever has no wizard; the only forward control is Submit.
     *
     * INV-1: located and highlighted, NEVER clicked.
     */
    nextButton(doc: Document): HTMLElement | null {
      return queryFirst(doc, [
        '.template-btn-submit',
        'button[data-qa="btn-submit"]',
        '#btn-submit',
        '.application-form button[type="submit"]',
      ]);
    },
  },
};

export default leverAdapter;
