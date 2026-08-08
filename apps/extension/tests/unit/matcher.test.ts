/**
 * tests/unit/matcher.test.ts — JF-001 Rev 3.0 SEC 11 (Unit · "scoring table, golden expectations
 * per fixture").
 *
 * This is the file the fixture corpus exists for. For each saved ATS form the table below records
 * what the FieldMatcher is *supposed* to conclude — profile path, score and INV-4 action — for
 * every control the scanner finds, in scan order. A diff here is not a test failure in the abstract:
 * it is "this change moves N real fields between fill / suggest / skip on a real ATS form".
 *
 * SEC 6.3, the contract being asserted:
 *
 *   user mapping 100 → adapter 98 → autocomplete 95 → exact label synonym 90 →
 *   name/id token synonym 75 → placeholder/aria synonym 65 → fuzzy (JW ≥ .88) 55 → else skip
 *
 *   modifiers: +5 input-type agreement · −20 conflicting section heading · −30 path already filled
 *   actions:   ≥70 fill · 50–69 suggest · <50 skip                                       ← INV-4
 *
 * The golden tables are computed with `requireValue: false`, i.e. pure SEC 6.3 scoring, so the
 * numbers are about the FORM rather than about the contents of one particular vault. The separate
 * "requireValue" block below covers the second half of INV-4 — never write a value we do not have.
 *
 * KNOWN ENVIRONMENT LIMIT: happy-dom does not lay out, so `core/scanner.ts::isVisible` cannot see
 * that Workday's pre-rendered next step (`display:none` on an ancestor `<fieldset>`) is off-screen —
 * only the element's OWN computed style is available. The two fields of that step therefore appear
 * in the Workday table below. In a real browser they are dropped by the geometry check; asserting
 * that belongs to the Playwright layer (SEC 11, E2E row).
 */

import { describe, expect, it } from 'vitest';

import { getAdapter } from '@/core/adapters';
import { FieldMatcher } from '@/core/matcher';
import { detectAtsId } from '@/core/adapters/registry';
import { scanForms } from '@/core/scanner';
import { FILL_THRESHOLD, SCORE, SCORE_MODIFIER, SUGGEST_THRESHOLD } from '@/shared/constants';
import type { AtsId, FieldNode, MatchResult, ProfilePath } from '@/shared/types';

import {
  FIXTURES,
  FIXTURE_URLS,
  loadFixture,
  makeEmptyProfile,
  makeProfile,
  unloadFixture,
  type FixtureId,
} from '../setup';

/* ------------------------------------------------------------------------------------------------
 * Harness
 * ---------------------------------------------------------------------------------------------- */

interface GoldenRow {
  /** Stable handle for the control: data-automation-id → id → name → label. */
  key: string;
  path: ProfilePath | null;
  score: number;
  action: MatchResult['action'];
  source: MatchResult['source'];
}

function keyOf(node: FieldNode): string {
  const el = node.el as Element | null;
  const automation = el?.getAttribute?.('data-automation-id') ?? '';
  if (automation.length > 0) return automation;
  if (node.sig.id.length > 0) return node.sig.id;
  if (node.sig.name.length > 0) return node.sig.name;
  return node.sig.label;
}

interface Scanned {
  atsId: AtsId;
  nodes: FieldNode[];
  matcher: FieldMatcher;
  results: MatchResult[];
  rows: GoldenRow[];
}

/** Scan + detect + match one fixture exactly the way the content script would. */
function runFixture(id: FixtureId, options: { requireValue?: boolean } = {}): Scanned {
  const doc = loadFixture(id);
  const url = FIXTURE_URLS[id];
  const atsId = detectAtsId(url, doc);
  const adapter = getAdapter(atsId);

  const nodes = scanForms(doc).fields;
  const matcher = new FieldMatcher({
    profile: makeProfile(),
    adapterFieldMap: adapter.fieldMap(),
    requireValue: options.requireValue ?? false,
  });
  const results = matcher.match(nodes);

  return {
    atsId,
    nodes,
    matcher,
    results,
    rows: results.map((result) => ({
      key: keyOf(result.node),
      path: result.path,
      score: result.score,
      action: result.action,
      source: result.source,
    })),
  };
}

