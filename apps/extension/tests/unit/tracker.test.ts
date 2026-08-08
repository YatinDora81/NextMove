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
 * Dexie cannot run under happy-dom (no IndexedDB), so `@/platform/db` is replaced with the
 * in-memory stand-in from `tests/setup.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
} from '@/tracker/detectors';
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
