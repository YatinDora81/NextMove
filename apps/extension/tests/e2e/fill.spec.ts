/**
 * fill.spec.ts — SEC 11 e2e: "Full fill flow per adapter".
 *
 * The unit layer can prove that the matcher *chose* `personal.firstName` for a field. It cannot
 * prove that the character sequence "Riya" is sitting in that input afterwards, because happy-dom
 * has no layout, no native value setters worth the name, no MAIN world, and no framework to fight
 * with. This file makes exactly that assertion, in Chrome, against the shipped unpacked build:
 * real content script → real scanner → real matcher → real strategies → real DOM values.
 *
 * Coverage per SEC 11's corpus: greenhouse, lever, ashby, generic. Workday has its own file
 * (`workday-steps.spec.ts`) because its interesting property is the wizard, not the fields.
 *
 * INV-4 shows up here as a *positive* assertion too: the honeypot Greenhouse plants
 * (`#leave_this_blank`) and Lever's reference fields must come out untouched, and the report's
 * `suggested`/`skipped` counts must be non-zero rather than everything being force-filled.
 */

import { expect, test } from './helpers/extension';
import { E2E_PROFILE } from './helpers/profile';

const P = E2E_PROFILE.personal;
const L = E2E_PROFILE.links;

test.beforeEach(async ({ jobfill }) => {
  await jobfill.seed({ withKey: false });
});

test('greenhouse: identity, contact, links and the EEO selects land in the page', async ({
  jobfill,
}) => {
  const fixture = await jobfill.openFixture('/corpus/greenhouse/standard.html');
  const report = await fixture.fill();

  expect(report.atsId).toBe('greenhouse');
  expect(report.errors).toBe(0);
  expect(report.filled).toBeGreaterThan(0);

  const page = fixture.page;
  await expect(page.locator('#first_name')).toHaveValue(P.firstName);
  await expect(page.locator('#last_name')).toHaveValue(P.lastName);
  await expect(page.locator('#email')).toHaveValue(P.email);
  await expect(page.locator('#phone')).toHaveValue(P.phone);

  // Greenhouse puts custom questions behind generated ids; the LinkedIn one is answer #1.
  await expect(page.locator('#job_application_answers_attributes_1_text_value')).toHaveValue(
    L.linkedin,
  );

  // `<select>` fills go through the option ranker, not through raw value assignment.
  await expect(page.locator('#job_application_gender')).toHaveValue('Female');
  await expect(page.locator('#job_application_race')).toHaveValue('Asian');
  await expect(page.locator('#job_application_veteran_status')).toHaveValue(
    'I am not a protected veteran',
  );
  await expect(page.locator('#job_application_disability_status')).toHaveValue('No');

  // INV-4 / SEC 6.2: the spam trap must stay empty. Filling it silently discards the application.
  await expect(page.locator('#leave_this_blank')).toHaveValue('');

  // SEC 6.3's `-20` conflicting-section modifier: "Name"/"Email" under a *References* heading are
  // not the applicant's, so they must not receive the applicant's details.
  await expect(page.locator('#job_application_answers_attributes_3_text_value')).not.toHaveValue(
    `${P.firstName} ${P.lastName}`,
  );
  await expect(page.locator('#job_application_answers_attributes_4_text_value')).not.toHaveValue(
    P.email,
  );
});

test('lever: the wrapping-label strategy resolves every field and all three link slots fill', async ({
  jobfill,
}) => {
  const fixture = await jobfill.openFixture('/corpus/lever/standard.html');
  const report = await fixture.fill();

  expect(report.atsId).toBe('lever');
  expect(report.errors).toBe(0);

  const page = fixture.page;
  // Lever asks for one combined name — DERIVED_PATHS.fullName, not two inputs.
  await expect(page.locator('input[name="name"]')).toHaveValue(`${P.firstName} ${P.lastName}`);
  await expect(page.locator('input[name="email"]')).toHaveValue(P.email);
  await expect(page.locator('input[name="phone"]')).toHaveValue(P.phone);

  await expect(page.locator('input[name="urls\\[LinkedIn\\]"]')).toHaveValue(L.linkedin);
  await expect(page.locator('input[name="urls\\[GitHub\\]"]')).toHaveValue(L.github);
  await expect(page.locator('input[name="urls\\[Portfolio\\]"]')).toHaveValue(L.portfolio);

  await expect(page.locator('#eeo-gender')).toHaveValue('female');
  await expect(page.locator('#eeo-race')).toHaveValue('asian');
  await expect(page.locator('#eeo-veteran')).toHaveValue('not-veteran');
  await expect(page.locator('#eeo-disability')).toHaveValue('no');
});