/* ------------------------------------------------------------------------------------------------
 * GOLDEN EXPECTATIONS
 * ---------------------------------------------------------------------------------------------- */

const GOLDEN: Readonly<Record<FixtureId, { ats: AtsId; rows: readonly GoldenRow[] }>> = {
  greenhouse: {
    ats: 'greenhouse',
    rows: [
      { key: 'first_name', path: 'personal.firstName', score: 98, action: 'fill', source: 'adapter' },
      { key: 'last_name', path: 'personal.lastName', score: 98, action: 'fill', source: 'adapter' },
      // 98 + 5 (email input ↔ email path) = 103, clamped to 100.
      { key: 'email', path: 'personal.email', score: 100, action: 'fill', source: 'adapter' },
      { key: 'phone', path: 'personal.phone', score: 100, action: 'fill', source: 'adapter' },
      {
        key: 'job_application_location',
        path: 'personal.address.city',
        score: 98,
        action: 'fill',
        source: 'adapter',
      },
      // 98 (adapter) + 5 (input-type agreement: `resume` expects a file control) → clamped 100.
      { key: 'resume', path: 'resume', score: 100, action: 'fill', source: 'adapter' },
      { key: 'cover_letter', path: 'coverLetter', score: 98, action: 'fill', source: 'adapter' },
      // "Why do you want to work at Northwind Labs?" — the alias is close but not verbatim, so this
      // lands in the fuzzy tier (55) + textarea agreement (5). 60 ⇒ suggest, never a silent fill.
      {
        key: 'job_application_answers_attributes_0_text_value',
        path: 'answers.whyCompany',
        score: 60,
        action: 'suggest',
        source: 'heuristic',
      },
      {
        key: 'job_application_answers_attributes_1_text_value',
        path: 'links.linkedin',
        score: 95,
        action: 'fill',
        source: 'heuristic',
      },
      {
        key: 'job_application_answers_attributes_2_text_value',
        path: 'answers.howDidYouHear',
        score: 90,
        action: 'fill',
        source: 'heuristic',
      },
      // SEC 6.3's canonical example: "Name" under *References* is 90 − 20 (section) − 30 (the
      // applicant's name was already filled in this form) = 40 ⇒ skip.
      {
        key: 'job_application_answers_attributes_3_text_value',
        path: 'personal.fullName',
        score: 40,
        action: 'skip',
        source: 'heuristic',
      },
      // 90 + 5 (email agreement) − 20 (section) − 30 (duplicate) = 45 ⇒ skip.
      {
        key: 'job_application_answers_attributes_4_text_value',
        path: 'personal.email',
        score: 45,
        action: 'skip',
        source: 'heuristic',
      },
      { key: 'job_application_gender', path: 'eeo.gender', score: 100, action: 'fill', source: 'adapter' },
      { key: 'job_application_race', path: 'eeo.ethnicity', score: 100, action: 'fill', source: 'adapter' },
      {
        key: 'job_application_veteran_status',
        path: 'eeo.veteran',
        score: 100,
        action: 'fill',
        source: 'adapter',
      },
      {
        key: 'job_application_disability_status',
        path: 'eeo.disability',
        score: 100,
        action: 'fill',
        source: 'adapter',
      },
    ],
  },

  lever: {
    ats: 'lever',
    rows: [
      { key: 'name', path: 'personal.fullName', score: 98, action: 'fill', source: 'adapter' },
      { key: 'email', path: 'personal.email', score: 100, action: 'fill', source: 'adapter' },
      { key: 'phone', path: 'personal.phone', score: 100, action: 'fill', source: 'adapter' },
      { key: 'org', path: 'work[0].company', score: 98, action: 'fill', source: 'adapter' },
      { key: 'location-input', path: 'personal.address.city', score: 98, action: 'fill', source: 'adapter' },
      { key: 'urls[LinkedIn]', path: 'links.linkedin', score: 100, action: 'fill', source: 'adapter' },
      { key: 'urls[GitHub]', path: 'links.github', score: 100, action: 'fill', source: 'adapter' },
      { key: 'urls[Portfolio]', path: 'links.portfolio', score: 100, action: 'fill', source: 'adapter' },
      { key: 'resume-upload-input', path: 'resume', score: 100, action: 'fill', source: 'adapter' },
      {
        key: 'cards[b7c1][field0]',
        path: 'answers.whyCompany',
        score: 95,
        action: 'fill',
        source: 'heuristic',
      },
      { key: 'comments', path: 'answers.additionalInfo', score: 95, action: 'fill', source: 'heuristic' },
      { key: 'eeo-gender', path: 'eeo.gender', score: 100, action: 'fill', source: 'adapter' },
      { key: 'eeo-race', path: 'eeo.ethnicity', score: 100, action: 'fill', source: 'adapter' },
      { key: 'eeo-veteran', path: 'eeo.veteran', score: 100, action: 'fill', source: 'adapter' },
      { key: 'eeo-disability', path: 'eeo.disability', score: 100, action: 'fill', source: 'adapter' },
    ],
  },

  workday: {
    ats: 'workday',
    rows: [
      // No adapter selector for the source typeahead — the exact label synonym carries it (90),
      // plus combobox agreement (5).
      { key: 'searchBox', path: 'answers.howDidYouHear', score: 95, action: 'fill', source: 'heuristic' },
      {
        key: 'legalNameSection_firstName',
        path: 'personal.firstName',
        score: 98,
        action: 'fill',
        source: 'adapter',
      },
      {
        key: 'legalNameSection_lastName',
        path: 'personal.lastName',
        score: 98,
        action: 'fill',
        source: 'adapter',
      },
      { key: 'countryDropdown', path: 'personal.address.country', score: 100, action: 'fill', source: 'adapter' },
      {
        key: 'addressSection_addressLine1',
        path: 'personal.address.line1',
        score: 98,
        action: 'fill',
        source: 'adapter',
      },
      {
        key: 'addressSection_addressLine2',
        path: 'personal.address.line2',
        score: 98,
        action: 'fill',
        source: 'adapter',
      },
      { key: 'addressSection_city', path: 'personal.address.city', score: 98, action: 'fill', source: 'adapter' },
      {
        key: 'addressSection_countryRegion',
        path: 'personal.address.state',
        score: 100,
        action: 'fill',
        source: 'adapter',
      },
      {
        key: 'addressSection_postalCode',
        path: 'personal.address.postalCode',
        score: 98,
        action: 'fill',
        source: 'adapter',
      },
      { key: 'email', path: 'personal.email', score: 98, action: 'fill', source: 'adapter' },
      { key: 'phone-number', path: 'personal.phone', score: 98, action: 'fill', source: 'adapter' },
      // "Have you previously worked for <employer>?" answers nothing in the vault. No signal above
      // the floor ⇒ 0 ⇒ skip + flag, exactly as SEC 6.3's last row requires.
      { key: 'previousWorker', path: null, score: 0, action: 'skip', source: 'heuristic' },
      { key: 'file-upload-input-ref', path: 'resume', score: 100, action: 'fill', source: 'adapter' },
      // Pre-rendered next step — see the file header on the happy-dom layout limit.
      { key: 'jobTitle', path: 'work[0].title', score: 98, action: 'fill', source: 'adapter' },
      { key: 'company', path: 'work[0].company', score: 98, action: 'fill', source: 'adapter' },
    ],
  },

  ashby: {
    ats: 'ashby',
    rows: [
      { key: '_systemfield_name', path: 'personal.fullName', score: 98, action: 'fill', source: 'adapter' },
      { key: '_systemfield_email', path: 'personal.email', score: 100, action: 'fill', source: 'adapter' },
      { key: '_systemfield_phone', path: 'personal.phone', score: 100, action: 'fill', source: 'adapter' },
      {
        key: '_systemfield_location',
        path: 'personal.address.city',
        score: 98,
        action: 'fill',
        source: 'adapter',
      },
      { key: '_systemfield_resume', path: 'resume', score: 100, action: 'fill', source: 'adapter' },
      { key: '_systemfield_linkedin', path: 'links.linkedin', score: 100, action: 'fill', source: 'adapter' },
      { key: '_systemfield_website', path: 'links.portfolio', score: 100, action: 'fill', source: 'adapter' },
      { key: ':r7:', path: 'answers.whyCompany', score: 95, action: 'fill', source: 'heuristic' },
      { key: ':r9:', path: 'compensation.expected.amount', score: 90, action: 'fill', source: 'heuristic' },
      { key: 'a1c93e00', path: 'authorization.authorizedIn', score: 95, action: 'fill', source: 'heuristic' },
    ],
  },

  generic: {
    ats: 'generic',
    rows: [
      { key: 'applicant-first', path: 'personal.firstName', score: 95, action: 'fill', source: 'autocomplete' },
      { key: 'applicant-last', path: 'personal.lastName', score: 95, action: 'fill', source: 'autocomplete' },
      { key: 'applicant-email', path: 'personal.email', score: 100, action: 'fill', source: 'autocomplete' },
      // 95 + 5 (email agreement) − 30 (personal.email already filled) = 70. Still a fill, which is
      // right for a confirm-email box, and the −30 is visible as the 30-point drop from 100.
      {
        key: 'applicant-email-confirm',
        path: 'personal.email',
        score: 70,
        action: 'fill',
        source: 'autocomplete',
      },
      { key: 'applicant-phone', path: 'personal.phone', score: 100, action: 'fill', source: 'autocomplete' },
      {
        key: 'applicant-city',
        path: 'personal.address.city',
        score: 95,
        action: 'fill',
        source: 'autocomplete',
      },
      {
        key: 'applicant-country',
        path: 'personal.address.country',
        score: 100,
        action: 'fill',
        source: 'autocomplete',
      },
      { key: 'applicant-linkedin', path: 'links.linkedin', score: 95, action: 'fill', source: 'heuristic' },
      { key: 'applicant-github', path: 'links.github', score: 95, action: 'fill', source: 'heuristic' },
      // "Upload your CV" — de-noised to "cv", an exact alias of the `resume` file target
      // (`matcher.FILE_TARGET_SYNONYMS`), + 5 for input-type agreement. Before that vocabulary
      // existed the only thing left here was a weak fuzzy hit on `personal.fullName` (25, skip):
      // the correct outcome given the choice, but it meant F-05 could not attach a resume on any
      // page without a dedicated adapter, which is most of the web.
      { key: 'applicant-cv', path: 'resume', score: 95, action: 'fill', source: 'heuristic' },
      {
        key: 'applicant-cover-letter',
        path: 'answers.coverLetter',
        score: 95,
        action: 'fill',
        source: 'heuristic',
      },
      {
        key: 'applicant-notice',
        path: 'compensation.noticePeriodDays',
        score: 55,
        action: 'suggest',
        source: 'heuristic',
      },
      { key: 'reference-name', path: 'personal.fullName', score: 40, action: 'skip', source: 'heuristic' },
      { key: 'reference-email', path: 'personal.email', score: 45, action: 'skip', source: 'heuristic' },
      {
        key: 'reference-relationship',
        path: 'answers.references',
        score: 55,
        action: 'suggest',
        source: 'heuristic',
      },
    ],
  },
};

