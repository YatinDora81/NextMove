/**
 * core/adapters/smartrecruiters.ts — JF-001 Rev 3.0 SEC 6.5, "SmartRecruiters" (F-07 V1 set).
 *
 *   Fingerprint : `jobs.smartrecruiters.com` / `careers.smartrecruiters.com` · `#st-app`
 *   Quirks      : modern SPA form; camelCase ids that survive re-renders; `data-test` hooks the
 *                 vendor ships for its own e2e suite and therefore keeps stable.
 *
 * The apply widget is also embedded on customer domains (`careers.acme.com` proxying
 * `smartrecruiters.com`), so detection combines the host check with the widget fingerprints.
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

const HOSTS: readonly string[] = ['smartrecruiters.com'];

const FINGERPRINTS: readonly string[] = [
  '#st-app',
  '[data-test="job-title"]',
  '.js-application-form',
  'form[action*="smartrecruiters.com"]',
  'script[src*="smartrecruiters.com"]',
];

export const smartRecruitersAdapter: AtsAdapter = {
  id: 'smartrecruiters',

  detect({ url, doc }: AdapterContext): boolean {
    return hostMatches(url, HOSTS) || matchesAny(doc, FINGERPRINTS);
  },

  fieldMap(): Record<string, ProfilePath> {
    return {
      // --- identity ---------------------------------------------------------------------------
      '#firstName': 'personal.firstName',
      'input[name="firstName"]': 'personal.firstName',
      '[data-test="first-name-input"]': 'personal.firstName',

      '#lastName': 'personal.lastName',
      'input[name="lastName"]': 'personal.lastName',
      '[data-test="last-name-input"]': 'personal.lastName',

      '#email': 'personal.email',
      'input[name="email"]': 'personal.email',
      '[data-test="email-input"]': 'personal.email',

      '#phoneNumber': 'personal.phone',
      'input[name="phoneNumber"]': 'personal.phone',
      '[data-test="phone-input"]': 'personal.phone',

      // --- location (single typeahead, like Greenhouse) -----------------------------------------
      '#location-input': 'personal.address.city',
      '#candidate-location': 'personal.address.city',
      'input[name="location"]': 'personal.address.city',
      '[data-test="location-input"]': 'personal.address.city',
      'input[name="city"]': 'personal.address.city',
      'input[name="postalCode"]': 'personal.address.postalCode',
      'select[name="country"]': 'personal.address.country',

      // --- links -------------------------------------------------------------------------------
      '#linkedinProfileUrl': 'links.linkedin',
      'input[name="linkedinProfileUrl"]': 'links.linkedin',
      '#web-profile-linkedin': 'links.linkedin',
      '#personalWebsiteUrl': 'links.portfolio',
      'input[name="personalWebsiteUrl"]': 'links.portfolio',

      // --- attachments -------------------------------------------------------------------------
      'input[type="file"][name="resume"]': DERIVED_PATHS.resume,
      '#resume-upload input[type="file"]': DERIVED_PATHS.resume,
      '[data-test="resume-upload-input"]': DERIVED_PATHS.resume,
      'input[type="file"][name="coverLetter"]': DERIVED_PATHS.coverLetter,
      '[data-test="cover-letter-upload-input"]': DERIVED_PATHS.coverLetter,
    };
  },

  quirks: {
    dateFormat: 'DD/MM/YYYY',
    typeaheadDelayMs: 45,
    listboxWaitMs: 2_500,
    stepContainerSelector: '#application-form',
    dropzoneSelectors: [
      '[data-test="resume-dropzone"]',
      '#resume-dropzone',
      '.file-upload-dropzone',
      '.js-file-upload',
    ],
    // INV-1: located and highlighted, never clicked.
    submitSelectors: [
      '[data-test="submit-application"]',
      '#submit-application',
      '.js-submit-application',
      'button[type="submit"]',
      ...DEFAULT_QUIRKS.submitSelectors,
    ],
  },

  capture: {
    company: [
      '[data-test="company-name"]',
      '.company-name',
      '.js-company-name',
      'meta[property="og:site_name"]',
      '.header-logo img',
    ],
    role: [
      '[data-test="job-title"]',
      'h1.job-title',
      '.job-title',
      'meta[property="og:title"]',
    ],
  },

  /** INV-1: observed only. SmartRecruiters swaps in its own confirmation view after submission. */
  confirmation: {
    urlPatterns: ['/thank-you', '/confirmation', 'application-submitted', '/applied'],
    selectors: [
      '[data-test="application-submitted"]',
      '.application-confirmation',
      '.thank-you',
      '.js-application-success',
    ],
  },

  steps: {
    /** SmartRecruiters renders one page; "Personal information / Documents" are sections, not steps. */
    isStepPage(): boolean {
      return false;
    },

    currentStep(doc: Document): string {
      return readCaptureValue(queryFirst(doc, ['[data-test="job-title"]', 'h1.job-title', '.job-title']));
    },

    /**
     * The only forward control is Submit.
     *
     * INV-1: located and highlighted, NEVER clicked.
     */
    nextButton(doc: Document): HTMLElement | null {
      return queryFirst(doc, [
        '[data-test="submit-application"]',
        '#submit-application',
        '.js-submit-application',
        '#application-form button[type="submit"]',
      ]);
    },
  },
};

export default smartRecruitersAdapter;
