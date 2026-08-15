/**
 * tests/e2e/proactive.spec.ts — the whole proactive flow, in a real browser, on real ATS markup.
 *
 * What the unit suite cannot prove and this one can:
 *
 *   1. suggestions appear on a real Greenhouse form with **zero interaction** — no fill run, no
 *      focus, no keystroke — and they are drawn where the fields actually are, which needs layout;
 *   2. ✓ writes through the real fill engine into a real input, and the value is still there
 *      afterwards (the React-controlled-input failure mode is invisible to happy-dom, which has no
 *      framework to fight);
 *   3. ✗ survives a reload, because the ledger is on disk and keyed by a hash that survives DOM churn;
 *   4. 💾 on one employer's form makes the same question answer itself on the next employer's;
 *   5. the power switch tears the in-page layer down in a page that is already open, leaving the one
 *      affordance that can turn it back on;
 *   6. the collapse choice follows the user to the next page.
 *
 * The overlay lives in a CLOSED shadow root, so it is read over CDP and clicked with real mouse
 * events at real coordinates (see `helpers/overlay.ts`). Nothing here reaches inside the extension
 * to make an assertion pass.
 *
 * On the power switch: Playwright cannot dispatch a browser-level `commands` shortcut, so §5 flips
 * the flag the way the popup and the Options page do — one write to the settings slot, which is the
 * single writer Alt+Shift+N goes through too (`platform/storage.toggleEnabled`). What the shortcut
 * adds on top of that is one `browser.commands.onCommand` line in `entrypoints/background.ts`; the
 * fan-out being tested here is all of the rest of it, and `tests/unit/power-switch.test.ts` covers
 * the writer itself.
 */

import { expect } from '@playwright/test';

import { test } from './helpers/extension';
import type { FixturePage } from './helpers/extension';

/** The SEC 7.2 fixture profile's values, which is what a ghost on these forms must be showing. */
const FIRST_NAME = 'Riya';

const GREENHOUSE = '/corpus/greenhouse/standard.html';
const SECOND = '/live/second-application.html';

/** The bubble is the corner's collapsed state and the anchor of everything else in this spec. */
const BUBBLE = '.jf-bubble';
const CLUSTER = '.jf-cluster';
const GHOST = '.jf-ghost';
const PANEL = '.jf-panel';
const MINIMISE = '.jf-panel__chrome button[aria-label="Minimise NextMove"]';

/**
 * One field's cluster, addressed by the accessible name it already carries ("NextMove suggestion for
 * Email"). Every cluster on the page looks identical otherwise — same three glyphs — so a spec that
 * clicked "the first ✓" would be asserting about whichever field the scanner happened to reach
 * first, which is not the field the assertion below is about.
 */
function clusterFor(label: string): string {
  return `${CLUSTER}[aria-label*="${label}"]`;
}

/**
 * The bubble's classes, polled.
 *
 * The clusters and ghosts are imperative DOM and change on the same tick as the settings write; the
 * bubble is React and commits on React's schedule. A frame's difference is invisible to a user and
 * fatal to an unpolled assertion.
 */
async function bubbleClasses(fixture: FixturePage): Promise<string> {
  return (await fixture.overlay.classNames(BUBBLE)).join(' ');
}

/**
 * The dock's classes, as one string.
 *
 * Asserted with `toBe` rather than `not.toContain`: an absent `.jf-shell` yields an empty string,
 * which "does not contain jf-shell--collapsed" — so the negative form would pass on a panel that had
 * been torn down entirely, which is the opposite of what these assertions are for.
 */
async function shellClasses(fixture: FixturePage): Promise<string> {
  return (await fixture.overlay.classNames('.jf-shell')).join(' ');
}

/**
 * Values the *page* holds that NextMove could have put there.
 *
 * `fixture.values()` also reports an empty file input as `files:0` and a submit button by its own
 * `value` attribute — page furniture that is there before the extension loads. Filtering it out is
 * what makes "nothing was written" an assertion about NextMove rather than about the fixture.
 */
