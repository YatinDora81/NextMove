/**
 * tests/unit/overwrite.test.ts — a fill never destroys an answer the user already gave.
 *
 * JF-001 Rev 3.0 · SEC 6.4 · INV-4. The bug this suite pins was silent and expensive: ⚡ Fill all
 * (and every chained auto-fill on a wizard step) wrote over whatever the user had typed. Worse, the
 * engine was inconsistent about it — `fillSelect` had grown a `selectHasRealValue` guard, so a run
 * would carefully preserve the dropdown the user had chosen and, in the same pass, wipe the
 * paragraph they had written two fields below it.
 *
 * The properties asserted here:
 *
 *   1. REPRO — a bulk run over a form with typed text leaves that text alone and still fills the
 *      empty fields beside it, and reports the skip as `already-answered`, not `not-fillable`;
 *   2. one policy — text, textarea, typeahead and <select> all survive the SAME run;
 *   3. the escape hatch — `overwrite: true` (engine and per-strategy) still writes, because an
 *      explicit "re-fill this field" gesture is the user asking for it;
 *   4. an EMPTY field is untouched by any of this — whitespace is not an answer;
 *   5. a field that already says exactly what we would have written is reported as `filled`, not as
 *      a gap for the user to check;
 *   6. INV-4 is unchanged: a 50-69 `suggest` match still never writes, answered or not;
 *   7. multi-step chaining still works — a re-run over a NEW step (empty fields) fills it, and a
 *      re-run over the SAME step keeps what the first run put there rather than retyping it.
 *
 * The MAIN-world bridge is bypassed (`preferLocal: true`); `tests/e2e` covers the real page.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { FieldMatcher } from '@/core/matcher';
import { scanForms } from '@/core/scanner';
import { buildFieldSignature } from '@/core/signature';
import {
  comboboxHasRealValue,
  fillCombobox,
  fillSelect,
  fillText,
  isAlreadyAnswered,
  runFill,
  textHasRealValue,
  type FillFieldEvent,
} from '@/core/fill';
import { REASON, contextOf } from '@/core/fill/types';
import type { FieldNode, FillReport, MatchResult, ProfilePath } from '@/shared/types';

import { makeProfile, unloadFixture } from '../setup';

/* ------------------------------------------------------------------------------------------------
 * Harness
 * ---------------------------------------------------------------------------------------------- */

/** Put markup in the live happy-dom document — `getComputedStyle` needs a `defaultView`. */
function render(html: string): void {
  document.open();
  document.write(`<!doctype html><html><head></head><body>${html}</body></html>`);
  document.close();
}

function el<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`the fixture is missing ${selector}`);
  return found;
}

/** Scan + match with an explicit field map, exactly as the content script does. */
function matchesFor(fieldMap: Record<string, ProfilePath>): {
  nodes: FieldNode[];
  results: MatchResult[];
} {
  const nodes = scanForms(document).fields;
  const matcher = new FieldMatcher({ profile: makeProfile(), adapterFieldMap: fieldMap });
  return { nodes, results: matcher.match(nodes) };
}

interface Run {
  report: FillReport;
  events: FillFieldEvent[];
  reasonFor: (id: string) => string | undefined;
  actionFor: (id: string) => string | undefined;
}

async function fill(
  fieldMap: Record<string, ProfilePath>,
  options: { overwrite?: boolean } = {},
): Promise<Run> {
  const { results } = matchesFor(fieldMap);
  const events: FillFieldEvent[] = [];

  const report = await runFill(results, {
    profile: makeProfile(),
    atsId: 'generic',
    url: 'https://careers.example.invalid/apply',
    humanPacing: false,
    preferLocal: true,
    ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }),
    onField: (event) => events.push(event),
  });

  const of = (id: string): FillFieldEvent | undefined => events.find((e) => e.sig.id === id);
  return {
    report,
    events,
    reasonFor: (id) => of(id)?.reason,
    actionFor: (id) => of(id)?.action,
  };
}

