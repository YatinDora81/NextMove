/**
 * core/adapters/workday.ts — JF-001 Rev 3.0 SEC 6.5, Workday row.
 *
 *   Fingerprint : `*.myworkdayjobs.com` · `[data-automation-id]`
 *   Quirks      : multi-step wizard; ids are dynamic but `data-automation-id` is stable — the
 *                 ENTIRE field map keys off it; aggressive typeaheads;
 *                 "My Information / My Experience / Application Questions" step model;
 *                 per-tenant variance ⇒ remote config per tenant slug.
 *
 * Nothing in this file may reference an `id`, a class name, or a DOM position. Workday re-renders
 * its React tree with generated ids on every navigation; `data-automation-id` is the only contract
 * Workday itself keeps stable, which is exactly why SEC 6.5 pins the adapter to it.
 *
 * Per-tenant variance is handled by `configKeys()`: `nvidia.wd5.myworkdayjobs.com` resolves the
 * remote-config layers `workday` then `workday:nvidia`, so one tenant can be hot-fixed from the
 * CDN (F-14) without disturbing the shared block.
 */

import {
  DEFAULT_QUIRKS,
  DERIVED_PATHS,
  hostMatches,
  matchesAny,
  queryFirst,
  readCaptureValue,
  safeQueryAll,
} from './types';
import type { AdapterContext, AtsAdapter, ProfilePath } from './types';

const HOSTS: readonly string[] = ['myworkdayjobs.com', 'myworkdaysite.com', 'wd1.myworkdayjobs.com'];

const FINGERPRINTS: readonly string[] = [
  '[data-automation-id="jobPostingHeader"]',
  '[data-automation-id="applyFlowPage"]',
  '[data-automation-id="jobApplicationPage"]',
  '[data-automation-id="legalNameSection_firstName"]',
  '[data-automation-id="wd-CandidateHomeVerticalNavigation"]',
  'div[data-automation-id][data-metadata-id]',
];

/** Data-centre labels Workday puts in front of the tenant slug (`wd1` … `wd103`). */
const DATA_CENTRE_LABEL = /^wd\d+$/i;

/**
 * The tenant slug for a Workday URL, or `''` when it cannot be determined.
 *
 * `nvidia.wd5.myworkdayjobs.com` → `nvidia`; `wd3.myworkdaysite.com` → `''`. Exported because the
 * registry uses it to build the `workday:<tenant>` remote-config layer (SEC 6.5, per-tenant row).
 */
export function workdayTenantSlug(url: URL): string {
  const labels = url.hostname.toLowerCase().split('.');
  for (const label of labels) {
    if (label.length === 0) continue;
    if (label === 'www') continue;
    if (DATA_CENTRE_LABEL.test(label)) continue;
    if (label === 'myworkdayjobs' || label === 'myworkdaysite' || label === 'com') return '';
    return label;
  }
  return '';
}

/**
 * The SEC 6.5 step model. Workday localises and re-words these, so matching is by keyword rather
 * than by equality, and an unrecognised label is returned verbatim instead of being forced.
 */
const STEP_KEYWORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/my\s*information|contact\s*information|personal\s*information/i, 'My Information'],
  [/my\s*experience|work\s*experience|resume|education/i, 'My Experience'],
  [/application\s*questions?|questionnaire|screening/i, 'Application Questions'],
  [/voluntary\s*disclosur/i, 'Voluntary Disclosures'],
  [/self[\s-]*identif/i, 'Self Identify'],
  [/review|summary/i, 'Review'],
];

function normaliseStep(raw: string): string {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) return '';
  for (const entry of STEP_KEYWORDS) {
    if (entry[0].test(trimmed)) return entry[1];
  }
  return trimmed;
}