async function writtenValues(fixture: FixturePage): Promise<Record<string, string>> {
  const values = await fixture.values();
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === 'files:0') continue;
    if (key === 'submit_app') continue;
    out[key] = value;
  }
  return out;
}

/**
 * Wait until the proactive pass has drawn at least `count` clusters.
 *
 * A scan is debounced (250ms) and the pass behind it makes four round trips to the service worker
 * before it draws anything, so "no clusters yet" is a normal intermediate state rather than a
 * failure — polling is the honest way to express that.
 */
async function waitForClusters(fixture: FixturePage, count = 1): Promise<number> {
  const deadline = Date.now() + 25_000;
  let seen = 0;
  while (Date.now() < deadline) {
    seen = await fixture.overlay.count(`${CLUSTER}.jf-cluster--show`);
    if (seen >= count) return seen;
    await fixture.page.waitForTimeout(150);
  }
  throw new Error(`only ${seen} of ${count} field clusters were ever drawn`);
}

/** Flip `Settings.enabled` through the same slot every surface writes (SEC 5.1, single writer). */
async function setEnabled(jobfill: { ui: () => Promise<import('@playwright/test').Page> }, enabled: boolean): Promise<void> {
  const ui = await jobfill.ui();
  await ui.evaluate(async (next: boolean) => {
    const api = (globalThis as unknown as {
      chrome: { storage: { local: { get(k: string): Promise<Record<string, unknown>>; set(v: Record<string, unknown>): Promise<void> } } };
    }).chrome;
    const key = 'jf.settings';
    const bag = await api.storage.local.get(key);
    const settings = (bag[key] ?? {}) as Record<string, unknown>;
    await api.storage.local.set({ [key]: { ...settings, enabled: next, updatedAt: Date.now() } });
  }, enabled);
}

/* ------------------------------------------------------------------------------------------------
 * 1 — suggestions before anything is asked for
 * ---------------------------------------------------------------------------------------------- */

test('a Greenhouse form suggests values with zero interaction', async ({ jobfill }) => {
  await jobfill.seed({ withKey: false });

  const fixture = await jobfill.openFixture(GREENHOUSE);

  // Nothing has been clicked, focused or typed. The bubble is up and the fields are annotated.
  await fixture.overlay.waitFor(BUBBLE);
  await waitForClusters(fixture, 3);

  // Named fields, not just a count: these are the three the profile can actually answer.
  for (const label of ['First Name', 'Last Name', 'Phone']) {
    expect(await fixture.overlay.count(clusterFor(label)), `cluster for ${label}`).toBe(1);
  }

  // The ghost is showing what would be written, not a placeholder or a label.
  const ghosts = await fixture.overlay.texts(`${GHOST}.jf-ghost--show`);
  expect(ghosts.join(' | ')).toContain(FIRST_NAME);

  // INV-4: proactive means propose. Not one field has been written to.
  expect(await writtenValues(fixture)).toEqual({});

  // The count badge says how many are waiting.
  const badge = await fixture.overlay.text('.jf-bubble__count');
  expect(Number(badge)).toBeGreaterThanOrEqual(3);

  await fixture.close();
});

/**
 * The same property on every ATS in the corpus, because "recognised" is per-adapter: Workday hides
 * its labels behind `data-automation-id`, Ashby generates its ids per render, Lever and Greenhouse
 * are conventional, and the generic adapter has no selectors at all to lean on.
 */
for (const [ats, path] of [
  ['greenhouse', GREENHOUSE],
  ['lever', '/corpus/lever/standard.html'],
  ['ashby', '/corpus/ashby/standard.html'],
  ['workday', '/corpus/workday/step1-my-information.html'],
  ['generic', '/corpus/generic/plain-career-form.html'],
] as const) {
  test(`${ats}: recognised fields carry a cluster before anything is asked for`, async ({ jobfill }) => {
    await jobfill.seed({ withKey: false });
    const fixture = await jobfill.openFixture(path);

    await fixture.overlay.waitFor(BUBBLE);
    expect(await waitForClusters(fixture, 2)).toBeGreaterThanOrEqual(2);
    expect(await writtenValues(fixture)).toEqual({});

    await fixture.close();
  });
}