/* ------------------------------------------------------------------------------------------------
 * The golden assertions
 * ---------------------------------------------------------------------------------------------- */

describe('golden expectations per fixture (SEC 6.3 / SEC 11)', () => {
  for (const id of Object.keys(FIXTURES) as FixtureId[]) {
    const expected = GOLDEN[id];

    describe(id, () => {
      it('detects the right adapter', () => {
        expect(runFixture(id).atsId).toBe(expected.ats);
      });

      it('matches the golden (field → path, score, action) table exactly', () => {
        expect(runFixture(id).rows).toEqual([...expected.rows]);
      });

      it('drops honeypots and never surfaces a submit control as a field', () => {
        const { nodes } = runFixture(id);
        const keys = nodes.map(keyOf);
        expect(keys).not.toContain('leave_this_blank');
        expect(keys).not.toContain('url_trap');
        expect(keys).not.toContain('submit_app');
        expect(keys).not.toContain('send-application');
      });
    });
  }

  it('the corpus covers all five adapters', () => {
    const detected = (Object.keys(FIXTURES) as FixtureId[]).map((id) => runFixture(id).atsId);
    expect(new Set(detected)).toEqual(new Set(['greenhouse', 'lever', 'workday', 'ashby', 'generic']));
  });
});

/* ------------------------------------------------------------------------------------------------
 * INV-4 — never guess-fill
 * ---------------------------------------------------------------------------------------------- */

