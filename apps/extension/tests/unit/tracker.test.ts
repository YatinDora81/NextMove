/**
 * tests/unit/tracker.test.ts — JF-001 Rev 3.0 SEC 11 (Unit) · SEC 6.7 Tracker.
 *
 * Two behaviours matter more than everything else the tracker does:
 *
 *   THE AUTO-CAPTURE PRIORITY CHAIN.  JSON-LD (publisher-authored, machine-readable) beats the
 *   adapter's selectors, which beat the `og:` / `<title>` heuristics, which beat the URL. A lower
 *   tier may only fill a gap the higher tiers left empty — it can never overrule them. Getting
 *   this wrong writes the ATS vendor's name into the tracker instead of the employer's.
 *
 *   THE STATUS FLIP.  A row opens as `draft` on the first fill and becomes `applied` ONLY when a
 *   confirmation is OBSERVED. INV-1 in its second form: JobFill never submits, so it must never
 *   infer that it did. `markApplied(id, signal)` refuses a signal that did not confirm, and a
 *   finished fill run on its own leaves the row in `draft`.
 *
 * The v2.2 submit-time signal is tested with the same suspicion: `installSubmitWatch()` reports the
 * user's own press and nothing else, and `looksLikeJobPage()` is the gate that stops a generic
 * "thank you" anywhere on the web from minting an application that never happened.
 *
 * Dexie cannot run under happy-dom (no IndexedDB), so `@/platform/db` is replaced with the
 * in-memory stand-in from `tests/setup.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/db', async () => ({ db: (await import('../setup')).memoryDb }));

import { getAdapter } from '@/core/adapters';
import type { FillReport, JobContext } from '@/shared/types';
import {
  CAPTURE_CONFIDENCE,
  captureJobContext,
  companyFromUrl,
  extractJobDescription,
  parseJsonLdJobPostings,
} from '@/tracker/capture';
import {
  CONFIRMATION_MIN_CONFIDENCE,
  NO_CONFIRMATION,
  detectConfirmation,
  looksLikeJobPage,
  matchesConfirmationUrl,
} from '@/tracker/detectors';
import {
  installSubmitWatch,
  type SubmitSignal,
  type SubmitWatchHandle,
} from '@/tracker/submit-watch';
import {
  computeStats,
  get,
  getAll,
  logApplication,
  logFill,
  markApplied,
  setStatus,
  update,
} from '@/tracker/service';

import {
  FIXTURE_URLS,
  loadFixture,
  memoryDb,
  resetMemoryDb,
  unloadFixture,
} from '../setup';

const PROFILE = 'prof_test_0001';

beforeEach(async () => {
  await resetMemoryDb();
});

/** Render an arbitrary page and return the live document. */
function page(html: string): Document {
  unloadFixture();
  document.open();
  document.write(`<!doctype html><html><head></head><body>${html}</body></html>`);
  document.close();
  return document;
}

/* ------------------------------------------------------------------------------------------------
 * SEC 6.7 step 2 — the auto-capture priority chain
 * ---------------------------------------------------------------------------------------------- */