test('✓ on a radio group picks the right option, through the real choice strategy', async ({
  jobfill,
}) => {
  await jobfill.seed({ withKey: false });
  const fixture = await jobfill.openFixture('/corpus/ashby/standard.html');
  await waitForClusters(fixture, 2);

  // "Are you authorized to work in the European Union?" against a profile that lists the EU. A ghost
  // cannot be drawn on a radio group, so the proposed answer lives on the cluster's tooltip — and ✓
  // still has to go through `fillChoice` and tick the right member.
  const yes = fixture.page.locator('#auth-yes');
  await yes.scrollIntoViewIfNeeded();
  await expect(yes).not.toBeChecked();

  await fixture.overlay.click(`${clusterFor('authorized to work')} .jf-cluster__btn--accept`);
  await expect(yes).toBeChecked();
  await expect(fixture.page.locator('#auth-no')).not.toBeChecked();

  await fixture.close();
});

test('a password, a one-time code and a card are never mentioned, on a form that has all three', async ({
  jobfill,
}) => {
  await jobfill.seed({ withKey: false });
  const fixture = await jobfill.openFixture('/live/credential-fields.html');

  // The application fields on the same form are annotated, so this proves refusal rather than
  // NextMove having failed to recognise the page at all.
  await waitForClusters(fixture, 1);
  expect(await fixture.overlay.count(clusterFor('First name'))).toBe(1);
  expect(await fixture.overlay.count(clusterFor('Email address'))).toBe(1);

  for (const label of [
    'Choose a password',
    'Verification code',
    'Card number',
    'Security code',
  ]) {
    expect(await fixture.overlay.count(clusterFor(label)), `must not mention ${label}`).toBe(0);
  }

  // And nothing was written into any of them.
  expect(await writtenValues(fixture)).toEqual({});
  await fixture.close();
});

/* ------------------------------------------------------------------------------------------------
 * 2 — ✓ writes, and the write sticks
 * ---------------------------------------------------------------------------------------------- */

test('✓ fills the field it is anchored to, and the value survives', async ({ jobfill }) => {
  await jobfill.seed({ withKey: false });
  const fixture = await jobfill.openFixture(GREENHOUSE);
  await waitForClusters(fixture, 3);

  // "First Name" rather than "Email": this form asks for an email twice (the applicant's, and one
  // inside its own screening questions), so `[aria-label*="Email"]` is two clusters, not one.
  const firstName = fixture.page.locator('#first_name');
  await firstName.scrollIntoViewIfNeeded();
  await expect(firstName).toHaveValue('');

  await fixture.overlay.click(`${clusterFor('First Name')} .jf-cluster__btn--accept`);

  // The write goes through the real fill engine, which verifies it stuck before reporting it — and
  // this asserts the same thing independently, from the page's side.
  await expect(firstName).toHaveValue(FIRST_NAME);
  expect(await writtenValues(fixture)).toEqual({ first_name: FIRST_NAME });

  // The offer is spent: ✓ and ✗ are gone from that field, 💾 is not.
  await expect
    .poll(async () => fixture.overlay.count(`${clusterFor('First Name')}.jf-cluster--save-only`), {
      timeout: 10_000,
    })
    .toBe(1);

  // And a second later it is still there — nothing re-rendered it away.
  await fixture.page.waitForTimeout(1_000);
  await expect(firstName).toHaveValue(FIRST_NAME);

  await fixture.close();
});

/* ------------------------------------------------------------------------------------------------
 * 3 — ✗ sticks across a reload
 * ---------------------------------------------------------------------------------------------- */

