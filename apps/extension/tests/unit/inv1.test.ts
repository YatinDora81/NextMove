/**
 * tests/unit/inv1.test.ts — JF-001 Rev 3.0 · INV-1, asserted two ways.
 *
 *   INV-1  "Never auto-submit. No code path may call `.click()`/`.submit()` on a submit or
 *          'next step' button. Locate + highlight only."
 *
 * This is the invariant a Chrome Web Store reviewer will look for and the one whose violation
 * would be genuinely harmful to a user: a half-filled application fired off without them.
 * Testing it once, in one place, is not enough, so it is tested twice from opposite directions:
 *
 *   STRUCTURALLY.  Every source file under `core/fill/**`, `core/adapters/**`, `content/**` and
 *                  the two content-script entrypoints is read from disk and asserted against:
 *                  nothing calls `form.submit()` / `form.requestSubmit()`, and every file that
 *                  calls `.click()` at all carries the submit guard on the same code path.
 *                  A grep-shaped test catches a regression the moment it is *written*, before any
 *                  runtime path has to be reached to prove it.
 *
 *   BEHAVIOURALLY. The real FillEngine is run over the real Greenhouse fixture with
 *                  `HTMLElement.prototype.click`, `HTMLFormElement.prototype.submit` and
 *                  `requestSubmit` all spied. The submit button must come out cold. Then the
 *                  hostile case: a hand-crafted `MatchResult` that points the engine straight at
 *                  `#submit_app` with `action: 'fill'` and a score of 100 — the engine must refuse
 *                  it and report a skip.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAdapter } from '@/core/adapters';
import { FieldMatcher } from '@/core/matcher';
import {
  FillEngine,
  isSubmitControl,
  isForbiddenClickTarget,
  assertNotSubmitControl,
  SubmitControlError,
  type FillFieldEvent,
} from '@/core/fill';
import { click as bridgeClick } from '@/core/fill/bridge';
import { scanForms } from '@/core/scanner';
import { buildFieldSignature } from '@/core/signature';
import type { FieldNode, FillReport, MatchResult } from '@/shared/types';

import { FIXTURES, FIXTURE_URLS, loadFixture, makeProfile, type FixtureId } from '../setup';

/* ------------------------------------------------------------------------------------------------
 * Structural half — read the source, assert the guards exist
 * ---------------------------------------------------------------------------------------------- */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/** The trees that are allowed to touch the page at all. */
const AUDITED_ROOTS: readonly string[] = [
  join(SRC, 'core', 'fill'),
  join(SRC, 'core', 'adapters'),
  join(SRC, 'content'),
];

