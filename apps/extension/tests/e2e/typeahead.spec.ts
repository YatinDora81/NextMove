/**
 * typeahead.spec.ts — SEC 11 e2e: "Full fill flow per adapter incl. typeahead".
 *
 * SEC 6.4 specifies the combobox strategy as: "focus → clear → dispatch per-character
 * keydown/input (30-60 ms jitter) → await listbox via MutationObserver (3 s cap) → click best
 * option (exact > startsWith > fuzzy) → verify committed value, else mark `suggest`."
 *
 * Everything after "await listbox" is invisible to the unit layer. happy-dom renders nothing, so
 * no popup ever appears, so `awaitListbox` always runs to its cap and the field is always
 * downgraded to `suggest`. The unit suite therefore tests the *failure* branch of this strategy
 * and can never test the success branch. That is the gap this file closes.
 *
 * Two halves, and both matter:
 *
 *   1. Against a live widget (`/live/ashby-typeahead.html`), the option must be genuinely SELECTED
 *      and the selection must COMMIT — asserted on the widget's hidden selection id, not merely on
 *      the text left in the box. Text in the box is what an unverified typeahead looks like too.
 *
 *   2. Against the static corpus fixture, whose listbox markup exists but never opens, the field
 *      must be downgraded to a suggestion with the honest "the site's dropdown never opened" copy
 *      rather than being reported as filled (INV-4).
 */

import { expect, test } from './helpers/extension';

/** Copy owned by `content/overlay/ReviewPanel.tsx::reasonCopy` for `listbox-timeout`. */
const LISTBOX_TIMEOUT_COPY = 'dropdown never opened';

test.beforeEach(async ({ jobfill }) => {
  await jobfill.seed({ withKey: false });
});

test('a live listbox is opened, the right option is clicked, and the selection commits', async ({
  jobfill,
}) => {
  const fixture = await jobfill.openFixture('/live/ashby-typeahead.html');
  const report = await fixture.fill();

  expect(report.atsId).toBe('ashby');
  expect(report.errors).toBe(0);

  const page = fixture.page;

  // The visible half: the widget rewrote the typed query ("Berlin") into the option's full label.
  // An unverified typeahead would have left "Berlin" sitting there instead.
  await expect(page.locator('#_systemfield_location')).toHaveValue('Berlin, Germany');

  // The half that actually proves a commit: the widget's own selection record. Nothing but a real
  // click on a real `role="option"` row sets this.
  await expect(page.locator('#_systemfield_location_id')).toHaveValue('loc_ber');
  await expect(page.locator('#location-status')).toHaveText('Selected Berlin, Germany');

  // The popup is closed again — the strategy does not leave a listbox hanging over the form.
  await expect(page.locator('#location-options')).toBeHidden();
  await expect(page.locator('.ashby-combobox')).toHaveAttribute('aria-expanded', 'false');

  // INV-1: the commit came from a click on the option, never from a synthetic Enter. If Enter had
  // been sent, this page's form (novalidate, single text input focused) is exactly the shape that
  // implicitly submits — and the page would have navigated.
  expect(page.url()).toContain('/live/ashby-typeahead.html');

  // Because the commit verified, the overlay marks it blue rather than yellow.
  const badges = await fixture.overlay.texts('.jf-marker--filled .jf-marker__badge');
  expect(badges.length).toBeGreaterThan(0);
});

test('a listbox that never opens is downgraded to a suggestion, not reported as filled', async ({
  jobfill,
}) => {
  // The corpus fixture carries the same combobox markup with no behaviour behind it — which is
  // exactly what a JS-disabled or slow-loading ATS looks like.
  const fixture = await jobfill.openFixture('/corpus/ashby/standard.html');
  const report = await fixture.fill();

  expect(report.errors).toBe(0);
  expect(report.suggested).toBeGreaterThan(0);

  // The query text is left in the field — it may well be right, but nothing confirmed it…
  await expect(fixture.page.locator('#_systemfield_location')).toHaveValue('Berlin');

  // …so the overlay says so, in the user's words, instead of claiming a fill (INV-4).
  const panel = await fixture.overlay.html();
  expect(panel).toContain(LISTBOX_TIMEOUT_COPY);

  // And the row is drawn yellow ("Check this"), not blue.
  const suggestedBadges = await fixture.overlay.texts('.jf-marker--suggested .jf-marker__badge');
  expect(suggestedBadges).toContain('Check this');
});

test('a live listbox with no matching option commits nothing and says so', async ({ jobfill }) => {
  // Same live widget, a city it has never heard of. This is the branch that separates "typed the
  // query in" from "picked the record": a lesser implementation would leave the text sitting there
  // and call the field filled.
  await jobfill.seedProfile({
    personal: {
      firstName: 'Riya',
      lastName: 'Kulkarni',
      email: 'riya.kulkarni@example.com',
      phone: '+1 415 555 0134',
      address: {
        line1: '18 Marlow Street',
        line2: 'Apt 4',
        city: 'Reykjavik',
        state: 'Capital Region',
        postalCode: '101',
        country: 'Iceland',
      },
    },
  });

  const fixture = await jobfill.openFixture('/live/ashby-typeahead.html');
  const report = await fixture.fill();

  expect(report.errors).toBe(0);

  // The query is in the box…
  await expect(fixture.page.locator('#_systemfield_location')).toHaveValue('Reykjavik');
  // …and nothing was committed: no selection id, no status line.
  await expect(fixture.page.locator('#_systemfield_location_id')).toHaveValue('');
  await expect(fixture.page.locator('#location-status')).toHaveText('');

  // The overlay tells the user to finish it themselves rather than claiming a fill (INV-4).
  expect(await fixture.overlay.html()).toContain(LISTBOX_TIMEOUT_COPY);
});