test('✗ is still refused after a reload, and the panel offers it back', async ({ jobfill }) => {
  await jobfill.seed({ withKey: false });
  const fixture = await jobfill.openFixture(GREENHOUSE);
  await waitForClusters(fixture, 3);

  const offers = async (): Promise<number> =>
    fixture.overlay.count(`${CLUSTER}.jf-cluster--show:not(.jf-cluster--save-only)`);
  const before = await offers();
  expect(before).toBeGreaterThanOrEqual(3);

  await fixture.overlay.click(`${clusterFor('First Name')} .jf-cluster__btn--dismiss`);

  // Gone from that field immediately, and only from that field.
  await expect.poll(offers, { timeout: 10_000 }).toBe(before - 1);
  expect(await fixture.overlay.count(`${clusterFor('First Name')}.jf-cluster--save-only`)).toBe(1);

  // Gone after a reload too, which is the whole point: the proactive layer repaints several times
  // per application and a refusal that lived in memory would be a flicker.
  await fixture.page.reload({ waitUntil: 'domcontentloaded' });
  await waitForClusters(fixture, 2);
  await expect
    .poll(async () => fixture.overlay.count(`${clusterFor('First Name')}.jf-cluster--save-only`), {
      timeout: 15_000,
    })
    .toBe(1);
  expect(await fixture.page.locator('#first_name').inputValue()).toBe('');

  // And it is recoverable: the panel carries a row for the field, with the way back.
  await fixture.overlay.click('.jf-bubble__open');
  await fixture.overlay.waitFor(PANEL);
  await fixture.overlay.waitForText('.jf-row__meta', 'told NextMove not to suggest');
  await fixture.overlay.clickByText('button', 'Suggest this again');

  // The row stops existing, because the field is no longer dismissed — and the offer is back.
  await expect.poll(offers, { timeout: 15_000 }).toBe(before);

  await fixture.close();
});

/* ------------------------------------------------------------------------------------------------
 * 4 — 💾 teaches the next employer's form
 * ---------------------------------------------------------------------------------------------- */

test('💾 on one application makes the same question answer itself on the next', async ({ jobfill }) => {
  await jobfill.seed({ withKey: false });

  const first = await jobfill.openFixture(GREENHOUSE);
  await waitForClusters(first, 3);

  const answer = 'Because the ledger problems you write about are the ones I have spent four years on.';
  const question = first.page.locator('#job_application_answers_attributes_0_text_value');
  await question.scrollIntoViewIfNeeded();
  await question.fill(answer);

  // 💾 wakes up the moment there is something in the box worth keeping.
  const save = `${clusterFor('Why do you want to work')} .jf-cluster__btn--save`;
  await first.overlay.waitFor(save);
  await first.overlay.click(save);
  await first.overlay.waitForText('.jf-toast__title', 'Saved');
  await first.close();

  // A different employer asking the same question, normalised the Answer Bank's way.
  const second = await jobfill.openFixture(SECOND);
  await waitForClusters(second, 2);

  const motivation = second.page.locator('#screening-motivation');
  await motivation.scrollIntoViewIfNeeded();
  await expect(motivation).toHaveValue('');

  const ghosts = await second.overlay.texts(`${GHOST}.jf-ghost--show`);
  expect(ghosts.join(' | ')).toContain('ledger problems');

  await second.close();
});

/* ------------------------------------------------------------------------------------------------
 * 5 — the power switch, live, in a page that is already open
 * ---------------------------------------------------------------------------------------------- */

