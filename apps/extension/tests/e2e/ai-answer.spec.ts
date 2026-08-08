/**
 * ai-answer.spec.ts — SEC 11 e2e: "'AI draft inserted on ✨' with mocked responses", plus the
 * F-17 / SEC 5.7 Answer-Memory claim that the second application costs nothing.
 *
 * SEC 4.3 Flow B, driven the way a person drives it:
 *
 *   ✨ is clicked with a REAL mouse press at the coordinates the overlay drew it at. It lives in a
 *   closed shadow root (SEC 4.4), so its rectangle is resolved over CDP and pressed with
 *   `page.mouse` — no synthetic `element.click()`, no reaching into the extension's internals.
 *   Everything downstream is the shipped build: `GESTURE_MINT` (INV-2), the offline
 *   `ANSWERS_LOOKUP`, the key lease, the Gemini fetch from the service worker, the draft panel,
 *   and the framework-safe write back into the page.
 *
 * The Gemini endpoint is intercepted (`helpers/gemini.ts`) and counted. The counter is the point:
 *
 *   · first application, bank empty      → exactly ONE `:generateContent` request
 *   · second application, same question  → ZERO further requests
 *
 * That second number is the whole of F-17's quota argument, and it is asserted rather than
 * asserted-about. The key in the vault is a fake `AIzaSy…` literal and no request ever leaves the
 * browser.
 */

import { expect, test } from './helpers/extension';

/** `content/overlay/SparkleButton.tsx` — the chip on an AI-origin draft. */
const AI_CHIP = 'AI draft — review before submitting';
/** The chip on a draft that came out of the Answer Bank instead. */
const BANK_CHIP = 'From your Answer Bank';

test.beforeEach(async ({ jobfill }) => {
  await jobfill.seed({ withKey: true });
});

test('✨ inserts an AI draft, chipped and reviewable, for exactly one Gemini call', async ({
  jobfill,
  gemini,
}) => {
  const fixture = await jobfill.openFixture('/corpus/greenhouse/standard.html');
  const page = fixture.page;
  const question = page.locator('#job_application_answers_attributes_0_text_value');

  // The ✨ is only drawn for a question that is on screen (SEC 4.1 — it tracks its anchor).
  await question.scrollIntoViewIfNeeded();
  await expect(question).toHaveValue('');

  // F-09: the affordance appears beside the open-text screening question, and only there.
  // "How did you hear about this position?" and the LinkedIn URL are data fields, not questions.
  expect(await fixture.overlay.count('.jf-spark')).toBe(1);

  expect(gemini.generateCalls).toBe(0);
  await fixture.overlay.click('.jf-spark');

  // Bank is empty ⇒ lookup misses ⇒ one generation, with the gesture nonce minted by the click.
  const chip = await fixture.overlay.waitForText('.jf-tag--ai', AI_CHIP);
  expect(chip).toBe(AI_CHIP);
  expect(gemini.generateCalls).toBe(1);
  expect(gemini.modelsCalled[0]).toBe('gemini-2.5-flash-lite');

  // Nothing has touched the page yet — a draft is a draft until the human accepts it.
  await expect(question).toHaveValue('');

  const draft = await fixture.overlay.text('.jf-answer textarea');
  expect(draft).not.toBeNull();
  expect((draft ?? '').length).toBeGreaterThan(40);

  await fixture.overlay.clickByText('button', 'Insert into form');

  // Now it lands, through the FillEngine's framework-safe write path.
  await expect(question).toHaveValue(draft ?? '');

  // And the user is told, in the words SEC 5.7 step 4 prescribes.
  const toast = await fixture.overlay.waitForText('.jf-toast__title', 'AI draft inserted');
  expect(toast).toContain('review before submitting');

  // One click, one request. No speculative pre-generation anywhere (INV-2).
  expect(gemini.generateCalls).toBe(1);
});

