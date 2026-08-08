/**
 * core/adapters/ashby.ts — JF-001 Rev 3.0 SEC 6.5, "Ashby" (F-07 V1 adapter set).
 *
 *   Fingerprint : `jobs.ashbyhq.com` · the `#ashby_embed` / `ashby-application-form-*` widget
 *   Quirks      : modern SPA form — no page reloads, no wizard; class names are CSS-module hashes
 *                 (`_container_xyz12`) and are therefore never used as selectors.
 *
 * Ashby names its built-in fields `_systemfield_<name>` and gives them a matching `id`; everything
 * the recruiter added is a uuid (`input[name="a1b2c3d4-…"]`) and is left to the SEC 6.3 heuristics
 * and the Answer Bank. The embed also runs on customer domains, so detection cannot rely on host
 * alone.
 */

import {
  DEFAULT_QUIRKS,
  DERIVED_PATHS,
  hostMatches,
  matchesAny,
  queryFirst,
  readCaptureValue,
} from './types';
import type { AdapterContext, AtsAdapter, ProfilePath } from './types';

const HOSTS: readonly string[] = ['ashbyhq.com', 'jobs.ashbyhq.com'];

const FINGERPRINTS: readonly string[] = [
  '#ashby_embed',
  '#ashby-application-form-container',
  '.ashby-application-form-container',
  '.ashby-job-posting-brief',
  'input[name="_systemfield_name"]',
  'script[src*="ashbyhq.com"]',
  'form[action*="ashbyhq.com"]',
];

export const ashbyAdapter: AtsAdapter = {
  id: 'ashby',

  detect({ url, doc }: AdapterContext): boolean {
    return hostMatches(url, HOSTS) || matchesAny(doc, FINGERPRINTS);
  },

  fieldMap(): Record<string, ProfilePath> {
    return {
      // --- identity (Ashby asks for one combined name — see DERIVED_PATHS.fullName) -------------
      'input[name="_systemfield_name"]': DERIVED_PATHS.fullName,
      '#_systemfield_name': DERIVED_PATHS.fullName,

      'input[name="_systemfield_email"]': 'personal.email',
      '#_systemfield_email': 'personal.email',

      'input[name="_systemfield_phone"]': 'personal.phone',
      '#_systemfield_phone': 'personal.phone',

      'input[name="_systemfield_location"]': 'personal.address.city',
      '#_systemfield_location': 'personal.address.city',
      'input[name="_systemfield_location_city"]': 'personal.address.city',
      'input[name="_systemfield_location_country"]': 'personal.address.country',

      // --- links --------------------------------------------------------------------------------
      'input[name="_systemfield_linkedin"]': 'links.linkedin',
      'input[name="_systemfield_github"]': 'links.github',
      'input[name="_systemfield_website"]': 'links.portfolio',

      // --- attachments ---------------------------------------------------------------------------
      'input[name="_systemfield_resume"]': DERIVED_PATHS.resume,
      '#_systemfield_resume': DERIVED_PATHS.resume,
      'input[type="file"][name="_systemfield_resume"]': DERIVED_PATHS.resume,
      'input[name="_systemfield_coverLetter"]': DERIVED_PATHS.coverLetter,
      'input[type="file"][name="_systemfield_coverLetter"]': DERIVED_PATHS.coverLetter,
    };
  },

  quirks: {
    dateFormat: 'MM/DD/YYYY',
    typeaheadDelayMs: 45,
    listboxWaitMs: 2_500,
    stepContainerSelector: '.ashby-application-form-container',
    dropzoneSelectors: [
      '.ashby-application-form-file-upload',
      '[data-testid="file-upload-dropzone"]',
      '[class*="_dropzone" i]',
      '[class*="_fileUpload" i]',
    ],
    // INV-1: located and highlighted, never clicked.
    submitSelectors: [
      '.ashby-application-form-submit-button',
      '[data-testid="submit-application"]',
      '.ashby-application-form-container button[type="submit"]',
      'button[type="submit"]',
      ...DEFAULT_QUIRKS.submitSelectors,
    ],
  },

  capture: {
    company: [
      '.ashby-job-posting-organization-name',
      '.ashby-header-logo img',
      '[class*="_organizationName" i]',
      'meta[property="og:site_name"]',
    ],
    role: [
      '.ashby-job-posting-heading',
      '[data-testid="job-posting-title"]',
      '.ashby-job-posting-brief h1',
      'meta[property="og:title"]',
    ],
  },

  /** INV-1: observed only — the SPA swaps to this state after the human presses Submit. */
  confirmation: {
    urlPatterns: ['/application/confirmation', '/confirmation', 'thank', 'submitted'],
    selectors: [
      '[data-testid="application-submitted"]',
      '.ashby-application-form-success',
      '.ashby-application-confirmation',
      '[class*="_successMessage" i]',
    ],
  },

  steps: {
    /** Ashby renders the whole application in one page — there is no wizard. */
    isStepPage(): boolean {
      return false;
    },

    currentStep(doc: Document): string {
      return readCaptureValue(
        queryFirst(doc, ['.ashby-job-posting-heading', '[data-testid="job-posting-title"]']),
      );
    },

    /**
     * Ashby's only forward control is Submit.
     *
     * INV-1: located and highlighted, NEVER clicked.
     */
    nextButton(doc: Document): HTMLElement | null {
      return queryFirst(doc, [
        '.ashby-application-form-submit-button',
        '[data-testid="submit-application"]',
        '.ashby-application-form-container button[type="submit"]',
      ]);
    },
  },
};

export default ashbyAdapter;