const AUDITED_FILES: readonly string[] = [
  join(SRC, 'core', 'observer.ts'),
  join(SRC, 'entrypoints', 'content.ts'),
  join(SRC, 'entrypoints', 'main-world.content.ts'),
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const AUDITED: readonly string[] = [...AUDITED_ROOTS.flatMap(walk), ...AUDITED_FILES];

/** Strip block and line comments so a prose mention of `.click()` is not read as a call. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('INV-1 · structural audit of every file that can touch the page', () => {
  it('the audit actually found the source tree (guards against a silent empty run)', () => {
    expect(AUDITED.length).toBeGreaterThan(15);
    expect(AUDITED.some((file) => file.endsWith('main-world.content.ts'))).toBe(true);
    expect(AUDITED.some((file) => file.endsWith(join('fill', 'index.ts')))).toBe(true);
  });

  for (const file of AUDITED) {
    const name = relative(SRC, file);

    it(`${name} never submits a form`, () => {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(code, `${name} calls form.submit()`).not.toMatch(/\.\s*submit\s*\(/);
      expect(code, `${name} calls form.requestSubmit()`).not.toMatch(/requestSubmit\s*\(/);
      // `HTMLFormElement.prototype.submit` cannot be reached indirectly either.
      expect(code, `${name} reaches for HTMLFormElement.prototype`).not.toMatch(
        /HTMLFormElement\s*\.\s*prototype/,
      );
    });

    it(`${name} guards every click it performs`, () => {
      const code = stripComments(readFileSync(file, 'utf8'));
      const clicks = code.match(/\.\s*click\s*\(/g) ?? [];
      if (clicks.length === 0) return;

      // A file that clicks must carry the guard itself — either by asserting, by testing, or by
      // routing the click through `bridge.click`, which asserts on both sides of the world split.
      const guarded =
        /assertNotSubmitControl\s*\(/.test(code) ||
        /isSubmitControl\s*\(/.test(code) ||
        /isForbiddenClickTarget\s*\(/.test(code);

      expect(guarded, `${name} calls .click() with no submit guard in the file`).toBe(true);
    });
  }

  it('the guard itself recognises every shape of submit control', () => {
    document.body.innerHTML = `
      <form>
        <input type="submit" id="a" value="Submit Application" />
        <input type="image" id="b" />
        <button type="submit" id="c">Go</button>
        <button id="d">Submit application</button>
        <button id="e" formaction="/apply">Continue</button>
        <div role="button" id="f">Send application</div>
        <input type="button" id="g" value="Submit" />
        <a id="h" role="button">Apply now</a>
        <button type="button" id="ok">Add another employer</button>
        <input type="text" id="text" />
        <input type="radio" id="radio" name="r" />
      </form>
    `;
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const el = document.getElementById(id);
      expect(el, `#${id} missing`).not.toBeNull();
      if (el !== null) expect(isSubmitControl(el), `#${id} should be a submit control`).toBe(true);
    }
    for (const id of ['ok', 'text', 'radio']) {
      const el = document.getElementById(id);
      if (el !== null) expect(isSubmitControl(el), `#${id} is not a submit control`).toBe(false);
    }
  });

  it('assertNotSubmitControl throws a typed error the strategies can convert', () => {
    document.body.innerHTML = `<button type="submit" id="s">Submit</button>`;
    const el = document.getElementById('s');
    expect(el).not.toBeNull();
    if (el === null) return;
    expect(() => assertNotSubmitControl(el, 'fill')).toThrow(SubmitControlError);
    expect(() => assertNotSubmitControl(document.body, 'fill')).not.toThrow();
  });

  it('every adapter declares its submit/next controls so the overlay can HIGHLIGHT them', () => {
    for (const id of ['greenhouse', 'lever', 'workday', 'ashby', 'generic'] as const) {
      const adapter = getAdapter(id);
      expect(adapter.quirks?.submitSelectors?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('an adapter `nextButton` LOCATES the control and returns it — it does not press it', () => {
    const doc = loadFixture('workday');
    const clickSpy = vi.spyOn(HTMLElement.prototype, 'click');

    const next = getAdapter('workday').steps?.nextButton?.(doc) ?? null;
    expect(next).not.toBeNull();
    expect(next?.getAttribute('data-automation-id')).toBe('bottom-navigation-next-button');
    expect(clickSpy).not.toHaveBeenCalled();

    clickSpy.mockRestore();
  });
});

/* ------------------------------------------------------------------------------------------------
 * Behavioural half — run the real engine and watch the submit button
 * ---------------------------------------------------------------------------------------------- */

interface Spies {
  click: ReturnType<typeof vi.spyOn>;
  submit: ReturnType<typeof vi.fn>;
  requestSubmit: ReturnType<typeof vi.fn>;
  clickedElements: Element[];
}

let spies: Spies | null = null;

beforeEach(() => {
  const clickedElements: Element[] = [];
  // Record every click AND let it happen. Swallowing the click would make the INV-1 assertions
  // vacuously safe (nothing can submit if nothing is ever really clicked) and would break every
  // assertion about a click's *effect* — a radio can only become `checked` if the click lands.
  // INV-1 is still fully observable: `clickedElements` is filtered through `isSubmitControl`.
  // Real submission stays impossible regardless: `submit`/`requestSubmit` are mocked out below.
  const nativeClick = HTMLElement.prototype.click;
  const click = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(function (
    this: HTMLElement,
  ) {
    clickedElements.push(this);
    nativeClick.call(this);
  });

  const submit = vi.fn();
  const requestSubmit = vi.fn();
  // happy-dom's HTMLFormElement may not implement requestSubmit; define both unconditionally.
  Object.defineProperty(HTMLFormElement.prototype, 'submit', {
    value: submit,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(HTMLFormElement.prototype, 'requestSubmit', {
    value: requestSubmit,
    configurable: true,
    writable: true,
  });

  spies = { click, submit, requestSubmit, clickedElements };
});

afterEach(() => {
  spies?.click.mockRestore();
  spies = null;
  vi.restoreAllMocks();
});

/** Run the production fill path over a fixture, entirely in the isolated world. */
async function fillFixture(id: FixtureId): Promise<{
  nodes: FieldNode[];
  matches: MatchResult[];
  report: FillReport;
  /** Per-field events — the only channel carrying `reason` and `path` (SEC 6.2 keeps them off the report). */
  events: FillFieldEvent[];
}> {
  const doc = loadFixture(id);
  const url = FIXTURE_URLS[id];
  const adapter = getAdapter(id === 'generic' ? 'generic' : id);
  const nodes = scanForms(doc).fields;
  const matches = new FieldMatcher({
    profile: makeProfile(),
    adapterFieldMap: adapter.fieldMap(),
    requireValue: false,
  }).match(nodes);

  const events: FillFieldEvent[] = [];
  const report = await new FillEngine({
    profile: makeProfile(),
    atsId: id === 'generic' ? 'generic' : id,
    url,
    quirks: adapter.quirks,
    humanPacing: false,
    preferLocal: true, // no MAIN-world bridge under happy-dom
    onField: (event) => events.push(event),
  }).run(matches);

  return { nodes, matches, report, events };
}

describe('INV-1 · a real fill run never presses anything that submits', () => {
  for (const id of Object.keys(FIXTURES) as FixtureId[]) {
    it(`${id}: the submit / next control is never clicked`, async () => {
      const { report } = await fillFixture(id);
      const current = spies;
      expect(current).not.toBeNull();
      if (current === null) return;

      // Guard against a vacuous pass: the engine must actually have done work on this fixture.
      expect(report.filled + report.suggested, `${id} produced an empty run`).toBeGreaterThan(0);

      const forbidden = current.clickedElements.filter((el) => isSubmitControl(el));
      expect(
        forbidden.map((el) => el.outerHTML.slice(0, 120)),
        'a submit-shaped control was clicked',
      ).toEqual([]);

      expect(current.submit).not.toHaveBeenCalled();
      expect(current.requestSubmit).not.toHaveBeenCalled();
    });
  }

  it('greenhouse: #submit_app specifically is never touched', async () => {
    await fillFixture('greenhouse');
    const submitButton = document.getElementById('submit_app');
    expect(submitButton).not.toBeNull();
    expect(spies?.clickedElements).not.toContain(submitButton);
  });

  it('lever: the submit <button> is never touched', async () => {
    await fillFixture('lever');
    const submitButton = document.querySelector('button[type="submit"]');
    expect(submitButton).not.toBeNull();
    expect(spies?.clickedElements).not.toContain(submitButton);
  });

  it('workday: "Save and Continue" is never touched — a wizard advance commits answers', async () => {
    await fillFixture('workday');
    const next = document.querySelector('[data-automation-id="bottom-navigation-next-button"]');
    expect(next).not.toBeNull();
    expect(spies?.clickedElements).not.toContain(next);
  });

  it('HOSTILE: a match that points at the submit button is refused, not obeyed', async () => {
    const doc = loadFixture('greenhouse');
    const submitButton = doc.getElementById('submit_app');
    expect(submitButton).not.toBeNull();
    if (submitButton === null) return;

    // A deliberately corrupt match: maximum score, action `fill`, target = the submit control.
    const node: FieldNode = {
      el: submitButton,
      sig: buildFieldSignature(submitButton, 0),
      visible: true,
      required: false,
    };
    const hostile: MatchResult = {
      node,
      path: 'personal.firstName',
      score: 100,
      source: 'user-mapping',
      action: 'fill',
    };

    const report = await new FillEngine({
      profile: makeProfile(),
      atsId: 'greenhouse',
      url: FIXTURE_URLS.greenhouse,
      humanPacing: false,
      preferLocal: true,
    }).run([hostile]);

    expect(report.filled).toBe(0);
    expect(report.skipped).toBe(1);
    expect(report.perField[0]).toEqual({ hash: node.sig.hash, action: 'skip', ok: false });
    expect(spies?.clickedElements).not.toContain(submitButton);
    expect(spies?.submit).not.toHaveBeenCalled();
  });

  it('the clicks that DO happen are only ever choice controls', async () => {
    // The Ashby fixture carries a Yes/No work-authorization radio group, which the choice strategy
    // legitimately clicks. Every click in a whole run must be one of those shapes.
    const { report } = await fillFixture('ashby');
    const current = spies;
    expect(current).not.toBeNull();
    if (current === null) return;

    expect(report.filled + report.suggested).toBeGreaterThan(0);

    // NOTE: today this list is empty on every fixture, because the only click-driven field in the
    // corpus (Ashby's Yes/No work-authorization radio) never resolves a value — see the KNOWN GAPS
    // block at the end of this file. The shape assertion below is kept because it is the guard that
    // must hold the moment that gap is closed.
    for (const el of current.clickedElements) {
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') ?? '').toLowerCase();
      const role = (el.getAttribute('role') ?? '').toLowerCase();
      const legitimate =
        (tag === 'input' && (type === 'radio' || type === 'checkbox')) ||
        tag === 'label' ||
        tag === 'li' ||
        role === 'radio' ||
        role === 'checkbox' ||
        role === 'option' ||
        role === 'switch';
      expect(legitimate, `unexpected click target: ${el.outerHTML.slice(0, 120)}`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------------------------------------
 * KNOWN GAPS — found by running the engine over the corpus. Reported, NOT patched.
 *
 * These are defects in `src/core/fill/**` (owner: E3) and in the `FillQuirks` contract shared with
 * `src/core/adapters/**` (owner: E4). They are written as executable regression tests and left
 * un-skipped: all three fixes have landed (see core/fill/index.ts resolveValue and
 * core/fill/types.ts isFillQuirks). None of them is an INV-1
 * violation, and none of them is mine to fix.
 * ---------------------------------------------------------------------------------------------- */

describe('REGRESSIONS · fill-engine defects found by this suite and since fixed', () => {
  /**
   * `core/fill/index.ts::resolveValue` reads the vault with a LITERAL `getByPath`, so it cannot
   * resolve the SEC 6.2 virtual paths that `core/matcher.ts::resolveProfileValue` defines and that
   * `core/adapters/types.ts::DERIVED_PATHS.fullName` deliberately produces:
   *
   *     personal.fullName             → firstName + ' ' + lastName
   *     answers.<slug>                → the best entry in profile.answers[]
   *     authorization.authorizedIn    → boolean
   *     authorization.needsSponsorship→ boolean
   *
   * Effect: Lever and Ashby both ask for ONE combined name and both map to `personal.fullName`, so
   * the single most important field on those two ATS is reported `skip / no-value` on every run.
   * Expected `resolveValue(profile, 'personal.fullName')` = `'Asha Varma'`; actual `null`.
   */
  it('resolveValue resolves the SEC 6.2 virtual paths (owner: E3, core/fill/index.ts)', async () => {
    const { report, matches, events } = await fillFixture('ashby');

    // The actual regression: a virtual path must never resolve to nothing. `no-value` is the
    // reason the engine reports when the vault read came back empty, which is exactly what the
    // old literal `getByPath` produced for personal.fullName / answers.* / authorization.*.
    // `FillReport.perField` deliberately carries no reason (SEC 6.2), so this reads the richer
    // `onField` event stream instead — asserting on `perField.reason` would be vacuous.
    // Non-vacuity: an empty stream would make the filter below pass for the wrong reason.
    expect(events.length, 'onField emitted nothing — the assertion below would be vacuous').toBeGreaterThan(8);
    expect(
      events.filter((e) => e.reason === 'no-value').map((e) => e.path),
      'a SEC 6.2 virtual path resolved to nothing',
    ).toEqual([]);

    // Ashby's single combined-name control maps to `personal.fullName`; it is the field this
    // whole regression was about, so assert it specifically rather than trusting a total.
    const nameMatch = matches.find((m) => m.path === 'personal.fullName');
    expect(nameMatch, 'ashby should map its combined name field to personal.fullName').toBeDefined();
    const nameField = report.perField.find((f) => f.hash === nameMatch?.node.sig.hash);
    expect(nameField?.action).toBe('fill');
    expect(nameField?.ok).toBe(true);

    expect(report.filled).toBeGreaterThanOrEqual(8);

    // Deliberately NOT asserted: `skipped === 0`. Two fields legitimately do not fill here and
    // neither is a defect:
    //   · `_systemfield_location` is a typeahead. happy-dom never renders the listbox, so the
    //     commit cannot be verified and SEC 6.4 requires the honest downgrade to `suggest`.
    //   · `_systemfield_resume` is a file input and this run supplies no ResumeAttachment.
    // Both are covered at the Playwright layer, where a listbox actually renders.
  });

  /**
   * The same gap seen from the radio side. `authorization.authorizedIn` resolves to the raw array
   * `['IN']` instead of the boolean the question asks for, and nothing runs
   * `core/matcher.ts::formatValueForField` to turn a boolean into the page's own "Yes"/"No" option
   * text, so `fillChoice` reports `no-option-match` and clicks nothing.
   * Expected: the "Yes" radio of the Ashby work-authorization group is checked.
   */
  it('a Yes/No authorization radio is answered (owner: E3, core/fill/strategies/choice.ts)', async () => {
    await fillFixture('ashby');
    const yes = document.getElementById('auth-yes') as HTMLInputElement | null;
    expect(yes?.checked).toBe(true);
  });

  /**
   * Two different interfaces are both named `FillQuirks`:
   *   `core/adapters/types.ts` — dateFormat, typeaheadDelayMs: number, listboxWaitMs,
   *                              dropzoneSelectors, submitSelectors, stepContainerSelector
   *   `core/fill/types.ts`     — dateFormat, typeaheadDelayMs: JitterRange, listboxWaitMs,
   *                              fillJitterMs, verifyDelayMs, dropzoneSelectors,
   *                              listboxSelectors, optionSelectors, typeTextFields
   *
   * `core/fill/types.ts::isFillQuirks` only checks `dateFormat: string` + `listboxWaitMs: number`,
   * so it accepts the ADAPTER shape and `readQuirks()` is skipped. `ctx.quirks.listboxSelectors` is
   * then `undefined` and `strategies/combobox.ts::uniqueSelectors` throws
   * `"extra is not iterable"` on the first typeahead.
   *
   * This is the production path, not a test artefact: `entrypoints/content.ts` passes
   * `config.quirks` straight from `registry.resolveFillQuirks()`, which returns the adapter shape.
   * Effect: every combobox/typeahead field (Greenhouse location, Lever location, Workday source,
   * Ashby location) fails with an error instead of filling.
   */
  it('adapter quirks survive the FillEngine boundary (owner: E3/E4, isFillQuirks)', async () => {
    const { report } = await fillFixture('ashby');
    expect(report.errors).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------------------
 * INV-1 · the two halves of the bridge must refuse the SAME things
 *
 * Regression for a real defect: `entrypoints/main-world.content.ts` refused submit controls, wizard
 * advance buttons ("Next", "Continue", "Save and Continue") and real navigation links, while
 * `core/fill/dom.ts` only refused submit controls. `bridge.click()` falls back to the ISOLATED path
 * whenever the MAIN call fails — including when it failed *because MAIN refused on INV-1 grounds* —
 * so the strong guard's refusal was laundered through the weak one and the control got clicked.
 * Advancing a Workday step commits the answers on that page, which is exactly what INV-1 forbids.
 * ---------------------------------------------------------------------------------------------- */

describe('INV-1 · the guard is symmetric across the world bridge', () => {
  const MAIN_WORLD = join(SRC, 'entrypoints', 'main-world.content.ts');
  const ISOLATED = join(SRC, 'core', 'fill', 'dom.ts');

  it('there is exactly ONE definition of the guard — the halves cannot drift', () => {
    // The MAIN-world script used to hand-copy this logic and claim byte-for-byte equivalence while
    // actually disagreeing: its `accessibleName` read `aria-label` before `aria-labelledby` (the
    // ISOLATED half reads them the other way round) and returned `el.value` for *any* input rather
    // than only submit/button/reset. Two guards that are supposed to agree, quietly disagreeing, is
    // exactly what produced the INV-1 hole this suite exists to prevent.
    //
    // `core/fill/dom.ts` has no imports, so the MAIN world imports it instead of copying it. This
    // asserts the copy has not come back.
    const main = readFileSync(MAIN_WORLD, 'utf8');
    const iso = readFileSync(ISOLATED, 'utf8');

    expect(iso, 'the single definition should live in core/fill/dom.ts').toMatch(
      /export function isForbiddenClickTarget/,
    );
    expect(iso).toMatch(/NEXT_NAME_RE\s*=\s*\//);

    expect(main, 'main-world must IMPORT the guard, not redefine it').toMatch(
      /import \{[\s\S]*isForbiddenClickTarget[\s\S]*\} from '@\/core\/fill\/dom'/,
    );

    const body = stripComments(main);
    for (const [label, re] of [
      ['isForbiddenClickTarget', /function\s+isForbiddenClickTarget/],
      ['isSubmitControl', /function\s+isSubmitControl/],
      ['accessibleName', /function\s+accessibleName/],
      ['NEXT_NAME_RE', /const\s+NEXT_NAME_RE/],
      ['SUBMIT_NAME_RE', /const\s+SUBMIT_NAME_RE/],
    ] as ReadonlyArray<[string, RegExp]>) {
      expect(body, `main-world re-declares ${label} — the duplicate guard is back`).not.toMatch(re);
    }
  });

  it('the ISOLATED fallback refuses wizard-advance and navigation controls', () => {
    document.body.innerHTML = `
      <form>
        <button type="button" id="next">Continue</button>
        <button type="button" id="next2">Save and Continue</button>
        <button type="button" id="next3">Next</button>
        <div role="button" id="next4">Next step</div>
        <a href="/step-2" id="link">Next</a>
        <a href="#opt" id="anchor" role="option">Bengaluru, India</a>
        <button type="button" id="ok">Add another employer</button>
        <input type="radio" id="radio" name="r" />
      </form>
    `;
    for (const id of ['next', 'next2', 'next3', 'next4', 'link']) {
      const el = document.getElementById(id);
      expect(el, `#${id} missing`).not.toBeNull();
      if (el !== null) {
        expect(isForbiddenClickTarget(el), `#${id} must be refused by the ISOLATED guard`).toBe(true);
      }
    }
    // In-page anchors used as listbox options, and ordinary buttons, stay clickable — the fill
    // engine needs them (combobox commit, "add another employer" repeaters).
    for (const id of ['anchor', 'ok', 'radio']) {
      const el = document.getElementById(id);
      if (el !== null) {
        expect(isForbiddenClickTarget(el), `#${id} must remain clickable`).toBe(false);
      }
    }
  });

  it('a MAIN-world INV-1 refusal is never retried through the local path', () => {
    // The refusal string is a contract between the two halves; if either side renames it the
    // fallback silently reopens.
    const bridge = readFileSync(join(SRC, 'core', 'fill', 'bridge.ts'), 'utf8');
    const main = readFileSync(MAIN_WORLD, 'utf8');
    expect(bridge).toMatch(/SUBMIT_REFUSED\s*=\s*'submit-control-refused'/);
    expect(main).toMatch(/'submit-control-refused'/);
    // and click() must short-circuit on it before reaching localClick
    const clickFn = bridge.slice(bridge.indexOf('export async function click('));
    const body = clickFn.slice(0, clickFn.indexOf('\n}\n'));
    expect(body, 'click() does not short-circuit on a MAIN-world refusal').toMatch(
      /result\.error === SUBMIT_REFUSED/,
    );
    expect(body.indexOf('SUBMIT_REFUSED')).toBeLessThan(body.indexOf('localClick'));
  });
});

describe('INV-1 · bridge.click() refuses advance controls in BOTH transport modes', () => {
  /**
   * The structural tests above prove the two guards agree. This proves the guard is actually
   * *reached* on the local transport — the path that a page without the MAIN-world script (or a
   * MAIN-world timeout) falls back to. Without this, removing `guardClick` from `click()` would
   * leave every structural assertion green.
   */
  const CASES: ReadonlyArray<[string, string]> = [
    ['wizard advance button', '<button type="button" id="t">Continue</button>'],
    ['save-and-continue', '<button type="button" id="t">Save and Continue</button>'],
    ['aria advance', '<div role="button" id="t">Next</div>'],
    ['navigation link', '<a href="/step-2" id="t">Next</a>'],
    ['submit button', '<button type="submit" id="t">Submit application</button>'],
  ];

  for (const [name, html] of CASES) {
    it(`local transport refuses a ${name}`, async () => {
      document.body.innerHTML = `<form>${html}</form>`;
      const el = document.getElementById('t');
      expect(el).not.toBeNull();
      if (el === null) return;

      const spy = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => {});
      const result = await bridgeClick(el, { preferLocal: true });
      expect(result.ok, `${name} was accepted`).toBe(false);
      expect(spy, `${name} was actually clicked`).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  }

  it('local transport still clicks a legitimate option (guard is not a blanket refusal)', async () => {
    document.body.innerHTML = `<form><input type="radio" id="t" name="r" /></form>`;
    const el = document.getElementById('t');
    expect(el).not.toBeNull();
    if (el === null) return;

    const result = await bridgeClick(el, { preferLocal: true });
    expect(result.ok).toBe(true);
    expect((el as HTMLInputElement).checked).toBe(true);
  });
});