export const workdayAdapter: AtsAdapter = {
  id: 'workday',

  detect({ url, doc }: AdapterContext): boolean {
    return hostMatches(url, HOSTS) || matchesAny(doc, FINGERPRINTS);
  },

  /** SEC 6.5: the entire field map keys off `data-automation-id`. No ids, no classes, ever. */
  fieldMap(): Record<string, ProfilePath> {
    return {
      // --- My Information · legal name ---------------------------------------------------------
      '[data-automation-id="legalNameSection_firstName"]': 'personal.firstName',
      '[data-automation-id="legalNameSection_lastName"]': 'personal.lastName',
      '[data-automation-id="firstName"]': 'personal.firstName',
      '[data-automation-id="lastName"]': 'personal.lastName',

      // --- My Information · contact ------------------------------------------------------------
      '[data-automation-id="email"]': 'personal.email',
      '[data-automation-id="userName"]': 'personal.email',
      '[data-automation-id="phone-number"]': 'personal.phone',
      '[data-automation-id="phoneNumber"]': 'personal.phone',

      // --- My Information · address ------------------------------------------------------------
      '[data-automation-id="addressSection_addressLine1"]': 'personal.address.line1',
      '[data-automation-id="addressSection_addressLine2"]': 'personal.address.line2',
      '[data-automation-id="addressSection_city"]': 'personal.address.city',
      '[data-automation-id="addressSection_countryRegion"]': 'personal.address.state',
      '[data-automation-id="addressSection_postalCode"]': 'personal.address.postalCode',
      '[data-automation-id="countryDropdown"]': 'personal.address.country',
      '[data-automation-id="country"]': 'personal.address.country',

      // --- My Experience · most recent role ----------------------------------------------------
      '[data-automation-id="jobTitle"]': 'work[0].title',
      '[data-automation-id="company"]': 'work[0].company',
      '[data-automation-id="location"]': 'work[0].location',
      '[data-automation-id="roleDescription"]': 'work[0].bullets[0]',

      // --- My Experience · education -----------------------------------------------------------
      '[data-automation-id="school"]': 'education[0].school',
      '[data-automation-id="degree"]': 'education[0].degree',
      '[data-automation-id="fieldOfStudy"]': 'education[0].field',
      '[data-automation-id="formField-fieldOfStudy"]': 'education[0].field',
      '[data-automation-id="gpa"]': 'education[0].gpa',

      // --- My Experience · skills, links, resume -----------------------------------------------
      '[data-automation-id="formField-skills"]': 'skills[0]',
      '[data-automation-id="linkedinQuestion"]': 'links.linkedin',
      '[data-automation-id="linkedInQuestion"]': 'links.linkedin',
      '[data-automation-id="website"]': 'links.portfolio',
      '[data-automation-id="websiteUrl"]': 'links.portfolio',
      '[data-automation-id="file-upload-input-ref"]': DERIVED_PATHS.resume,
      '[data-automation-id="resumeUpload"] input[type="file"]': DERIVED_PATHS.resume,

      // --- Voluntary Disclosures / Self Identify -----------------------------------------------
      '[data-automation-id="gender"]': 'eeo.gender',
      '[data-automation-id="genderDropdown"]': 'eeo.gender',
      '[data-automation-id="ethnicityDropdown"]': 'eeo.ethnicity',
      '[data-automation-id="hispanicOrLatino"]': 'eeo.ethnicity',
      '[data-automation-id="veteranStatus"]': 'eeo.veteran',
      '[data-automation-id="veteranStatusDropdown"]': 'eeo.veteran',
      '[data-automation-id="disability"]': 'eeo.disability',
      '[data-automation-id="selfIdentifiedDisabilityData--disabilityStatus"]': 'eeo.disability',
    };
  },

  quirks: {
    dateFormat: 'MM/DD/YYYY',
    // Workday's typeaheads are aggressive: they re-query on every keystroke and discard the
    // listbox if characters arrive too fast (SEC 6.5, Workday row).
    typeaheadDelayMs: 60,
    listboxWaitMs: 3_000,
    stepContainerSelector: '[data-automation-id="applyFlowPage"]',
    dropzoneSelectors: [
      '[data-automation-id="quickApplyDropZone"]',
      '[data-automation-id="fileUploadDropZone"]',
      '[data-automation-id="select-files"]',
      '[data-automation-id="resumeUpload"]',
      '[data-automation-id="attachments"]',
    ],
    // INV-1: located and highlighted, never clicked. The wizard's "Next" is as untouchable as
    // its "Submit" — advancing a step is the human's decision.
    submitSelectors: [
      '[data-automation-id="bottom-navigation-next-button"]',
      '[data-automation-id="bottom-navigation-submit-button"]',
      '[data-automation-id="pageFooterNextButton"]',
      '[data-automation-id="wd-CommandButton_uic_saveAndContinueButton"]',
      '[data-automation-id="quickApplySubmitButton"]',
      ...DEFAULT_QUIRKS.submitSelectors,
    ],
  },

  capture: {
    company: [
      '[data-automation-id="companyName"]',
      '[data-automation-id="brandingHeader"] img',
      '[data-automation-id="logo"] img',
      'meta[property="og:site_name"]',
      'header img',
    ],
    role: [
      '[data-automation-id="jobPostingHeader"]',
      'h2[data-automation-id="jobPostingHeader"]',
      '[data-automation-id="jobPostingTitle"]',
      'meta[property="og:title"]',
    ],
  },

  /** INV-1: observed only — the wizard reaches these states because the human pressed Submit. */
  confirmation: {
    urlPatterns: ['/thankyou', '/thank-you', '/applications', 'submitted', 'applicationsubmitted'],
    selectors: [
      '[data-automation-id="thankYouPage"]',
      '[data-automation-id="applicationSubmitted"]',
      '[data-automation-id="successBanner"]',
      '[data-automation-id="myApplicationsHeader"]',
    ],
  },

  steps: {
    isStepPage(doc: Document): boolean {
      return matchesAny(doc, [
        '[data-automation-id="progressBar"]',
        '[data-automation-id="applyFlowPage"]',
        '[data-automation-id="jobApplicationPage"]',
        '[data-automation-id="bottom-navigation-next-button"]',
      ]);
    },

    /**
     * The SEC 6.5 step model: "My Information / My Experience / Application Questions"
     * (+ Voluntary Disclosures / Self Identify / Review, which every tenant enables differently).
     */
    currentStep(doc: Document): string {
      const active = queryFirst(doc, [
        '[data-automation-id="progressBarActiveStep"]',
        '[data-automation-id="progressBar"] [aria-current="step"]',
        '[data-automation-id="progressBar"] [data-automation-id="activeStep"]',
      ]);
      const fromBar = normaliseStep(readCaptureValue(active));
      if (fromBar.length > 0) return fromBar;

      const heading = queryFirst(doc, [
        '[data-automation-id="pageHeader"]',
        '[data-automation-id="applyFlowPage"] h2',
        '[data-automation-id="jobApplicationPage"] h2',
      ]);
      const fromHeading = normaliseStep(readCaptureValue(heading));
      if (fromHeading.length > 0) return fromHeading;

      // Last resort: the progress bar's own selected list item.
      for (const step of safeQueryAll(doc, '[data-automation-id="progressBar"] li')) {
        if (step.getAttribute('aria-current') === 'step' || step.getAttribute('aria-selected') === 'true') {
          return normaliseStep(readCaptureValue(step));
        }
      }
      return '';
    },

    /**
     * Locates the wizard's forward control.
     *
     * INV-1: located and highlighted, NEVER clicked. Workday's "Next" advances a step and can
     * commit a page of answers, so it is treated exactly like a submit button.
     */
    nextButton(doc: Document): HTMLElement | null {
      return queryFirst(doc, [
        '[data-automation-id="bottom-navigation-next-button"]',
        '[data-automation-id="pageFooterNextButton"]',
        '[data-automation-id="wd-CommandButton_uic_saveAndContinueButton"]',
        '[data-automation-id="bottom-navigation-submit-button"]',
      ]);
    },
  },

  /** SEC 6.5: per-tenant variance ⇒ remote config keyed on the tenant slug. */
  configKeys(url: URL): readonly string[] {
    const tenant = workdayTenantSlug(url);
    return tenant.length > 0 ? [`workday:${tenant}`] : [];
  },
};

export default workdayAdapter;
