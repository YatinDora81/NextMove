/**
 * core/adapters/greenhouse.ts — JF-001 Rev 3.0 SEC 6.5, Greenhouse row.
 *
 *   Fingerprint : `boards.greenhouse.io` / `job-boards.greenhouse.io` · `#application_form`
 *   Quirks      : stable ids (`#first_name`…); EEO section selects; one attachment input per
 *                 document type. The easy win — built first.
 *
 * Two generations of the board are live at once and JobFill supports both:
 *   - classic  `boards.greenhouse.io/<company>/jobs/<id>` — Rails ids (`#first_name`, `#resume`,
 *     `#job_application_gender`) inside `#application_form`;
 *   - current  `job-boards.greenhouse.io/<company>/jobs/<id>` — the same fields keyed by `name`
 *     (`input[name="first_name"]`, `select[name="gender"]`).
 * Both spellings are in the map; only one of them exists on any given page.
 *
 * Custom screening questions are `#job_application_answers_attributes_<n>_…`, i.e. positional and
 * unstable, so they are deliberately NOT mapped — the SEC 6.3 heuristics and the Answer Bank
 * (F-17) handle them far better than a selector that means something different on every posting.
 */

import { DERIVED_PATHS, DEFAULT_QUIRKS, matchesAny, hostMatches, queryFirst, readCaptureValue } from './types';
import type { AdapterContext, AtsAdapter, ProfilePath } from './types';

const HOSTS: readonly string[] = ['greenhouse.io', 'greenhouse.com'];

/** Present on a Greenhouse board and on the `#grnhse_app` embed dropped into company sites. */
const FINGERPRINTS: readonly string[] = [
  '#application_form',
  '#grnhse_app',
  '#grnhse_iframe',
  'form[action*="greenhouse.io"]',
];

export const greenhouseAdapter: AtsAdapter = {
  id: 'greenhouse',

  detect({ url, doc }: AdapterContext): boolean {
    return hostMatches(url, HOSTS) || matchesAny(doc, FINGERPRINTS);
  },

  fieldMap(): Record<string, ProfilePath> {
    return {
      // --- identity (classic Rails ids, then the job-boards name attributes) ----------------
      '#first_name': 'personal.firstName',
      'input[name="first_name"]': 'personal.firstName',
      'input[name="job_application[first_name]"]': 'personal.firstName',

      '#last_name': 'personal.lastName',
      'input[name="last_name"]': 'personal.lastName',
      'input[name="job_application[last_name]"]': 'personal.lastName',

      '#email': 'personal.email',
      'input[name="email"]': 'personal.email',
      'input[name="job_application[email]"]': 'personal.email',

      '#phone': 'personal.phone',
      'input[name="phone"]': 'personal.phone',
      'input[name="job_application[phone]"]': 'personal.phone',

      // --- location -------------------------------------------------------------------------
      // Greenhouse ships a single free-text "Location (City)" typeahead, not a split address.
      '#job_application_location': 'personal.address.city',
      'input[name="job_application[location]"]': 'personal.address.city',
      'input[name="location"]': 'personal.address.city',
      '#candidate-location': 'personal.address.city',
      '#auto_complete_input': 'personal.address.city',

      // --- attachments (one input per document type) ------------------------------------------
      '#resume_fieldset input[type="file"]': DERIVED_PATHS.resume,
      'input#resume[type="file"]': DERIVED_PATHS.resume,
      'input[type="file"][name="resume"]': DERIVED_PATHS.resume,
      'input[type="file"][name="job_application[resume]"]': DERIVED_PATHS.resume,
      '#s3_upload_for_resume input[type="file"]': DERIVED_PATHS.resume,

      '#cover_letter_fieldset input[type="file"]': DERIVED_PATHS.coverLetter,
      'input#cover_letter[type="file"]': DERIVED_PATHS.coverLetter,
      'input[type="file"][name="cover_letter"]': DERIVED_PATHS.coverLetter,
      'input[type="file"][name="job_application[cover_letter]"]': DERIVED_PATHS.coverLetter,
      '#s3_upload_for_cover_letter input[type="file"]': DERIVED_PATHS.coverLetter,

      // --- EEO section selects -----------------------------------------------------------------
      '#job_application_gender': 'eeo.gender',
      'select[name="job_application[gender]"]': 'eeo.gender',
      'select[name="gender"]': 'eeo.gender',

      '#job_application_race': 'eeo.ethnicity',
      'select[name="job_application[race]"]': 'eeo.ethnicity',
      'select[name="race"]': 'eeo.ethnicity',
      '#job_application_hispanic_ethnicity': 'eeo.ethnicity',
      'select[name="hispanic_ethnicity"]': 'eeo.ethnicity',

      '#job_application_veteran_status': 'eeo.veteran',
      'select[name="job_application[veteran_status]"]': 'eeo.veteran',
      'select[name="veteran_status"]': 'eeo.veteran',

      '#job_application_disability_status': 'eeo.disability',
      'select[name="job_application[disability_status]"]': 'eeo.disability',
      'select[name="disability_status"]': 'eeo.disability',
    };
  },

  quirks: {
    dateFormat: 'MM/DD/YYYY',
    typeaheadDelayMs: 40,
    listboxWaitMs: 2_500,
    stepContainerSelector: '#application_form',
    dropzoneSelectors: [
      '#resume_fieldset .dropzone',
      '#cover_letter_fieldset .dropzone',
      '#s3_upload_for_resume',
      '#s3_upload_for_cover_letter',
      '[data-testid="resume-drop-zone"]',
      '[class*="file-upload" i][class*="drop" i]',
    ],
    // INV-1: located and highlighted, never clicked.
    submitSelectors: [
      '#submit_app',
      '#btn-submit',
      'input[type="submit"][value*="Submit" i]',
      'button[type="submit"]',
      'button[data-testid="submit-application"]',
      ...DEFAULT_QUIRKS.submitSelectors,
    ],
  },

  capture: {
    company: [
      '#header .company-name',
      '.company-name',
      '.job__company',
      '[data-testid="company-name"]',
      'meta[property="og:site_name"]',
      '#logo img',
    ],
    role: [
      'h1.app-title',
      '.app-title',
      '.job__title h1',
      '[data-testid="job-title"]',
      '#header h1',
    ],
  },

  /** INV-1: observed only — Greenhouse renders this itself after the human presses Submit. */
  confirmation: {
    urlPatterns: [
      'application_confirmation',
      '/confirmation',
      '/thank-you',
      're:gh_src=[^&]*&?.*(confirm|thank)',
    ],
    selectors: [
      '#application_confirmation',
      '.application-confirmation',
      '[data-testid="application-confirmation"]',
      '#confirmation_message',
    ],
  },

  steps: {
    /** Greenhouse is a single-page form: there is never more than one step. */
    isStepPage(): boolean {
      return false;
    },

    currentStep(doc: Document): string {
      return readCaptureValue(queryFirst(doc, ['h1.app-title', '.app-title', '#header h1']));
    },

    /**
     * Greenhouse has no "next"; the only forward control is Submit.
     *
     * INV-1: located and highlighted, NEVER clicked. The review overlay (F-06) points the human
     * at it and the human presses it.
     */
    nextButton(doc: Document): HTMLElement | null {
      return queryFirst(doc, [
        '#submit_app',
        '#btn-submit',
        '#application_form input[type="submit"]',
        '#application_form button[type="submit"]',
        'button[data-testid="submit-application"]',
      ]);
    },
  },
};

export default greenhouseAdapter;