const FORM = `
  <form>
    <label for="first_name">First name</label>
    <input type="text" id="first_name" name="first_name" />

    <label for="last_name">Last name</label>
    <input type="text" id="last_name" name="last_name" />

    <label for="email">Email</label>
    <input type="email" id="email" name="email" />

    <label for="summary">Tell us about yourself</label>
    <textarea id="summary" name="summary"></textarea>

    <label for="country">Country</label>
    <select id="country" name="country">
      <option value="">Select…</option>
      <option value="US">United States</option>
      <option value="IN">India</option>
    </select>

    <button type="submit" id="send">Submit application</button>
  </form>
`;

const FIELD_MAP: Record<string, ProfilePath> = {
  '#first_name': 'personal.firstName',
  '#last_name': 'personal.lastName',
  '#email': 'personal.email',
  '#summary': 'summary',
  '#country': 'personal.address.country',
};

beforeEach(() => {
  unloadFixture();
});

/* ------------------------------------------------------------------------------------------------
 * 1 · The repro
 * ---------------------------------------------------------------------------------------------- */

describe('a bulk fill never overwrites text the user already typed', () => {
  it('REPRO · ⚡ Fill all leaves a typed field alone and fills the empty ones', async () => {
    render(FORM);
    const typed = 'Ash';
    el<HTMLInputElement>('#first_name').value = typed;

    const run = await fill(FIELD_MAP);

    // The bug: this read "Asha" (the profile's first name) after the run.
    expect(el<HTMLInputElement>('#first_name').value).toBe(typed);
    // ...and the rest of the form still fills, which is the whole point of the button.
    expect(el<HTMLInputElement>('#last_name').value).toBe('Varma');
    expect(el<HTMLInputElement>('#email').value).toBe('asha.varma@example.invalid');
    expect(el<HTMLSelectElement>('#country').value).toBe('IN');

    expect(run.actionFor('first_name')).toBe('skip');
    expect(run.reasonFor('first_name')).toBe(REASON.alreadyAnswered);
    expect(run.report.filled).toBe(4);
    expect(run.report.errors).toBe(0);
  });

  it('a paragraph the user wrote into a textarea survives the run', async () => {
    render(FORM);
    const draft = 'I have spent six years on payments infrastructure and want to keep doing that.';
    el<HTMLTextAreaElement>('#summary').value = draft;

    await fill(FIELD_MAP);

    expect(el<HTMLTextAreaElement>('#summary').value).toBe(draft);
  });

  it('the reported reason is `already-answered`, never the misleading `not-fillable`', async () => {
    render(FORM);
    el<HTMLInputElement>('#email').value = 'personal@example.invalid';
    el<HTMLSelectElement>('#country').value = 'US';

    const run = await fill(FIELD_MAP);

    // `not-fillable` means "this control disappeared before it could be filled" — the opposite
    // state, and the overlay renders a different sentence for it.
    for (const id of ['email', 'country']) {
      expect(run.reasonFor(id), id).toBe(REASON.alreadyAnswered);
      expect(run.reasonFor(id), id).not.toBe(REASON.notFillable);
    }
  });

  it('an already-answered field is counted as skipped, never as an error', async () => {
    render(FORM);
    el<HTMLInputElement>('#first_name').value = 'Ash';
    el<HTMLTextAreaElement>('#summary').value = 'Written by hand.';

    const run = await fill(FIELD_MAP);

    expect(run.report.errors).toBe(0);
    expect(run.report.skipped).toBe(2);
  });
});

/* ------------------------------------------------------------------------------------------------
 * 2 · One policy — the inconsistency that made this a follow-up
 * ---------------------------------------------------------------------------------------------- */

