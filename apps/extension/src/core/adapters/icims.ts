/**
 * core/adapters/icims.ts — JF-001 Rev 3.0 SEC 6.5, "iCIMS / Taleo" row.
 *
 *   Fingerprint : `*.icims.com`
 *   Quirks      : legacy iframe soup — the scanner must merge child-frame results; the portal
 *                 reloads the whole page between steps, so the observer re-arms on `load`.
 *
 * iCIMS renders the actual application inside `#icims_content_iframe`, usually on the *customer's*
 * domain (`careers-acme.icims.com`, or an `<iframe>` embedded in `acme.com/careers`). Two things
 * follow, and both are encoded here rather than in prose:
 *
 *   1. `detect()` must fire on the iframe document too, not just the top frame — hence the
 *      `.iCIMS_*` DOM fingerprints alongside the host check. The extension's content script runs
 *      with `all_frames: true`, and each frame's `FieldSignature.frameId` keeps the results apart.
 *   2. There is no SPA router. Each step is a fresh document, so `steps.currentStep()` reads the
 *      server-rendered progress markup rather than any client state.
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

const HOSTS: readonly string[] = ['icims.com'];

const FINGERPRINTS: readonly string[] = [
  '#icims_content_iframe',
  '.iCIMS_MainWrapper',
  '#icims_mainWrapper',
  '.iCIMS_JobsTable',
  '.iCIMS_ApplyOnline',
  'form[action*="icims.com"]',
  'iframe[src*="icims.com"]',
];

export const icimsAdapter: AtsAdapter = {
  id: 'icims',

  detect({ url, doc }: AdapterContext): boolean {
    return hostMatches(url, HOSTS) || matchesAny(doc, FINGERPRINTS);
  },

  fieldMap(): Record<string, ProfilePath> {
    return {
      // --- identity ---------------------------------------------------------------------------
      '#firstname': 'personal.firstName',
      'input[name="firstname"]': 'personal.firstName',
      'input[id$="_firstname"]': 'personal.firstName',

      '#lastname': 'personal.lastName',
      'input[name="lastname"]': 'personal.lastName',
      'input[id$="_lastname"]': 'personal.lastName',

      // `#middlename` is deliberately unmapped — SEC 7.2 has no middle name and INV-4 forbids
      // guess-filling it from `firstName`.

      '#email': 'personal.email',
      'input[name="email"]': 'personal.email',
      'input[id$="_email"]': 'personal.email',

      '#phone': 'personal.phone',
      'input[name="phone"]': 'personal.phone',
      '#mobilephone': 'personal.phone',
      'input[name="mobilephone"]': 'personal.phone',

      // --- address (iCIMS splits it, unlike Greenhouse/Lever) ------------------------------------
      '#addressstreet': 'personal.address.line1',
      'input[name="addressstreet"]': 'personal.address.line1',
      '#addressstreet2': 'personal.address.line2',
      '#addresscity': 'personal.address.city',
      'input[name="addresscity"]': 'personal.address.city',
      '#addressstate': 'personal.address.state',
      'select[name="addressstate"]': 'personal.address.state',
      '#addresszip': 'personal.address.postalCode',
      'input[name="addresszip"]': 'personal.address.postalCode',
      '#addresscountry': 'personal.address.country',
      'select[name="addresscountry"]': 'personal.address.country',

      // --- links -------------------------------------------------------------------------------
      '#linkedin': 'links.linkedin',
      'input[name="linkedin"]': 'links.linkedin',
      '#website': 'links.portfolio',
      'input[name="website"]': 'links.portfolio',

      // --- attachments -------------------------------------------------------------------------
      '#resume': DERIVED_PATHS.resume,
      'input[type="file"][name="resume"]': DERIVED_PATHS.resume,
      '#icims_upload_file': DERIVED_PATHS.resume,
      'input[type="file"][id*="resume" i]': DERIVED_PATHS.resume,
      'input[type="file"][id*="coverletter" i]': DERIVED_PATHS.coverLetter,

      // --- EEO ---------------------------------------------------------------------------------
      '#gender': 'eeo.gender',
      'select[name="gender"]': 'eeo.gender',
      '#ethnicity': 'eeo.ethnicity',
      'select[name="ethnicity"]': 'eeo.ethnicity',
      '#veteranstatus': 'eeo.veteran',
      'select[name="veteranstatus"]': 'eeo.veteran',
      '#disabilitystatus': 'eeo.disability',
      'select[name="disabilitystatus"]': 'eeo.disability',
    };
  },

  quirks: {
    dateFormat: 'MM/DD/YYYY',
    typeaheadDelayMs: 55,
    listboxWaitMs: 3_000,
    stepContainerSelector: '.iCIMS_MainWrapper',
    dropzoneSelectors: [
      '.iCIMS_FileUpload',
      '#icims_uploadDropZone',
      '.iCIMS_DragDropTarget',
      '[class*="iCIMS" i][class*="upload" i]',
    ],
    // INV-1: located and highlighted, never clicked. iCIMS wires several of these to
    // `onclick="…submit()"`, which is precisely why they are on the never-touch list.
    submitSelectors: [
      '#quickApplyBtn',
      '.iCIMS_Button[type="submit"]',
      'input[type="submit"]',
      'a.iCIMS_Anchor[onclick*="submit" i]',
      'a[id*="submit" i]',
      'input[value="Next" i]',
      'a[title="Next" i]',
      ...DEFAULT_QUIRKS.submitSelectors,
    ],
  },

  capture: {
    company: [
      '.iCIMS_Logo img',
      '#icims_logo img',
      '.iCIMS_HeaderLogo img',
      'meta[property="og:site_name"]',
    ],
    role: [
      '.iCIMS_JobHeader h1',
      '.iCIMS_Header h1',
      '#icims_content h1',
      'h1.iCIMS_Header',
      'meta[property="og:title"]',
    ],
  },

  /** INV-1: observed only. Each iCIMS step is a fresh document, so the observer re-arms on load. */
  confirmation: {
    urlPatterns: ['/thankyou', '/thank-you', 'applicationconfirmation', 'jobs/confirm', '/confirm'],
    selectors: [
      '.iCIMS_ThankYou',
      '#icims_content_thankyou',
      '.iCIMS_ConfirmationMessage',
      '.iCIMS_InfoMsg',
    ],
  },

  steps: {
    isStepPage(doc: Document): boolean {
      return matchesAny(doc, [
        '.iCIMS_Progress',
        '#icims_progressBar',
        '.iCIMS_ProgressBar',
        '.iCIMS_ApplyOnline',
      ]);
    },

    currentStep(doc: Document): string {
      const active = queryFirst(doc, [
        '.iCIMS_Progress .iCIMS_Selected',
        '.iCIMS_ProgressBar .iCIMS_Selected',
        '#icims_progressBar .selected',
        '[aria-current="step"]',
      ]);
      const label = readCaptureValue(active);
      if (label.length > 0) return label;
      return readCaptureValue(queryFirst(doc, ['.iCIMS_Header h1', 'h1.iCIMS_Header', 'h1']));
    },

    /**
     * Locates the control that advances to the next server-rendered page.
     *
     * INV-1: located and highlighted, NEVER clicked. iCIMS "Next" links post the form, so a
     * programmatic click here would be an auto-submit in everything but name.
     */
    nextButton(doc: Document): HTMLElement | null {
      return queryFirst(doc, [
        'input[value="Next" i]',
        'a[title="Next" i]',
        '.iCIMS_Button[value*="Next" i]',
        '#quickApplyBtn',
        '.iCIMS_MainWrapper input[type="submit"]',
      ]);
    },
  },
};

export default icimsAdapter;