describe('captureJobContext — JSON-LD ▸ adapter ▸ og/title ▸ url', () => {
  const JSON_LD = `
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"JobPosting","title":"Staff Engineer",
       "hiringOrganization":{"@type":"Organization","name":"Northwind Labs"}}
    </script>`;

  const ADAPTER_MARKUP = `
    <div class="company-name">Adapter Employer</div>
    <h1 class="app-title">Adapter Role</h1>`;

  const OG_MARKUP = `
    <meta property="og:site_name" content="OG Employer" />
    <meta property="og:title" content="OG Role" />`;

  const SELECTORS = { company: ['.company-name'], role: ['h1.app-title'] };

  it('JSON-LD wins over the adapter selectors and over og/title', () => {
    const doc = page(`${JSON_LD}${ADAPTER_MARKUP}${OG_MARKUP}`);
    const captured = captureJobContext(doc, 'https://boards.greenhouse.io/acme/jobs/1', SELECTORS);

    expect(captured.company).toBe('Northwind Labs');
    expect(captured.role).toBe('Staff Engineer');
    expect(captured.source).toBe('json-ld');
    expect(captured.confidence).toBe(CAPTURE_CONFIDENCE.jsonLd);
  });

  it('the adapter selectors win once JSON-LD is absent', () => {
    const doc = page(`${ADAPTER_MARKUP}${OG_MARKUP}`);
    const captured = captureJobContext(doc, 'https://boards.greenhouse.io/acme/jobs/1', SELECTORS);

    expect(captured.company).toBe('Adapter Employer');
    expect(captured.role).toBe('Adapter Role');
    expect(captured.source).toBe('adapter');
    expect(captured.confidence).toBe(CAPTURE_CONFIDENCE.adapter);
  });

  it('og/title heuristics only run when neither of the two higher tiers answered', () => {
    const doc = page(OG_MARKUP);
    const captured = captureJobContext(doc, 'https://boards.greenhouse.io/acme/jobs/1', SELECTORS);

    expect(captured.company).toBe('OG Employer');
    expect(captured.role).toBe('OG Role');
    expect(captured.source).toBe('heuristic');
  });

  it('a lower tier may only FILL A GAP, never overrule a higher one', () => {
    // JSON-LD knows the role but not the employer; the adapter knows the employer.
    const partialJsonLd = `
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"JobPosting","title":"Staff Engineer"}
      </script>`;
    const doc = page(`${partialJsonLd}${ADAPTER_MARKUP}${OG_MARKUP}`);
    const captured = captureJobContext(doc, 'https://boards.greenhouse.io/acme/jobs/1', SELECTORS);

    expect(captured.role).toBe('Staff Engineer'); // from JSON-LD
    expect(captured.company).toBe('Adapter Employer'); // gap filled by the adapter
    expect(captured.source).toBe('json-ld'); // the winner is still the highest tier that spoke
    // Both values present ⇒ the confidence is the WEAKER of the two contributing tiers.
    expect(captured.confidence).toBe(CAPTURE_CONFIDENCE.adapter);
  });

  it('falls back to the URL for the employer when the page says nothing', () => {
    const doc = page('<p>An unhelpful page.</p>');
    const captured = captureJobContext(doc, 'https://boards.greenhouse.io/northwindlabs/jobs/42');
    expect(captured.company.length).toBeGreaterThan(0);
    // A half-capture is deliberately discounted so the row still asks for the user's eyes.
    expect(captured.confidence).toBeLessThan(CAPTURE_CONFIDENCE.url);
  });

  it('reports source "none" and confidence 0 when there is genuinely nothing to capture', () => {
    const doc = page('<p>An unhelpful page.</p>');
    const captured = captureJobContext(doc, 'about:blank');
    expect(captured).toEqual({ company: '', role: '', source: 'none', confidence: 0 });
  });

  it('a malformed JSON-LD block is ignored rather than throwing', () => {
    const doc = page(
      `<script type="application/ld+json">{ not json at all }</script>${ADAPTER_MARKUP}`,
    );
    expect(parseJsonLdJobPostings(doc)).toEqual([]);
    expect(captureJobContext(doc, 'https://example.invalid/x', SELECTORS).company).toBe(
      'Adapter Employer',
    );
  });

  it('reads the JSON-LD out of the real Greenhouse fixture', () => {
    const doc = loadFixture('greenhouse');
    const captured = captureJobContext(
      doc,
      FIXTURE_URLS.greenhouse,
      getAdapter('greenhouse').capture,
    );
    expect(captured.company).toBe('Northwind Labs');
    expect(captured.role).toBe('Software Engineer, Platform');
    expect(captured.source).toBe('json-ld');
  });

  it('uses the adapter selectors on the Workday fixture, which ships no JSON-LD', () => {
    const doc = loadFixture('workday');
    const captured = captureJobContext(doc, FIXTURE_URLS.workday, getAdapter('workday').capture);
    expect(captured.company).toBe('Grimsby Aerospace');
    expect(captured.role).toBe('Data Engineer II');
    expect(captured.source).toBe('adapter');
  });

  it('companyFromUrl strips the ATS host, never the employer', () => {
    expect(companyFromUrl('https://boards.greenhouse.io/northwindlabs/jobs/1').toLowerCase()).toContain(
      'northwindlabs',
    );
    expect(companyFromUrl('https://jobs.lever.co/fablewright/abc').toLowerCase()).toContain(
      'fablewright',
    );
    expect(companyFromUrl('not a url')).toBe('');
  });

  it('extractJobDescription reads text, never innerHTML, and skips <script> payloads', () => {
    const doc = loadFixture('generic');
    const jd = extractJobDescription(doc);
    expect(jd).toContain('Ravensmoor Instruments is an invented company');
    expect(jd).not.toContain('<');
    expect(jd).not.toContain('application/ld+json');
  });
});