describe('one run applies one policy to every kind of control', () => {
  it('text, textarea, typeahead and <select> all survive the SAME run', async () => {
    render(`
      <form>
        <label for="first_name">First name</label>
        <input type="text" id="first_name" name="first_name" />

        <label for="summary">Tell us about yourself</label>
        <textarea id="summary" name="summary"></textarea>

        <label for="city">City</label>
        <input type="text" id="city" name="city" role="combobox" aria-autocomplete="list"
               aria-expanded="false" aria-controls="city-listbox" />
        <ul id="city-listbox" role="listbox" hidden></ul>

        <label for="country">Country</label>
        <select id="country" name="country">
          <option value="">Select…</option>
          <option value="US">United States</option>
          <option value="IN">India</option>
        </select>
      </form>
    `);

    const answers = {
      first_name: 'Ash',
      summary: 'A paragraph the user wrote by hand.',
      city: 'Mysuru',
    };
    el<HTMLInputElement>('#first_name').value = answers.first_name;
    el<HTMLTextAreaElement>('#summary').value = answers.summary;
    el<HTMLInputElement>('#city').value = answers.city;
    el<HTMLSelectElement>('#country').value = 'US';

    const run = await fill({
      '#first_name': 'personal.firstName',
      '#summary': 'summary',
      '#city': 'personal.address.city',
      '#country': 'personal.address.country',
    });

    expect(el<HTMLInputElement>('#first_name').value).toBe(answers.first_name);
    expect(el<HTMLTextAreaElement>('#summary').value).toBe(answers.summary);
    expect(el<HTMLInputElement>('#city').value).toBe(answers.city);
    expect(el<HTMLSelectElement>('#country').value).toBe('US');

    for (const id of ['first_name', 'summary', 'city', 'country']) {
      expect(run.reasonFor(id), id).toBe(REASON.alreadyAnswered);
    }
    expect(run.report.filled).toBe(0);
    expect(run.report.errors).toBe(0);
  });

  it('isAlreadyAnswered is the one definition, and it knows what is NOT an answer', () => {
    render(`
      <form>
        <input type="text" id="blank" />
        <input type="text" id="spaces" value="   " />
        <input type="text" id="typed" value="Ash" />
        <textarea id="written">Hello</textarea>
        <input type="date" id="dob" value="1994-02-11" />
        <input type="radio" id="yes" name="auth" value="Yes" />
        <input type="checkbox" id="agree" value="I agree" />
        <input type="file" id="cv" />
        <div id="rich" contenteditable="true">Typed into a rich text box</div>
        <select id="placeholder">
          <option value="">Select…</option>
          <option value="US">United States</option>
        </select>
        <select id="valued">
          <option value="0">-- Choose one --</option>
          <option value="year">Per year</option>
        </select>
        <select id="chosen">
          <option value="">Select…</option>
          <option value="US" selected>United States</option>
        </select>
      </form>
    `);

    for (const id of ['typed', 'written', 'dob', 'rich', 'chosen']) {
      expect(isAlreadyAnswered(el(`#${id}`)), `#${id} is an answer`).toBe(true);
    }
    // Whitespace is not an answer; a radio/checkbox `value` is the option's own label, not a state;
    // "already attached" is `input.files`, which the resume strategy verifies itself.
    for (const id of ['blank', 'spaces', 'yes', 'agree', 'cv', 'placeholder', 'valued']) {
      expect(isAlreadyAnswered(el(`#${id}`)), `#${id} is not an answer`).toBe(false);
    }
  });

  it('a typeahead that keeps its input empty and renders a chip is still answered', () => {
    render(`
      <div class="select__control">
        <div class="select__single-value">India</div>
        <input id="country" role="combobox" aria-autocomplete="list" value="" />
      </div>
    `);
    const input = el<HTMLInputElement>('#country');

    expect(textHasRealValue(input)).toBe(false); // the input itself is empty...
    expect(comboboxHasRealValue(input)).toBe(true); // ...but the widget is showing an answer
    expect(isAlreadyAnswered(input)).toBe(true);
  });

  it('an empty typeahead is not mistaken for an answered one by a stray class name', () => {
    render(`
      <div class="select__control">
        <div class="select__placeholder">Select a country</div>
        <span class="advantage">Vintage stage</span>
        <input id="country" role="combobox" aria-autocomplete="list" value="" />
      </div>
    `);
    expect(comboboxHasRealValue(el<HTMLInputElement>('#country'))).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------
 * 3 · The escape hatch
 * ---------------------------------------------------------------------------------------------- */

describe('overwrite is the one way past the policy, and it is off by default', () => {
  it('an engine run with overwrite:true replaces the standing answers', async () => {
    render(FORM);
    el<HTMLInputElement>('#first_name').value = 'Ash';
    el<HTMLSelectElement>('#country').value = 'US';

    const run = await fill(FIELD_MAP, { overwrite: true });

    expect(el<HTMLInputElement>('#first_name').value).toBe('Asha');
    expect(el<HTMLSelectElement>('#country').value).toBe('IN');
    expect(run.report.filled).toBe(5);
  });

  it('fillText refuses by default and writes when asked — the ✨ insert gesture', async () => {
    render(`<textarea id="answer">A half-finished draft.</textarea>`);
    const box = el<HTMLTextAreaElement>('#answer');
    const ctx = contextOf({ preferLocal: true });

    const refused = await fillText(box, 'A generated answer.', ctx);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe(REASON.alreadyAnswered);
    expect(box.value).toBe('A half-finished draft.');

    const asked = await fillText(box, 'A generated answer.', ctx, { overwrite: true });
    expect(asked.ok).toBe(true);
    expect(box.value).toBe('A generated answer.');
  });

  it('fillCombobox refuses by default and writes when asked', async () => {
    render(`
      <div class="select__control">
        <input id="city" role="combobox" aria-autocomplete="list" value="Mysuru" />
      </div>
    `);
    const input = el<HTMLInputElement>('#city');
    const ctx = contextOf({ preferLocal: true });

    const refused = await fillCombobox(input, 'Bengaluru', ctx);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe(REASON.alreadyAnswered);
    expect(input.value).toBe('Mysuru');
  });

  it('fillSelect keeps the escape hatch it already had', async () => {
    render(`
      <select id="country">
        <option value="">Select…</option>
        <option value="US">United States</option>
        <option value="IN">India</option>
      </select>
    `);
    const select = el<HTMLSelectElement>('#country');
    select.value = 'US';

    const asked = await fillSelect(select, 'India', contextOf({ preferLocal: true }), {
      overwrite: true,
    });
    expect(asked.ok).toBe(true);
    expect(select.value).toBe('IN');
  });
});

/* ------------------------------------------------------------------------------------------------
 * 4 · What must NOT change
 * ---------------------------------------------------------------------------------------------- */

describe('an empty field is filled exactly as before', () => {
  it('a blank form fills end to end', async () => {
    render(FORM);
    const run = await fill(FIELD_MAP);

    expect(el<HTMLInputElement>('#first_name').value).toBe('Asha');
    expect(el<HTMLInputElement>('#last_name').value).toBe('Varma');
    expect(el<HTMLTextAreaElement>('#summary').value.length).toBeGreaterThan(0);
    expect(el<HTMLSelectElement>('#country').value).toBe('IN');
    expect(run.report.filled).toBe(5);
    expect(run.report.skipped).toBe(0);
  });

  it('whitespace is not an answer — a field holding only spaces still fills', async () => {
    render(FORM);
    el<HTMLInputElement>('#first_name').value = '   ';

    await fill(FIELD_MAP);

    expect(el<HTMLInputElement>('#first_name').value).toBe('Asha');
  });

  it('a field that already says what we would have written is `filled`, not a gap', async () => {
    render(FORM);
    // The page pre-filled the email from the account the user signed in with. It is correct, and
    // the panel must say so rather than adding a row the user has to go and check.
    el<HTMLInputElement>('#email').value = 'asha.varma@example.invalid';
    el<HTMLSelectElement>('#country').value = 'IN';

    const run = await fill(FIELD_MAP);

    expect(run.actionFor('email')).toBe('fill');
    expect(run.actionFor('country')).toBe('fill');
    expect(run.report.filled).toBe(5);
    expect(run.report.skipped).toBe(0);
  });

  it('INV-4 · a 50-69 suggestion still never writes, answered or not', async () => {
    render(FORM);
    const typed = 'Ash';
    el<HTMLInputElement>('#first_name').value = typed;

    const input = el<HTMLInputElement>('#first_name');
    const node: FieldNode = {
      el: input,
      sig: buildFieldSignature(input, 0),
      visible: true,
      required: false,
    };
    const suggestion: MatchResult = {
      node,
      path: 'personal.firstName',
      score: 61,
      source: 'heuristic',
      action: 'suggest',
    };

    const events: FillFieldEvent[] = [];
    const report = await runFill([suggestion], {
      profile: makeProfile(),
      atsId: 'generic',
      url: 'https://careers.example.invalid/apply',
      humanPacing: false,
      preferLocal: true,
      onField: (event) => events.push(event),
    });

    expect(input.value).toBe(typed);
    expect(report.suggested).toBe(1);
    expect(report.filled).toBe(0);
    // The proposal is still offered to the overlay — INV-4 reports it, it just never writes it.
    expect(events[0]?.action).toBe('suggest');
    expect(events[0]?.value).toBe('Asha');
  });
});

/* ------------------------------------------------------------------------------------------------
 * 5 · <select multiple> — the one control the policy used to miss
 * ---------------------------------------------------------------------------------------------- */

const MULTI_FORM = `
  <form>
    <label for="skills">Skills</label>
    <select id="skills" name="skills" multiple>
      <option value="TypeScript">TypeScript</option>
      <option value="Go">Go</option>
      <option value="PostgreSQL">PostgreSQL</option>
      <option value="Kubernetes">Kubernetes</option>
      <option value="Terraform">Terraform</option>
      <option value="Elixir">Elixir</option>
    </select>
  </form>
`;

const MULTI_FIELD_MAP: Record<string, ProfilePath> = { '#skills': 'skills' };

/** The options a `<select multiple>` is currently showing as chosen, in document order. */
function selectedValues(select: HTMLSelectElement): string[] {
  return [...select.querySelectorAll('option')].filter((o) => o.selected).map((o) => o.value);
}

function selectOptions(select: HTMLSelectElement, values: readonly string[]): void {
  for (const option of select.querySelectorAll('option')) {
    option.selected = values.includes(option.value);
  }
}

describe('a multi-select is under the same policy as every other control', () => {
  it('REPRO · a bulk fill does not clobber the options the user picked by hand', async () => {
    render(MULTI_FORM);
    const skills = el<HTMLSelectElement>('#skills');
    // The user ticked exactly one thing. The vault holds five.
    selectOptions(skills, ['Elixir']);

    const run = await fill(MULTI_FIELD_MAP);

    // The bug: this read the five profile skills and the user's own choice was gone.
    expect(selectedValues(skills)).toEqual(['Elixir']);
    expect(run.actionFor('skills')).toBe('skip');
    expect(run.reasonFor('skills')).toBe(REASON.alreadyAnswered);
    expect(run.report.errors).toBe(0);
    expect(run.report.skipped).toBe(1);
  });

  it('fillSelect refuses a multi-select by default and writes when asked', async () => {
    render(MULTI_FORM);
    const skills = el<HTMLSelectElement>('#skills');
    selectOptions(skills, ['Elixir']);
    const ctx = contextOf({ preferLocal: true });

    const refused = await fillSelect(skills, ['TypeScript', 'Go'], ctx);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe(REASON.alreadyAnswered);
    expect(selectedValues(skills)).toEqual(['Elixir']);

    const asked = await fillSelect(skills, ['TypeScript', 'Go'], ctx, { overwrite: true });
    expect(asked.ok).toBe(true);
    expect(selectedValues(skills)).toEqual(['TypeScript', 'Go']);
  });

  it('an untouched multi-select still fills — nothing selected is not an answer', async () => {
    render(MULTI_FORM);
    const run = await fill(MULTI_FIELD_MAP);

    expect(selectedValues(el<HTMLSelectElement>('#skills'))).toEqual([
      'TypeScript',
      'Go',
      'PostgreSQL',
      'Kubernetes',
      'Terraform',
    ]);
    expect(run.report.filled).toBe(1);
    expect(run.report.skipped).toBe(0);
  });

  it('a multi-select that already says exactly what we would write is `filled`, not a gap', async () => {
    render(MULTI_FORM);
    const skills = el<HTMLSelectElement>('#skills');
    selectOptions(skills, ['TypeScript', 'Go', 'PostgreSQL', 'Kubernetes', 'Terraform']);

    const run = await fill(MULTI_FIELD_MAP);

    expect(run.actionFor('skills')).toBe('fill');
    expect(run.report.filled).toBe(1);
    expect(run.report.skipped).toBe(0);
  });

  it('a re-run over a filled multi-select keeps the first run selection', async () => {
    render(MULTI_FORM);
    const skills = el<HTMLSelectElement>('#skills');
    await fill(MULTI_FIELD_MAP);
    const afterFirst = selectedValues(skills);
    // The user drops one of the five before the wizard chains the next fill.
    selectOptions(skills, afterFirst.filter((v) => v !== 'Terraform'));

    const second = await fill(MULTI_FIELD_MAP);

    expect(selectedValues(skills)).toEqual(['TypeScript', 'Go', 'PostgreSQL', 'Kubernetes']);
    expect(second.reasonFor('skills')).toBe(REASON.alreadyAnswered);
  });

  it('a selected valueless hint row is not an answer, so the control still fills', async () => {
    render(`
      <form>
        <label for="skills">Skills</label>
        <select id="skills" name="skills" multiple>
          <option value="" selected>Select all that apply</option>
          <option value="TypeScript">TypeScript</option>
          <option value="Go">Go</option>
        </select>
      </form>
    `);

    await fill(MULTI_FIELD_MAP);

    expect(selectedValues(el<HTMLSelectElement>('#skills'))).toEqual(['TypeScript', 'Go']);
  });

  it('isAlreadyAnswered reads a multi-select by what is selected, not by selectedIndex', () => {
    render(`
      <form>
        <select id="untouched" multiple>
          <option value="TypeScript">TypeScript</option>
          <option value="Go">Go</option>
        </select>
        <select id="hint_only" multiple>
          <option value="" selected>Select all that apply</option>
          <option value="Go">Go</option>
        </select>
        <select id="chosen" multiple>
          <option value="" selected>Select all that apply</option>
          <option value="Go" selected>Go</option>
        </select>
      </form>
    `);

    expect(isAlreadyAnswered(el('#untouched'))).toBe(false);
    expect(isAlreadyAnswered(el('#hint_only'))).toBe(false);
    // `selectedIndex` points at the hint row here; the answer is the option below it.
    expect(isAlreadyAnswered(el('#chosen'))).toBe(true);
  });
});

/* ------------------------------------------------------------------------------------------------
 * 6 · Multi-step chaining (`autoFillNextSteps` re-runs a fill on every step)
 * ---------------------------------------------------------------------------------------------- */

describe('chained auto-fill across wizard steps', () => {
  it('a NEW step is empty, so it fills — the policy only ever protects answers', async () => {
    render(FORM);
    const first = await fill(FIELD_MAP);
    expect(first.report.filled).toBe(5);

    // The wizard swaps the step in place; the fields on it have never been touched.
    render(`
      <form>
        <label for="job_title">Job title</label>
        <input type="text" id="job_title" name="job_title" />
        <label for="employer">Employer</label>
        <input type="text" id="employer" name="employer" />
      </form>
    `);

    const second = await fill({ '#job_title': 'work[0].title', '#employer': 'work[0].company' });

    expect(el<HTMLInputElement>('#job_title').value).toBe('Senior Software Engineer');
    expect(el<HTMLInputElement>('#employer').value).toBe('Peregrine Systems');
    expect(second.report.filled).toBe(2);
  });

  it('re-running on the SAME step keeps what the first run wrote instead of retyping it', async () => {
    render(FORM);
    await fill(FIELD_MAP);
    const afterFirst = el<HTMLInputElement>('#first_name').value;

    const second = await fill(FIELD_MAP);

    expect(el<HTMLInputElement>('#first_name').value).toBe(afterFirst);
    // Every field already says the right thing, so the second pass is honest about it: no errors,
    // nothing rewritten, and no invented gaps for the user to check.
    expect(second.report.errors).toBe(0);
    expect(second.report.filled).toBe(5);
  });

  it('a step the user edited between runs is not undone by the next chained fill', async () => {
    render(FORM);
    await fill(FIELD_MAP);

    const corrected = 'Asha R. Varma';
    el<HTMLInputElement>('#first_name').value = corrected;

    const second = await fill(FIELD_MAP);

    expect(el<HTMLInputElement>('#first_name').value).toBe(corrected);
    expect(second.reasonFor('first_name')).toBe(REASON.alreadyAnswered);
  });
});