describe('INV-4 · ≥70 fill · 50–69 suggest · <50 skip', () => {
  it('nothing below 50 is EVER actioned as fill, on any fixture', () => {
    for (const id of Object.keys(FIXTURES) as FixtureId[]) {
      const offenders = runFixture(id).results.filter(
        (result) => result.score < SUGGEST_THRESHOLD && result.action === 'fill',
      );
      expect(offenders.map((o) => `${id}:${keyOf(o.node)}@${o.score}`)).toEqual([]);
    }
  });

  it('the band boundaries are respected in both directions', () => {
    for (const id of Object.keys(FIXTURES) as FixtureId[]) {
      for (const result of runFixture(id).results) {
        if (result.score >= FILL_THRESHOLD) expect(result.action).toBe('fill');
        else if (result.score >= SUGGEST_THRESHOLD) expect(result.action).toBe('suggest');
        else expect(result.action).toBe('skip');
      }
    }
  });

  it('a skipped field carries no path it would have written', () => {
    const { results } = runFixture('workday');
    const noSignal = results.find((result) => keyOf(result.node) === 'previousWorker');
    expect(noSignal?.path).toBeNull();
    expect(noSignal?.score).toBe(0);
    expect(noSignal?.action).toBe('skip');
  });

  it('a path the vault cannot answer is demoted from fill to suggest', () => {
    // `requireValue` on (the production default) + a vault with nothing in it.
    const doc = loadFixture('greenhouse');
    const adapter = getAdapter('greenhouse');
    const nodes = scanForms(doc).fields;
    const matcher = new FieldMatcher({
      profile: makeEmptyProfile(),
      adapterFieldMap: adapter.fieldMap(),
    });
    const results = matcher.match(nodes);

    const firstName = results.find((result) => keyOf(result.node) === 'first_name');
    expect(firstName?.score).toBe(98);
    // The score is unchanged — the DEMOTION is an action-level decision, not a scoring one.
    expect(firstName?.action).toBe('suggest');

    const explanation = matcher.explain(
      nodes.find((node) => keyOf(node) === 'first_name') as FieldNode,
      new Set(),
    );
    expect(explanation.modifiers.map((m) => m.id)).toContain('empty-value');
  });

  /**
   * The empty-value demotion is about EVIDENCE, and a file field supplies none either way.
   *
   * `resume` is a derived path (SEC 6.5) whose value is deliberately not in the vault: SEC 7.1 puts
   * resume bytes in IndexedDB because they are megabytes, so `hasValue('resume')` is false on every
   * profile that has ever existed — including a complete one. Treating that as "the profile cannot
   * answer this" demoted every file field on every adapter to `suggest` before the engine could
   * dispatch, which made F-05 unreachable rather than merely unused.
   *
   * INV-4 is still whole. Reaching the engine is not permission to invent an attachment:
   * `core/fill/strategies/file.ts` returns `no-resume` when nothing is stored (the field is then
   * SKIPPED and flagged for the human), and a write only counts as `filled` once `input.files`
   * or the page's own filename chip proves it landed.
   */
  it('a file field is exempt from the empty-value demotion — its bytes live in IndexedDB', () => {
    const withValueCheck = runFixture('greenhouse', { requireValue: true });
    const resume = withValueCheck.results.find((result) => keyOf(result.node) === 'resume');
    expect(resume?.path).toBe('resume');
    expect(resume?.node.sig.inputType).toBe('file');
    expect(resume?.score).toBe(100);
    expect(resume?.action).toBe('fill');

    const explanation = withValueCheck.matcher.explain(
      withValueCheck.nodes.find((node) => keyOf(node) === 'resume') as FieldNode,
      new Set(),
    );
    expect(explanation.modifiers.map((m) => m.id)).not.toContain('empty-value');
  });

  /** …and the exemption is exactly that narrow: a TEXT field with no vault value still demotes. */
  it('the exemption does not leak to text fields on the same form', () => {
    const doc = loadFixture('greenhouse');
    const adapter = getAdapter('greenhouse');
    const nodes = scanForms(doc).fields;
    const matcher = new FieldMatcher({
      profile: makeEmptyProfile(),
      adapterFieldMap: adapter.fieldMap(),
    });
    const results = matcher.match(nodes);

    const email = results.find((result) => keyOf(result.node) === 'email');
    expect(email?.node.sig.inputType).not.toBe('file');
    expect(email?.action).toBe('suggest');
  });
});