test('turning NextMove off strips the page, and turning it back on restores it', async ({ jobfill }) => {
  await jobfill.seed({ withKey: false });
  const fixture = await jobfill.openFixture(GREENHOUSE);
  await waitForClusters(fixture, 3);

  // Fill first, so there is a full set of F-06 outlines and a mounted review panel to tear down —
  // asserting "no markers" on a page that never had one proves nothing.
  await fixture.fill();
  await fixture.overlay.waitFor('.jf-marker');
  await fixture.overlay.waitFor(PANEL);
  const filled = await writtenValues(fixture);
  expect(Object.keys(filled).length).toBeGreaterThan(3);

  await setEnabled(jobfill, false);

  // Everything drawn over the page goes; the grey bubble stays, because the way back on has to be
  // reachable from where the user is.
  await expect
    .poll(async () => fixture.overlay.count(`${CLUSTER}.jf-cluster--show`), { timeout: 10_000 })
    .toBe(0);
  expect(await fixture.overlay.count(`${GHOST}.jf-ghost--show`)).toBe(0);
  expect(await fixture.overlay.count('.jf-marker')).toBe(0);
  expect(await fixture.overlay.count(PANEL)).toBe(0);

  await expect.poll(async () => bubbleClasses(fixture), { timeout: 10_000 }).toContain('jf-bubble--off');
  await fixture.overlay.waitForText('.jf-toast__title', 'NextMove is off');

  // Off is "stop touching pages", not "undo": what the run already wrote is the user's, and it is
  // still there untouched.
  expect(await writtenValues(fixture)).toEqual(filled);

  await setEnabled(jobfill, true);
  await waitForClusters(fixture, 3);
  await expect
    .poll(async () => bubbleClasses(fixture), { timeout: 10_000 })
    .not.toContain('jf-bubble--off');

  await fixture.close();
});

test('the off bubble turns NextMove back on from the page itself', async ({ jobfill }) => {
  await jobfill.seed({ withKey: false });
  const fixture = await jobfill.openFixture(GREENHOUSE);
  await waitForClusters(fixture, 3);

  await setEnabled(jobfill, false);
  await expect
    .poll(async () => fixture.overlay.count(`${CLUSTER}.jf-cluster--show`), { timeout: 10_000 })
    .toBe(0);

  await fixture.overlay.click('.jf-bubble__open');
  await waitForClusters(fixture, 3);

  await fixture.close();
});

/* ------------------------------------------------------------------------------------------------
 * 6 — the corner remembers what the user chose
 * ---------------------------------------------------------------------------------------------- */

test('expanding the panel survives a navigation; minimising it does too', async ({ jobfill }) => {
  await jobfill.seed({ withKey: false });
  const fixture = await jobfill.openFixture(GREENHOUSE);
  await fixture.overlay.waitFor(BUBBLE);

  // Collapsed by default: NextMove has to earn the screen real estate.
  expect(await shellClasses(fixture)).toContain('jf-shell--collapsed');

  await fixture.overlay.click('.jf-bubble__open');
  await expect.poll(async () => shellClasses(fixture), { timeout: 10_000 }).toBe('jf-shell');

  // A second page in the same session opens expanded, because that is what the user last chose.
  const next = await jobfill.openFixture(SECOND);
  await next.overlay.waitFor(PANEL);
  await expect.poll(async () => shellClasses(next), { timeout: 15_000 }).toBe('jf-shell');

  // Minimise — the button beside the power switch, not the switch itself.
  await next.overlay.click(MINIMISE);
  await expect
    .poll(async () => shellClasses(next), { timeout: 10_000 })
    .toBe('jf-shell jf-shell--collapsed');

  await next.close();
  await fixture.close();
});

/* ------------------------------------------------------------------------------------------------
 * The panel's own power switch
 * ---------------------------------------------------------------------------------------------- */

test('the panel header switch is the same flag as everything else', async ({ jobfill }) => {
  await jobfill.seed({ withKey: false });
  const fixture = await jobfill.openFixture(GREENHOUSE);
  await waitForClusters(fixture, 3);

  await fixture.overlay.click('.jf-bubble__open');
  await fixture.overlay.waitFor('.jf-switch');
  await fixture.overlay.click('.jf-switch');

  await expect
    .poll(async () => fixture.overlay.count(`${CLUSTER}.jf-cluster--show`), { timeout: 10_000 })
    .toBe(0);
  await expect.poll(async () => bubbleClasses(fixture), { timeout: 10_000 }).toContain('jf-bubble--off');

  await fixture.close();
});
