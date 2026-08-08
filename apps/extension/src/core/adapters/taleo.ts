/**
 * core/adapters/taleo.ts — JF-001 Rev 3.0 SEC 6.5, "iCIMS / Taleo" row.
 *
 *   Fingerprint : `taleo.net` (`tbe.taleo.net`, `<tenant>.taleo.net/careersection/…`)
 *   Quirks      : legacy iframe soup — the scanner must merge child-frame results; Taleo posts
 *                 FULL-PAGE RELOADS between steps, so the PageObserver re-arms on `load`.
 *
 * Taleo prefixes every generated id with a per-requisition namespace
 * (`requisitionDescriptionInterface.ID1234.row1`, `pageForm:j_id_123:firstName`), so an exact-id
 * selector is worthless. The suffix, however, is stable across tenants — the map below is written
 * with `[id$="…"]` / `[name$="…"]` for that reason. Anything narrower breaks on the next
 * requisition; anything broader starts guessing, which INV-4 forbids at adapter score 98.
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

const HOSTS: readonly string[] = ['taleo.net', 'tbe.taleo.net'];

const FINGERPRINTS: readonly string[] = [
  '#requisitionDescriptionInterface',
  'form[name="dynamicForm"]',
  '#dynamicForm',
  '.careersection',
  'div[id^="requisitionDescriptionInterface"]',
  'iframe[src*="taleo.net"]',
  'form[action*="taleo.net"]',
];

export const taleoAdapter: AtsAdapter = {
  id: 'taleo',

  detect({ url, doc }: AdapterContext): boolean {
    if (hostMatches(url, HOSTS)) return true;
    if (url.pathname.toLowerCase().includes('/careersection/')) return true;
    return matchesAny(doc, FINGERPRINTS);
  },

  fieldMap(): Record<string, ProfilePath> {
    return {
      // --- identity (suffix selectors — the id prefix is per-requisition) -----------------------
      'input[id$=".firstName"]': 'personal.firstName',
      'input[id$=":firstName"]': 'personal.firstName',
      'input[name$="firstName"]': 'personal.firstName',
      '#firstName': 'personal.firstName',

      'input[id$=".lastName"]': 'personal.lastName',
      'input[id$=":lastName"]': 'personal.lastName',
      'input[name$="lastName"]': 'personal.lastName',
      '#lastName': 'personal.lastName',

      'input[id$=".email"]': 'personal.email',
      'input[id$=":email"]': 'personal.email',
      'input[name$="email"]': 'personal.email',
      '#email': 'personal.email',

      'input[id$=".homePhone"]': 'personal.phone',
      'input[id$=".cellPhone"]': 'personal.phone',
      'input[id$=":phoneNumber"]': 'personal.phone',
      'input[name$="phoneNumber"]': 'personal.phone',
      '#phoneNumber': 'personal.phone',

      // --- address -----------------------------------------------------------------------------
      'input[id$=".address"]': 'personal.address.line1',
      'input[id$=".addressLine1"]': 'personal.address.line1',
      'input[id$=".addressLine2"]': 'personal.address.line2',
      'input[id$=".city"]': 'personal.address.city',
      'input[id$=".zipCode"]': 'personal.address.postalCode',
      'input[id$=".postalCode"]': 'personal.address.postalCode',
      'select[id$=".state"]': 'personal.address.state',
      'select[id$=".country"]': 'personal.address.country',

      // --- attachments -------------------------------------------------------------------------
      'input[type="file"][id$="fileUpload"]': DERIVED_PATHS.resume,
      'input[type="file"][id$="fileUploadfileInput"]': DERIVED_PATHS.resume,
      '#fileUploadfileInput': DERIVED_PATHS.resume,
      'input[type="file"][name*="resume" i]': DERIVED_PATHS.resume,
      'input[type="file"][id*="coverLetter" i]': DERIVED_PATHS.coverLetter,

      // --- experience / education (Taleo's "Experience" block) ----------------------------------
      'input[id$=".employer"]': 'work[0].company',
      'input[id$=".jobTitle"]': 'work[0].title',
      'input[id$=".institution"]': 'education[0].school',
      'input[id$=".programme"]': 'education[0].field',
      'select[id$=".educationLevel"]': 'education[0].degree',

      // --- EEO ---------------------------------------------------------------------------------
      'select[id$=".gender"]': 'eeo.gender',
      'select[id$=".ethnicity"]': 'eeo.ethnicity',
      'select[id$=".veteranStatus"]': 'eeo.veteran',
      'select[id$=".disabilityStatus"]': 'eeo.disability',
    };
  },

  quirks: {
    dateFormat: 'MM/DD/YYYY',
    typeaheadDelayMs: 55,
    listboxWaitMs: 3_000,
    stepContainerSelector: '#dynamicForm',
    dropzoneSelectors: ['#fileUploadDropZone', '.fileUploadDropArea', '[class*="dropArea" i]'],
    // INV-1: located and highlighted, never clicked. On Taleo the forward controls POST the form
    // and reload the document, so touching one is indistinguishable from submitting.
    submitSelectors: [
      '#submitButton',
      'a[id$="submitButton"]',
      'input[value="Submit" i]',
      'input[value="Next" i]',
      'a[id$="next"]',
      '#next',
      '#saveAndContinue',
      ...DEFAULT_QUIRKS.submitSelectors,
    ],
  },

  capture: {
    company: [
      '#companyLogo img',
      '.headerLogo img',
      '.careersection-header img',
      'meta[property="og:site_name"]',
    ],
    role: [
      '#requisitionDescriptionInterface\\.reqTitleLinkAction\\.row1',
      '[id$="reqTitleLinkAction.row1"]',
      '.requisitionDescriptionInterface h1',
      '#job-title',
      'meta[property="og:title"]',
    ],
  },

  /** INV-1: observed only, on the document Taleo serves after the human presses Submit. */
  confirmation: {
    urlPatterns: ['applyconfirm', 'thankyou', 'thank-you', 'confirmation', 'jobapplyconfirm'],
    selectors: [
      '#confirmationMessage',
      '.confirmationMessage',
      '#applicationConfirmation',
      '[id$="applyConfirmation"]',
    ],
  },

  steps: {
    isStepPage(doc: Document): boolean {
      return matchesAny(doc, [
        '#dynamicForm',
        '#progressBar',
        '.taleoProgressBar',
        '.progressBarStep',
      ]);
    },

    currentStep(doc: Document): string {
      const active = queryFirst(doc, [
        '#progressBar .selected',
        '.taleoProgressBar .selected',
        '.progressBarStep.currentStep',
        '.currentStep',
        '[aria-current="step"]',
      ]);
      const label = readCaptureValue(active);
      if (label.length > 0) return label;
      return readCaptureValue(queryFirst(doc, ['#dynamicForm h1', '.sectiontitle', 'h1']));
    },

    /**
     * Locates the control that posts the current page and loads the next one.
     *
     * INV-1: located and highlighted, NEVER clicked.
     */
    nextButton(doc: Document): HTMLElement | null {
      return queryFirst(doc, [
        '#next',
        'a[id$="next"]',
        'input[value="Next" i]',
        '#saveAndContinue',
        '#submitButton',
      ]);
    },
  },
};

export default taleoAdapter;
