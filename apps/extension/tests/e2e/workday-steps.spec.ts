/**
 * workday-steps.spec.ts — SEC 11 e2e: "multi-step Workday fixture walk" + INV-1 at the wizard.
 *
 * Workday is the hard case and the honest one: every step of the apply flow ends in a control
 * ("Save and Continue") that commits the answers on that page and moves the application forward.
 * INV-1 treats it exactly like a Submit button — JobFill locates it, outlines it in green, and
 * stops. Nothing in the codebase may press it.
 *
 * Three things are asserted here that no unit test can reach:
 *
 *   1. The next-step control is **located**: the overlay draws a marker whose rectangle actually
 *      sits on top of that button, which needs real layout.
 *   2. The next-step control is **not pressed**: the fixture counts presses in page DOM, so the
 *      assertion is on observed behaviour rather than on a spy over a prototype the extension may
 *      or may not have used.
 *   3. Pressing it — as a human, with a real mouse — advances the wizard, and JobFill's observer
 *      re-scans the new step so a second fill picks up the fields that did not exist a moment ago.
 *
 * `/live/workday-wizard.html` exists because the corpus fixture is a single static step. The
 * corpus fixture is still exercised below for the "located, never pressed" half.
 */

import { expect, test } from './helpers/extension';
import { E2E_PROFILE } from './helpers/profile';

const P = E2E_PROFILE.personal;
const WORK = E2E_PROFILE.work[0];

test.beforeEach(async ({ jobfill }) => {
  await jobfill.seed({ withKey: false });
});

test('step 1 fills, "Save and Continue" is outlined, and nothing ever presses it', async ({
  jobfill,
}) => {
  const fixture = await jobfill.openFixture('/live/workday-wizard.html');
  const page = fixture.page;

  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });

  const report = await fixture.fill();
  expect(report.atsId).toBe('workday');
  expect(report.errors).toBe(0);

  // --- step 1 really filled -------------------------------------------------------------------
  await expect(page.locator('#input-first')).toHaveValue(P.firstName);
  await expect(page.locator('#input-last')).toHaveValue(P.lastName);
  await expect(page.locator('#input-line1')).toHaveValue(P.address.line1);
  await expect(page.locator('#input-city')).toHaveValue(P.address.city);
  await expect(page.locator('#input-postal')).toHaveValue(P.address.postalCode);
  await expect(page.locator('#input-email')).toHaveValue(P.email);
  await expect(page.locator('#input-phone')).toHaveValue(P.phone);

  // --- located AND highlighted ----------------------------------------------------------------
  const marker = await fixture.overlay.rect('.jf-marker--next');
  expect(marker, 'the overlay drew no next-step marker').not.toBeNull();

  const button = await page
    .locator('[data-automation-id="bottom-navigation-next-button"]')
    .boundingBox();
  expect(button).not.toBeNull();

  if (marker !== null && button !== null) {
    // The marker is the button's rectangle with the overlay's 3px breathing room — assert it is
    // drawn *on that control*, not merely somewhere on the page.
    const markerCentre = { x: marker.x + marker.width / 2, y: marker.y + marker.height / 2 };
    const buttonCentre = { x: button.x + button.width / 2, y: button.y + button.height / 2 };
    expect(Math.abs(markerCentre.x - buttonCentre.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(markerCentre.y - buttonCentre.y)).toBeLessThanOrEqual(2);
    expect(marker.width).toBeGreaterThanOrEqual(button.width);
    expect(marker.height).toBeGreaterThanOrEqual(button.height);
  }

  const badge = await fixture.overlay.text('.jf-marker--next .jf-marker__badge');
  expect(badge).toBe('Next step — you press it');

  // The review panel says the same thing in words, naming the control it found.
  const callout = await fixture.overlay.text('.jf-callout--next');
  expect(callout).toContain('Next step is here');
  expect(callout).toContain('Save and Continue');
  expect(callout).toContain('will never press it');

  // --- INV-1: never pressed -------------------------------------------------------------------
  await expect(page.locator('#nav-press-log')).toHaveAttribute('data-presses', '0');
  expect(navigations, 'the page navigated during a fill').toBe(0);
  await expect(page.locator('#step-2')).toBeHidden();
});

test('the human presses Next, the observer re-scans, and step 2 fills from the work history', async ({
  jobfill,
}) => {
  const fixture = await jobfill.openFixture('/live/workday-wizard.html');
  const page = fixture.page;

  await fixture.fill();
  await expect(page.locator('#nav-press-log')).toHaveAttribute('data-presses', '0');

  // The human does what JobFill will not: a real, trusted mouse press on the wizard control.
  await page.locator('[data-automation-id="bottom-navigation-next-button"]').click();

  await expect(page.locator('#nav-press-log')).toHaveAttribute('data-presses', '1');
  await expect(page.locator('#step-2')).toBeVisible();
  await expect(page.locator('#page-header')).toHaveText('My Experience');
  await expect(page.locator('#step-marker-2')).toHaveAttribute('aria-current', 'step');

  // Step 2's fields did not exist during the first run. `core/observer.ts` re-scans on the step
  // change, so the second fill finds them.
  const second = await fixture.fill();
  expect(second.errors).toBe(0);

  expect(WORK, 'the e2e profile must carry a work entry for this test').toBeDefined();
  if (WORK !== undefined) {
    await expect(page.locator('#input-title')).toHaveValue(WORK.title);
    await expect(page.locator('#input-company')).toHaveValue(WORK.company);
    await expect(page.locator('#input-work-location')).toHaveValue(WORK.location);
  }

  // Still exactly one press — the one the test made. The second fill added none.
  await expect(page.locator('#nav-press-log')).toHaveAttribute('data-presses', '1');
});

test('the corpus Workday step-1 snapshot gets the same treatment', async ({ jobfill }) => {
  const fixture = await jobfill.openFixture('/corpus/workday/step1-my-information.html');
  const report = await fixture.fill();

  expect(report.atsId).toBe('workday');

  const page = fixture.page;
  await expect(page.locator('#input-2')).toHaveValue(P.firstName);
  await expect(page.locator('#input-3')).toHaveValue(P.lastName);
  await expect(page.locator('#input-8')).toHaveValue(P.email);

  // The hidden "My Experience" fieldset is pre-rendered in this snapshot. The scanner must not
  // offer to fill a step the human has not reached.
  await expect(page.locator('#input-11')).toHaveValue('');
  await expect(page.locator('#input-12')).toHaveValue('');

  const callout = await fixture.overlay.text('.jf-callout--next');
  expect(callout).toContain('Save and Continue');
  expect(await fixture.overlay.text('.jf-marker--next .jf-marker__badge')).toBe(
    'Next step — you press it',
  );
});