/* ------------------------------------------------------------------------------------------------
 * SEC 6.7 step 4 — confirmation detection
 * ---------------------------------------------------------------------------------------------- */

describe('detectConfirmation — observation only (INV-1)', () => {
  it('an adapter selector is the strongest signal', () => {
    const doc = page('<div id="application_confirmation">Thanks!</div>');
    const signal = detectConfirmation(doc, 'https://boards.greenhouse.io/acme/jobs/1', {
      selectors: ['#application_confirmation'],
    });
    expect(signal.confirmed).toBe(true);
    expect(signal.source).toBe('adapter-selector');
    expect(signal.confidence).toBeGreaterThanOrEqual(CONFIRMATION_MIN_CONFIDENCE);
  });

  it('a confirmation-shaped URL confirms on its own', () => {
    const signal = detectConfirmation(page('<p>ok</p>'), 'https://example.invalid/apply/thank-you');
    expect(signal.confirmed).toBe(true);
    expect(signal.source).toBe('url');
  });

  it('an in-page cue inside a landmark confirms', () => {
    const doc = page('<div role="status">Your application has been submitted.</div>');
    const signal = detectConfirmation(doc, 'https://example.invalid/apply');
    expect(signal.confirmed).toBe(true);
    expect(signal.source).toBe('dom-landmark');
  });

  it('an ordinary application page does NOT confirm', () => {
    const doc = loadFixture('greenhouse');
    const signal = detectConfirmation(doc, FIXTURE_URLS.greenhouse, getAdapter('greenhouse').confirmation);
    expect(signal.confirmed).toBe(false);
    expect(signal.source).toBe('none');
  });

  it('the word "submit" on a button is not a confirmation', () => {
    const doc = page('<button type="submit">Submit Application</button>');
    expect(detectConfirmation(doc, 'https://example.invalid/apply').confirmed).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------
 * v2.2 Phase 3 — the job-page gate
 * ---------------------------------------------------------------------------------------------- */

describe('looksLikeJobPage — the gate in front of every auto-log', () => {
  it('recognises the ATS hosts', () => {
    for (const url of [
      FIXTURE_URLS.greenhouse,
      FIXTURE_URLS.lever,
      FIXTURE_URLS.workday,
      FIXTURE_URLS.ashby,
      'https://www.naukri.com/job-listings-platform-engineer-northwind-123456',
      'https://jobs.smartrecruiters.com/Northwind/743999',
      'https://northwind.icims.com/jobs/4321/platform-engineer/job',
      'https://northwind.taleo.net/careersection/ex/jobapply.ftl',
    ]) {
      expect(looksLikeJobPage(url), url).toBe(true);
    }
  });

  it('recognises a company careers site by its subdomain or by its path', () => {
    expect(looksLikeJobPage(FIXTURE_URLS.generic)).toBe(true); // careers.ravensmoor.example
    expect(looksLikeJobPage('https://jobs.ravensmoor.example/technical-writer')).toBe(true);
    expect(looksLikeJobPage('https://ravensmoor.example/careers/technical-writer')).toBe(true);
    expect(looksLikeJobPage('https://ravensmoor.example/jobs/42/apply')).toBe(true);
  });

  it('REFUSES a confirmation-shaped page that has nothing to do with a job', () => {
    // The reason this predicate exists. The URL below matches the confirmation vocabulary outright,
    // so without the gate a checkout receipt would mint an `applied` row for a job that was never
    // applied to — and a tracker the user cannot trust is worse than no tracker.
    const url = 'https://shop.example.com/checkout/thank-you';
    expect(matchesConfirmationUrl(url).matched).toBe(true);
    expect(looksLikeJobPage(url)).toBe(false);
  });

  it('a matched ATS adapter answers on its own, whatever the host looks like', () => {
    const intranet = 'https://intranet.example.com/hiring/tool';
    expect(looksLikeJobPage(intranet, 'greenhouse')).toBe(true);
    expect(looksLikeJobPage(intranet, 'generic')).toBe(false);
    expect(looksLikeJobPage(intranet, null)).toBe(false);
  });

  it('is not fooled by a string that is not a URL at all', () => {
    expect(looksLikeJobPage('not a url')).toBe(false);
    expect(looksLikeJobPage('')).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------
 * v2.2 Phase 3 — the submit-time signal
 * ---------------------------------------------------------------------------------------------- */

describe('installSubmitWatch — it watches the user press submit, it never presses (INV-1)', () => {
  /**
   * A form shaped the way a real application is — the questions plus the résumé. The form path
   * demands that shape on top of the submit vocabulary, because a bare "Submit" caption sits on
   * search boxes and newsletter signups too.
   */
  const FORM = `
    <form id="app">
      <input type="text" name="full_name" />
      <input type="email" name="email" />
      <input type="tel" name="phone" />
      <input type="file" name="resume" />
      <button type="button" id="save">Save draft</button>
      <div role="button" id="easy">Easy apply</div>
      <button type="submit" id="send">Submit application</button>
    </form>`;


  const watchers: SubmitWatchHandle[] = [];

  afterEach(() => {
    while (watchers.length > 0) watchers.pop()?.destroy();
  });

  function watch(seen: SubmitSignal[], debounceMs?: number): SubmitWatchHandle {
    const handle = installSubmitWatch(
      debounceMs === undefined
        ? { doc: document, onSubmit: (signal) => seen.push(signal) }
        : { doc: document, debounceMs, onSubmit: (signal) => seen.push(signal) },
    );
    watchers.push(handle);
    return handle;
  }

  function el(doc: Document, id: string): Element {
    const found = doc.getElementById(id);
    if (found === null) throw new Error(`#${id} is missing from the test page`);
    return found;
  }

  /**
   * happy-dom does not implement `isTrusted`, and the production guard reads it — so a "real" press
   * has to say so explicitly here. Its absence is exactly what the page-script case asserts on.
   */
  function trustedClick(target: Element): void {
    const event = new MouseEvent('click', { bubbles: true, composed: true });
    Object.defineProperty(event, 'isTrusted', { value: true, configurable: true });
    target.dispatchEvent(event);
  }

  it('a real form submit reports one signal', () => {
    const doc = page(FORM);
    const seen: SubmitSignal[] = [];
    watch(seen);

    el(doc, 'app').dispatchEvent(new Event('submit', { bubbles: true }));

    expect(seen).toEqual([{ reason: 'form', label: '' }]);
  });

  it('the submitter names the signal when the engine supplies one', () => {
    const doc = page(FORM);
    const seen: SubmitSignal[] = [];
    watch(seen);

    const event = new Event('submit', { bubbles: true });
    Object.defineProperty(event, 'submitter', { value: el(doc, 'send'), configurable: true });
    el(doc, 'app').dispatchEvent(event);

    expect(seen).toEqual([{ reason: 'form', label: 'Submit application' }]);
  });

  it('a trusted press on an apply-shaped control reports even without a <form> submit', () => {
    const doc = page(FORM);
    const seen: SubmitSignal[] = [];
    watch(seen);

    trustedClick(el(doc, 'easy'));

    expect(seen).toEqual([{ reason: 'button', label: 'Easy apply' }]);
  });

  it('a SYNTHETIC click is ignored — a page script must not be able to log an application', () => {
    const doc = page(FORM);
    const seen: SubmitSignal[] = [];
    watch(seen);

    el(doc, 'easy').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(seen).toEqual([]);
  });

  it('a press on an unrelated button is ignored', () => {
    const doc = page(FORM);
    const seen: SubmitSignal[] = [];
    watch(seen);

    trustedClick(el(doc, 'save'));

    expect(seen).toEqual([]);
  });

  it('one press that produces both a click and a submit reports ONCE', () => {
    const doc = page(FORM);
    const seen: SubmitSignal[] = [];
    watch(seen);

    trustedClick(el(doc, 'send'));
    el(doc, 'app').dispatchEvent(new Event('submit', { bubbles: true }));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.reason).toBe('button');
  });

  it('the collapse is time-bounded, not once per page — a second application still reports', () => {
    const doc = page(FORM);
    const seen: SubmitSignal[] = [];
    watch(seen, 0);

    el(doc, 'app').dispatchEvent(new Event('submit', { bubbles: true }));
    el(doc, 'app').dispatchEvent(new Event('submit', { bubbles: true }));

    expect(seen).toHaveLength(2);
  });

  /* ----------------------------------------------------------------------------------------------
   * The FORM path needs POSITIVE evidence that what was submitted is an APPLICATION.
   *
   * A `submit` event reaching the document says only that *some* form on the page was sent. The
   * caller's other gate (`looksLikeJobPage()`) is true for the whole careers host, so on
   * `careers.acme.example/jobs` an unfiltered form path mints an `applied` row for a job nobody
   * applied to the moment the user presses Enter in the site's search box.
   * -------------------------------------------------------------------------------------------- */

  it('Enter in the site’s job-SEARCH box does NOT report — one text input and a Search button', () => {
    const doc = page(`
      <form id="search" role="search">
        <input type="search" name="q" placeholder="Search jobs" />
        <button type="submit">Search</button>
      </form>`);
    const seen: SubmitSignal[] = [];
    watch(seen);

    // Enter inside a text field submits the form with NO submitter — the exact shape of the bug.
    el(doc, 'search').dispatchEvent(new Event('submit', { bubbles: true }));

    expect(seen).toEqual([]);
  });

  it('a LOGIN form does NOT report — an email field and a password is not an application', () => {
    const doc = page(`
      <form id="login">
        <input type="email" name="email" />
        <input type="password" name="password" />
        <button type="submit">Sign in</button>
      </form>`);
    const seen: SubmitSignal[] = [];
    watch(seen);

    el(doc, 'login').dispatchEvent(new Event('submit', { bubbles: true }));

    expect(seen).toEqual([]);
  });

  it('a NEWSLETTER box does NOT report — one email field and a Subscribe button', () => {
    const doc = page(`
      <form id="news">
        <input type="email" name="email" placeholder="Your email" />
        <button type="submit">Subscribe</button>
      </form>`);
    const seen: SubmitSignal[] = [];
    watch(seen);

    el(doc, 'news').dispatchEvent(new Event('submit', { bubbles: true }));

    expect(seen).toEqual([]);
  });

  it('a REAL application form reports, even when the engine names no submitter', () => {
    const doc = page(`
      <form id="apply">
        <input type="text" name="first_name" />
        <input type="text" name="last_name" />
        <input type="email" name="email" />
        <input type="tel" name="phone" />
        <input type="file" name="resume" />
        <textarea name="cover_letter"></textarea>
        <button type="submit">Submit application</button>
      </form>`);
    const seen: SubmitSignal[] = [];
    watch(seen);

    el(doc, 'apply').dispatchEvent(new Event('submit', { bubbles: true }));

    expect(seen).toEqual([{ reason: 'form', label: '' }]);
  });

  it('the application-shaped FIELDS carry the form on their own, with no submit vocabulary anywhere', () => {
    // Taleo/iCIMS ship a plain-HTML step whose control is `<input type="submit" value="Continue">`.
    // The label proves nothing here; the résumé upload sitting next to name/email/phone does.
    const doc = page(`
      <form id="ats">
        <input type="text" name="candidate_full_name" />
        <input type="email" name="candidate_email" />
        <input type="tel" name="candidate_phone" />
        <input type="file" name="resume_upload" />
        <input type="submit" value="Continue" />
      </form>`);
    const seen: SubmitSignal[] = [];
    watch(seen);

    el(doc, 'ats').dispatchEvent(new Event('submit', { bubbles: true }));

    expect(seen).toEqual([{ reason: 'form', label: '' }]);
  });

  it('the SUBMITTER’s label alone does NOT carry a form the fields do not vouch for', () => {
    // One field named `q` is a search box whatever the button calls itself. A genuine press on a
    // control this specific is still reported — by the CLICK path, which needs no form at all.
    const doc = page(`
      <form id="short">
        <input type="text" name="q" />
        <button type="submit" id="go">Submit application</button>
      </form>`);
    const seen: SubmitSignal[] = [];
    watch(seen);

    const event = new Event('submit', { bubbles: true });
    Object.defineProperty(event, 'submitter', { value: el(doc, 'go'), configurable: true });
    el(doc, 'short').dispatchEvent(event);

    expect(seen).toEqual([]);
  });

  it('a job-SEARCH box whose button happens to say “Submit” does NOT report', () => {
    const doc = page(`
      <form id="search">
        <input type="text" name="q" />
        <button type="submit" id="go">Submit</button>
      </form>`);
    const seen: SubmitSignal[] = [];
    watch(seen);

    const event = new Event('submit', { bubbles: true });
    Object.defineProperty(event, 'submitter', { value: el(doc, 'go'), configurable: true });
    el(doc, 'search').dispatchEvent(event);

    expect(seen).toEqual([]);
  });

  it('a FEEDBACK box whose button says “Submit” does NOT report', () => {
    const doc = page(`
      <form id="feedback">
        <textarea name="comments"></textarea>
        <button type="submit" id="go">Submit</button>
      </form>`);
    const seen: SubmitSignal[] = [];
    watch(seen);

    const event = new Event('submit', { bubbles: true });
    Object.defineProperty(event, 'submitter', { value: el(doc, 'go'), configurable: true });
    el(doc, 'feedback').dispatchEvent(event);

    expect(seen).toEqual([]);
  });

  it('a search form WRAPPING the results list does not borrow an “Apply now” card link', () => {
    // The ordinary job-board layout: one big <form> around the search box AND the results. Evidence
    // must come from the submitted form's own fields, never from a control nobody pressed.
    const doc = page(`
      <form id="jobsearch">
        <input type="text" name="q" />
        <button type="submit">Search</button>
        <ul>
          <li><a class="btn" href="/jobs/1">Apply now</a></li>
          <li><a class="btn" href="/jobs/2">Apply now</a></li>
        </ul>
      </form>`);
    const seen: SubmitSignal[] = [];
    watch(seen);

    el(doc, 'jobsearch').dispatchEvent(new Event('submit', { bubbles: true }));

    expect(seen).toEqual([]);
  });


  it('a submit that belongs to no form at all is refused rather than guessed at', () => {
    const doc = page(`${FORM}<div id="loose">not a form</div>`);
    const seen: SubmitSignal[] = [];
    watch(seen);

    // Nothing to inspect ⇒ no evidence ⇒ fail closed, rather than crediting the page's other form.
    el(doc, 'loose').dispatchEvent(new Event('submit', { bubbles: true }));

    expect(seen).toEqual([]);
  });

  it('destroy() detaches, and is safe to call twice', () => {
    const doc = page(FORM);
    const seen: SubmitSignal[] = [];
    const handle = watch(seen);

    handle.destroy();
    handle.destroy();
    el(doc, 'app').dispatchEvent(new Event('submit', { bubbles: true }));
    trustedClick(el(doc, 'easy'));

    expect(seen).toEqual([]);
  });

  it('INV-1: observing a submit never presses or submits anything itself', () => {
    const doc = page(FORM);
    const seen: SubmitSignal[] = [];
    watch(seen);

    const clickSpy = vi.spyOn(HTMLElement.prototype, 'click');
    const submitSpy = vi.fn();
    const form = el(doc, 'app');
    Object.defineProperty(form, 'submit', { value: submitSpy, configurable: true });

    trustedClick(el(doc, 'send'));

    // Non-vacuity: the watcher really did see the press it is being cleared of causing.
    expect(seen).toHaveLength(1);
    expect(clickSpy).not.toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------------------------------
 * SEC 6.7 — the status flip
 * ---------------------------------------------------------------------------------------------- */

describe('the status flip only happens on an OBSERVED confirmation', () => {
  const jobCtx: JobContext = {
    title: 'Software Engineer, Platform',
    company: 'Northwind Labs',
    jd: '',
    url: FIXTURE_URLS.greenhouse,
  };

  const report: FillReport = {
    atsId: 'greenhouse',
    url: FIXTURE_URLS.greenhouse,
    filled: 12,
    suggested: 2,
    skipped: 2,
    errors: 0,
    perField: Array.from({ length: 16 }, (_, i) => ({ hash: `h${i}`, action: 'fill', ok: true })),
  };

  it('a finished fill run opens the row as DRAFT — filling is not applying (INV-1)', async () => {
    const { row, created } = await logFill(report, jobCtx, PROFILE);
    expect(created).toBe(true);
    expect(row.status).toBe('draft');
    expect(row.appliedAt).toBeNull();
    expect(row.company).toBe('Northwind Labs');
    expect(row.fillStats).toEqual({ filled: 12, total: 16 });
    expect(row.history).toEqual([{ at: expect.any(Number), to: 'draft' }]);
  });

  it('markApplied REFUSES a signal that did not confirm — the row stays draft', async () => {
    const { row } = await logFill(report, jobCtx, PROFILE);

    expect(await markApplied(row.id, NO_CONFIRMATION)).toBeNull();
    expect(await markApplied(row.id, { confirmed: false, source: 'none', evidence: '', confidence: 0.4 })).toBeNull();

    const after = await get(row.id);
    expect(after?.status).toBe('draft');
    expect(after?.appliedAt).toBeNull();
    expect(after?.history).toHaveLength(1);
  });

  it('markApplied accepts a CONFIRMED signal and stamps appliedAt exactly once', async () => {
    const { row } = await logFill(report, jobCtx, PROFILE);
    const signal = detectConfirmation(
      page('<div role="status">Your application has been submitted.</div>'),
      'https://boards.greenhouse.io/acme/jobs/1/confirmation',
    );
    expect(signal.confirmed).toBe(true);

    const applied = await markApplied(row.id, signal);
    expect(applied?.status).toBe('applied');
    expect(applied?.appliedAt).toEqual(expect.any(Number));
    expect(applied?.history.map((h) => h.to)).toEqual(['draft', 'applied']);

    const stamped = applied?.appliedAt;
    // A second observation must not re-stamp — days-to-response is measured from the first.
    const again = await markApplied(row.id, signal);
    expect(again?.appliedAt).toBe(stamped);
    expect(again?.history).toHaveLength(2);
  });

  it('the manual path (no signal at all) is allowed — that is the user observing themselves', async () => {
    const { row } = await logFill(report, jobCtx, PROFILE);
    const applied = await markApplied(row.id);
    expect(applied?.status).toBe('applied');
  });

  it('never walks a row backwards to draft', async () => {
    const { row } = await logFill(report, jobCtx, PROFILE);
    await markApplied(row.id);
    await setStatus(row.id, 'interview');

    const signal = { confirmed: true, source: 'url' as const, evidence: 'x', confidence: 0.9 };
    const unchanged = await markApplied(row.id, signal);
    expect(unchanged?.status).toBe('interview');
  });

  it('markApplied on a row that does not exist returns null rather than inventing one', async () => {
    expect(await markApplied('app_missing')).toBeNull();
  });

  it('a confirmation on an ALREADY-LOGGED posting promotes that row instead of losing the status', async () => {
    // The fill created the row; the confirmation arrives afterwards as a second log for the same
    // URL. If the merge path drops the requested status, the row is stranded in `draft` forever.
    const { row } = await logFill(report, jobCtx, PROFILE);

    const again = await logApplication({
      company: jobCtx.company,
      role: jobCtx.title,
      url: FIXTURE_URLS.greenhouse,
      ats: 'greenhouse',
      profileId: PROFILE,
      status: 'applied',
    });

    expect(again.created).toBe(false);
    expect(again.row.id).toBe(row.id);
    expect(again.row.status).toBe('applied');
    expect(again.row.appliedAt).toEqual(expect.any(Number));
    expect(again.row.history.map((h) => h.to)).toEqual(['draft', 'applied']);
  });

  it('the merge path never walks a row that already moved past draft backwards', async () => {
    const { row } = await logFill(report, jobCtx, PROFILE);
    await setStatus(row.id, 'interview');

    const again = await logApplication({
      company: jobCtx.company,
      role: jobCtx.title,
      url: FIXTURE_URLS.greenhouse,
      ats: 'greenhouse',
      profileId: PROFILE,
      status: 'applied',
    });

    expect(again.row.status).toBe('interview');
    expect(again.row.history.map((h) => h.to)).toEqual(['draft', 'interview']);
  });

  it('a plain re-fill leaves the status alone and writes no history entry', async () => {
    const { row } = await logFill(report, jobCtx, PROFILE);
    const again = await logFill(report, jobCtx, PROFILE);

    expect(again.row.id).toBe(row.id);
    expect(again.row.status).toBe('draft');
    expect(again.row.history).toHaveLength(1);
  });

  it('a status change through update() is still recorded in history', async () => {
    const { row } = await logFill(report, jobCtx, PROFILE);
    const patched = await update(row.id, { status: 'rejected', notes: 'no reply' });
    expect(patched?.status).toBe('rejected');
    expect(patched?.notes).toBe('no reply');
    expect(patched?.history.map((h) => h.to)).toEqual(['draft', 'rejected']);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Row identity and stats
 * ---------------------------------------------------------------------------------------------- */

describe('tracker rows', () => {
  it('re-filling the same posting updates the existing row instead of duplicating it', async () => {
    await logApplication({
      company: '',
      role: '',
      url: 'https://boards.greenhouse.io/acme/jobs/1?gh_src=abc&utm_source=x',
      ats: 'greenhouse',
      profileId: PROFILE,
      fillStats: { filled: 3, total: 10 },
    });
    const second = await logApplication({
      company: 'Acme',
      role: 'Engineer',
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      ats: 'greenhouse',
      profileId: PROFILE,
      fillStats: { filled: 9, total: 10 },
    });

    expect(second.created).toBe(false);
    expect(await memoryDb.applications.count()).toBe(1);
    // Auto-capture may improve on a re-fill; the better fill stats win.
    expect(second.row.company).toBe('Acme');
    expect(second.row.fillStats).toEqual({ filled: 9, total: 10 });
  });

  it('a hand-edited company is never overwritten by a later auto-capture', async () => {
    const first = await logApplication({
      company: 'Northwind Labs',
      role: 'Engineer',
      url: 'https://boards.greenhouse.io/acme/jobs/2',
      ats: 'greenhouse',
      profileId: PROFILE,
    });
    const second = await logApplication({
      company: 'Greenhouse',
      role: 'Engineer',
      url: 'https://boards.greenhouse.io/acme/jobs/2',
      ats: 'greenhouse',
      profileId: PROFILE,
    });
    expect(second.row.id).toBe(first.row.id);
    expect(second.row.company).toBe('Northwind Labs');
  });

  it('two different profiles keep independent rows for the same posting', async () => {
    await logApplication({
      company: 'Acme',
      role: 'Engineer',
      url: 'https://boards.greenhouse.io/acme/jobs/3',
      ats: 'greenhouse',
      profileId: PROFILE,
    });
    await logApplication({
      company: 'Acme',
      role: 'Engineer',
      url: 'https://boards.greenhouse.io/acme/jobs/3',
      ats: 'greenhouse',
      profileId: 'prof_other',
    });
    expect(await memoryDb.applications.count()).toBe(2);
  });

  it('computeStats counts only what actually happened', async () => {
    const now = Date.UTC(2026, 1, 10);
    const rows = await (async () => {
      await logApplication({ company: 'A', role: 'R', url: 'https://x.invalid/1', ats: 'generic', profileId: PROFILE });
      await logApplication({ company: 'B', role: 'R', url: 'https://x.invalid/2', ats: 'generic', profileId: PROFILE });
      const all = await getAll();
      const first = all[0];
      if (first !== undefined) await markApplied(first.id);
      return getAll();
    })();

    const stats = computeStats(rows, now);
    expect(stats.total).toBe(2);
    expect(stats.activeInterviews).toBe(0);
    expect(stats.responseRate).toBe(0);
  });
});