/* ------------------------------------------------------------------------------------------------
 * The three modifiers, asserted individually
 * ---------------------------------------------------------------------------------------------- */

describe('SEC 6.3 modifiers', () => {
  it('−20 · a "Name" under a References heading loses twenty points', () => {
    const { nodes, matcher } = runFixture('generic');
    const node = nodes.find((n) => keyOf(n) === 'reference-name');
    expect(node).toBeDefined();
    if (node === undefined) return;

    expect(node.sig.sectionHeading).toBe('References');

    // Scored on its own, with nothing yet consumed: 90 − 20 = 70.
    const alone = matcher.explain(node, new Set());
    expect(alone.base).toBe(SCORE.exactLabelSynonym);
    expect(alone.path).toBe('personal.fullName');
    expect(alone.modifiers.find((m) => m.id.startsWith('conflicting-section'))?.delta).toBe(
      SCORE_MODIFIER.conflictingSection,
    );
    expect(alone.score).toBe(SCORE.exactLabelSynonym + SCORE_MODIFIER.conflictingSection);

    // The identical label OUTSIDE a References section keeps all ninety.
    unloadFixture();
    document.body.innerHTML = `
      <h3>Personal Information</h3>
      <label for="n">Name</label><input id="n" name="reference_name" />
    `;
    const clean = document.querySelector('#n');
    expect(clean).not.toBeNull();
    if (clean === null) return;
    const cleanNodes = scanForms(document).fields;
    const cleanNode = cleanNodes.find((n) => n.sig.id === 'n');
    expect(cleanNode).toBeDefined();
    if (cleanNode === undefined) return;
    expect(new FieldMatcher({ requireValue: false }).explain(cleanNode, new Set()).score).toBe(
      SCORE.exactLabelSynonym,
    );
  });

  it('−30 · a profile path already filled in this form loses thirty points', () => {
    const { nodes, matcher } = runFixture('generic');
    const confirm = nodes.find((n) => keyOf(n) === 'applicant-email-confirm');
    expect(confirm).toBeDefined();
    if (confirm === undefined) return;

    const fresh = matcher.explain(confirm, new Set());
    const duplicate = matcher.explain(confirm, new Set<ProfilePath>(['personal.email']));

    expect(fresh.score).toBe(100); // 95 + 5, clamped
    expect(duplicate.score).toBe(70); // 95 + 5 − 30
    expect(fresh.score - duplicate.score).toBe(-SCORE_MODIFIER.duplicatePath);
    expect(duplicate.modifiers.find((m) => m.id === 'duplicate-path')?.delta).toBe(
      SCORE_MODIFIER.duplicatePath,
    );
  });

  it('−30 · filling first + last name consumes the derived full-name path', () => {
    const { results } = runFixture('greenhouse');
    const reference = results.find(
      (r) => keyOf(r.node) === 'job_application_answers_attributes_3_text_value',
    );
    // 90 − 20 (References) − 30 (personal.fullName consumed by firstName/lastName) = 40.
    expect(reference?.score).toBe(40);
    expect(reference?.action).toBe('skip');
  });

  it('the duplicate modifier is scoped PER FORM, not per page', () => {
    unloadFixture();
    document.body.innerHTML = `
      <form id="a"><label for="e1">Email</label><input id="e1" type="email" name="email" /></form>
      <form id="b"><label for="e2">Email</label><input id="e2" type="email" name="email" /></form>
    `;
    const results = new FieldMatcher({ requireValue: false }).match(scanForms(document).fields);
    expect(results).toHaveLength(2);
    expect(results[0]?.score).toBe(95);
    expect(results[1]?.score).toBe(95);
  });

  it('+5 · input-type agreement', () => {
    const { nodes, matcher } = runFixture('generic');
    const linkedin = nodes.find((n) => keyOf(n) === 'applicant-linkedin');
    expect(linkedin).toBeDefined();
    if (linkedin === undefined) return;

    const explanation = matcher.explain(linkedin, new Set());
    expect(linkedin.sig.inputType).toBe('url');
    expect(explanation.base).toBe(SCORE.exactLabelSynonym);
    expect(explanation.modifiers.find((m) => m.id === 'input-type-agreement')?.delta).toBe(
      SCORE_MODIFIER.inputTypeAgreement,
    );
    expect(explanation.score).toBe(SCORE.exactLabelSynonym + SCORE_MODIFIER.inputTypeAgreement);
  });

  it('+5 · is NOT handed out for a plain text input', () => {
    const { nodes, matcher } = runFixture('workday');
    const city = nodes.find((n) => keyOf(n) === 'addressSection_city');
    expect(city).toBeDefined();
    if (city === undefined) return;
    expect(city.sig.inputType).toBe('text');
    expect(matcher.explain(city, new Set()).modifiers.map((m) => m.id)).not.toContain(
      'input-type-agreement',
    );
  });
});