test('the same question at a second employer is served from the bank with ZERO Gemini calls', async ({
  jobfill,
  gemini,
}) => {
  /* ---- application 1: answer it once, and accept the answer ----------------------------------- */

  const first = await jobfill.openFixture('/corpus/greenhouse/standard.html');
  const firstQuestion = first.page.locator('#job_application_answers_attributes_0_text_value');
  await firstQuestion.scrollIntoViewIfNeeded();

  await first.overlay.click('.jf-spark');
  await first.overlay.waitForText('.jf-tag--ai', AI_CHIP);
  const accepted = (await first.overlay.text('.jf-answer textarea')) ?? '';
  expect(accepted.length).toBeGreaterThan(40);

  await first.overlay.clickByText('button', 'Insert into form');
  await expect(firstQuestion).toHaveValue(accepted);

  // The accept upserts it into the bank with `ai` provenance (SEC 5.7 step 4).
  await first.overlay.waitForText('.jf-toast__msg', 'Saved to your Answer Bank');
  expect(gemini.generateCalls).toBe(1);
  await first.close();

  /* ---- the checkpoint -------------------------------------------------------------------------- */

  gemini.reset();
  expect(gemini.generateCalls).toBe(0);

  /* ---- application 2: different employer, same question ---------------------------------------- */

  // "Why do you want to work at Northwind Labs?" and "Why do you want to work at Halcyon Metrics?"
  // both normalise to `why do you want to work at {company}` (answers/normalize.ts), so this is a
  // ≥ SAME_Q (0.92) hit and the bank must answer it outright.
  const second = await jobfill.openFixture('/live/second-application.html');
  const secondQuestion = second.page.locator('#screening-motivation');
  await secondQuestion.scrollIntoViewIfNeeded();
  await expect(secondQuestion).toHaveValue('');

  await second.overlay.click('.jf-spark');

  // The offer panel, not the generating spinner: "You've answered this before".
  const offer = await second.overlay.waitForText('.jf-answer__title', 'answered this before');
  expect(offer).toContain('You');
  expect(await second.overlay.text('.jf-tag--saved')).toBe(BANK_CHIP);

  // The bank lookup is a fully offline read — no key lease, no network (SEC 5.7).
  expect(gemini.generateCalls).toBe(0);
  expect(gemini.validateCalls).toBe(0);

  await second.overlay.clickByText('button', 'Use saved');
  await expect(secondQuestion).toHaveValue(accepted);

  // The claim, stated as an assertion: reusing a banked answer costs nothing (F-17).
  expect(gemini.generateCalls).toBe(0);
});

test('with an empty key vault the ✨ still works offline — the bank path needs no key', async ({
  jobfill,
  gemini,
}) => {
  // INV-3: local-first. Prime the bank through the extension's own bus, then remove every key.
  const banked =
    'What pulled me in is that the reliability work sits with the team that owns the service, ' +
    'rather than being handed to a platform group two floors away.';
  const saved = await jobfill.send<{ record: { id: string } }>('ANSWERS_SAVE', {
    qRaw: 'Why do you want to work at Northwind Labs?',
    answer: banked,
    source: 'user',
    profileId: null,
    company: 'Northwind Labs',
  });
  expect(saved.ok).toBe(true);

  const keys = await jobfill.send<{ keys: Array<{ id: string }> }>('KEYS_STATUS', {});
  expect(keys.ok).toBe(true);
  if (keys.ok) {
    for (const key of keys.data.keys) {
      expect((await jobfill.send('KEYS_DELETE', { id: key.id })).ok).toBe(true);
    }
  }

  gemini.reset();

  const fixture = await jobfill.openFixture('/live/second-application.html');
  const question = fixture.page.locator('#screening-motivation');
  await question.scrollIntoViewIfNeeded();

  await fixture.overlay.click('.jf-spark');
  await fixture.overlay.waitForText('.jf-answer__title', 'answered this before');
  await fixture.overlay.clickByText('button', 'Use saved');

  await expect(question).toHaveValue(banked);
  expect(gemini.generateCalls).toBe(0);
});