test('ashby: react-generated ids resolve and the authorization radio is actually selected', async ({
  jobfill,
}) => {
  const fixture = await jobfill.openFixture('/corpus/ashby/standard.html');
  const report = await fixture.fill();

  expect(report.atsId).toBe('ashby');
  expect(report.errors).toBe(0);

  const page = fixture.page;
  await expect(page.locator('#_systemfield_name')).toHaveValue(`${P.firstName} ${P.lastName}`);
  await expect(page.locator('#_systemfield_email')).toHaveValue(P.email);
  await expect(page.locator('#_systemfield_phone')).toHaveValue(P.phone);
  await expect(page.locator('#_systemfield_linkedin')).toHaveValue(L.linkedin);
  await expect(page.locator('#_systemfield_website')).toHaveValue(L.portfolio);

  // The radio group is a real choice: "authorized to work in the European Union" against a
  // profile that lists the EU in `authorization.authorizedIn` must land on Yes, not on No.
  await expect(page.locator('#auth-yes')).toBeChecked();
  await expect(page.locator('#auth-no')).not.toBeChecked();

  // A custom question with a churning React id (`:r9:`) still receives the compensation figure.
  await expect(page.locator('#\\:r9\\:')).toHaveValue(String(E2E_PROFILE.compensation.expected.amount));
});

test('generic: the fallback adapter fills a plain career form, including the country select', async ({
  jobfill,
}) => {
  const fixture = await jobfill.openFixture('/corpus/generic/plain-career-form.html');
  const report = await fixture.fill();

  expect(report.atsId).toBe('generic');
  expect(report.errors).toBe(0);

  const page = fixture.page;
  await expect(page.locator('#applicant-first')).toHaveValue(P.firstName);
  await expect(page.locator('#applicant-last')).toHaveValue(P.lastName);
  await expect(page.locator('#applicant-email')).toHaveValue(P.email);
  // "Confirm email" is a second field for the same path — it must be filled, not skipped as a dupe.
  await expect(page.locator('#applicant-email-confirm')).toHaveValue(P.email);
  await expect(page.locator('#applicant-phone')).toHaveValue(P.phone);
  await expect(page.locator('#applicant-city')).toHaveValue(P.address.city);
  await expect(page.locator('#applicant-linkedin')).toHaveValue(L.linkedin);
  await expect(page.locator('#applicant-github')).toHaveValue(L.github);

  // `autocomplete="country-name"` is the 95-point tier; the select is matched on the option label
  // ("Germany") and committed as the option's value ("DE").
  await expect(page.locator('#applicant-country')).toHaveValue('DE');

  // The honeypot again, under its generic name.
  await expect(page.locator('#url_trap')).toHaveValue('');
});

test('INV-4: a fill run reports honest counts and never claims to have filled everything', async ({
  jobfill,
}) => {
  const fixture = await jobfill.openFixture('/corpus/greenhouse/standard.html');
  const report = await fixture.fill();

  // Every field the engine touched is accounted for exactly once.
  expect(report.perField.length).toBe(report.filled + report.suggested + report.skipped);

  // "Never guess-fill" is only meaningful if something actually gets left alone: this form has
  // fields no profile can answer (the free-text motivation question, the reference block).
  expect(report.suggested + report.skipped).toBeGreaterThan(0);

  // And the overlay must say so — blue/yellow/red are the F-06 legend, drawn per field.
  const tones = await fixture.overlay.classNames('.jf-marker');
  expect(tones.some((cls) => cls.includes('jf-marker--filled'))).toBe(true);
  expect(tones.some((cls) => cls.includes('jf-marker--suggested') || cls.includes('jf-marker--unmatched'))).toBe(
    true,
  );
});