/* ------------------------------------------------------------------------------------------------
 * Order of authority
 * ---------------------------------------------------------------------------------------------- */

describe('SEC 6.3 order of authority — the first confident tier wins', () => {
  function scoreWith(context: ConstructorParameters<typeof FieldMatcher>[0]): MatchResult {
    const doc = loadFixture('generic');
    const nodes = scanForms(doc).fields;
    const node = nodes.find((n) => keyOf(n) === 'applicant-first');
    if (node === undefined) throw new Error('applicant-first missing from the generic fixture');
    return new FieldMatcher({ requireValue: false, ...context }).matchOne(node);
  }

  it('autocomplete (95) beats the exact label synonym (90)', () => {
    const result = scoreWith({});
    expect(result.source).toBe('autocomplete');
    expect(result.score).toBe(SCORE.autocomplete);
  });

  it('an adapter field map (98) beats autocomplete', () => {
    const result = scoreWith({ adapterFieldMap: { '#applicant-first': 'personal.firstName' } });
    expect(result.source).toBe('adapter');
    expect(result.score).toBe(SCORE.adapter);
  });

  it('a saved user mapping (100) beats everything — F-13 learn-from-correction', () => {
    const doc = loadFixture('generic');
    const node = scanForms(doc).fields.find((n) => keyOf(n) === 'applicant-first');
    expect(node).toBeDefined();
    if (node === undefined) return;

    const result = new FieldMatcher({
      requireValue: false,
      adapterFieldMap: { '#applicant-first': 'personal.lastName' },
      userMappings: { [node.sig.hash]: 'links.portfolio' },
    }).matchOne(node);

    expect(result.source).toBe('user-mapping');
    expect(result.score).toBe(SCORE.userMapping);
    expect(result.path).toBe('links.portfolio');
  });

  it('the longest adapter selector wins, as a stand-in for CSS specificity', () => {
    const doc = loadFixture('greenhouse');
    const node = scanForms(doc).fields.find((n) => keyOf(n) === 'resume');
    expect(node).toBeDefined();
    if (node === undefined) return;

    const result = new FieldMatcher({
      requireValue: false,
      adapterFieldMap: {
        'input[type="file"]': 'coverLetter',
        '#resume_fieldset input[type="file"]': 'resume',
      },
    }).matchOne(node);
    expect(result.path).toBe('resume');
  });
});
