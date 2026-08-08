/**
 * inv1.spec.ts — the headline invariant, in a real browser.
 *
 * INV-1: **Never auto-submit.** "No code path may call `.click()`/`.submit()` on a submit or
 * 'next step' button. Locate + highlight only."
 *
 * `tests/unit/inv1.test.ts` already proves this by static analysis and by spying on prototypes
 * inside happy-dom. That is necessary and not sufficient: happy-dom does not navigate, does not
 * run the MAIN-world script, and does not have a service worker, so "the application was never
 * submitted" is a claim it cannot evaluate. This file evaluates it, by watching for the effect
 * rather than for any particular call.
 *
 * ── The tripwires, and exactly what each one covers ─────────────────────────────────────────────
 *
 *   `submit` listener (capture, document)   Fires for a real submit-button activation, for
 *                                           `form.requestSubmit()`, and for implicit submission
 *                                           (Enter in a lone text input) — from EITHER world,
 *                                           because the event is dispatched on the element, not on
 *                                           a per-world prototype. This is the assertion that
 *                                           covers the ISOLATED-world content script.
 *   `click` listener (capture, document)    Records any click that lands on a submit control or a
 *                                           wizard "next" control, wherever it came from.
 *   patched `HTMLFormElement.prototype`     Installed in the page's MAIN world before any script
 *   (`submit` / `requestSubmit`)            runs, so it is the prototype `main-world.content.ts`
 *                                           — JobFill's native-setter bridge — resolves against.
 *   navigation counter (`framenavigated`)   Catches `form.submit()`, which fires no submit event,
 *                                           and any other way a page could leave.
 *
 * Taken together: no submission of any kind occurred, by any mechanism, in any world.
 *
 * The last test is the control: it presses Submit itself and asserts the tripwires DO fire, so a
 * green run above can never be the instrument silently not working.
 */

import { expect, test } from './helpers/extension';

/** Every fixture the suite has, corpus and live. Each is filled end to end. */
const ALL_FIXTURES = [
  '/corpus/greenhouse/standard.html',
  '/corpus/lever/standard.html',
  '/corpus/ashby/standard.html',
  '/corpus/generic/plain-career-form.html',
  '/corpus/workday/step1-my-information.html',
  '/live/ashby-typeahead.html',
  '/live/workday-wizard.html',
  '/live/upload-dropzone.html',
  '/live/second-application.html',
] as const;

interface Inv1Log {
  submits: string[];
  submitClicks: string[];
  requestSubmitCalls: number;
  formSubmitCalls: number;
}

/**
 * Arms the page before anything else runs. Kept free of closures on purpose — Playwright
 * serialises this function into the page.
 */
function armTripwires(): void {
  const log: Inv1Log = {
    submits: [],
    submitClicks: [],
    requestSubmitCalls: 0,
    formSubmitCalls: 0,
  };
  (window as unknown as { __jfInv1: Inv1Log }).__jfInv1 = log;

  const describe = (node: EventTarget | null): string => {
    if (!(node instanceof Element)) return 'unknown';
    const id = node.id.length > 0 ? `#${node.id}` : '';
    const automation = node.getAttribute('data-automation-id');
    return `${node.tagName.toLowerCase()}${id}${automation === null ? '' : `[${automation}]`}`;
  };

  const isForwardControl = (node: EventTarget | null): boolean => {
    if (!(node instanceof Element)) return false;
    const el = node.closest(
      'button, input[type="submit"], input[type="image"], [role="button"], [data-automation-id]',
    );
    if (el === null) return false;
    // `<button>` with no type attribute reports `type === 'submit'` — the default is a submitter.
    if (el instanceof HTMLButtonElement && el.type === 'submit') return true;
    if (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'image')) return true;
    const automation = el.getAttribute('data-automation-id') ?? '';
    return automation.includes('next-button') || automation.includes('bottom-navigation');
  };

  document.addEventListener(
    'submit',
    (event) => {
      log.submits.push(describe(event.target));
      // Do not actually navigate: a real submission would end the test before it could assert.
      event.preventDefault();
    },
    true,
  );

  document.addEventListener(
    'click',
    (event) => {
      if (isForwardControl(event.target)) log.submitClicks.push(describe(event.target));
    },
    true,
  );

  // MAIN-world prototype patches. `main-world.content.ts` runs in this world and resolves these.
  const proto = HTMLFormElement.prototype as unknown as Record<string, unknown>;
  proto['requestSubmit'] = function patchedRequestSubmit(): void {
    log.requestSubmitCalls += 1;
  };
  proto['submit'] = function patchedSubmit(): void {
    log.formSubmitCalls += 1;
  };
}

async function readLog(page: import('@playwright/test').Page): Promise<Inv1Log> {
  return page.evaluate(
    () =>
      (window as unknown as { __jfInv1: Inv1Log }).__jfInv1 ?? {
        submits: [],
        submitClicks: [],
        requestSubmitCalls: 0,
        formSubmitCalls: 0,
      },
  );
}

test.beforeEach(async ({ jobfill }) => {
  await jobfill.seed({ withKey: false });
});

for (const path of ALL_FIXTURES) {
  test(`INV-1: a full fill on ${path} submits nothing and navigates nowhere`, async ({
    jobfill,
  }) => {
    const fixture = await jobfill.openFixture(path, { initScript: armTripwires });
    const page = fixture.page;
    const startUrl = page.url();

    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });

    const report = await fixture.fill();
    expect(report.errors).toBe(0);
    // The run must actually have done something, or "nothing was submitted" is vacuous.
    expect(report.perField.length).toBeGreaterThan(0);

    const log = await readLog(page);
    expect(log.submits, 'a submit event was dispatched during a JobFill run').toEqual([]);
    expect(log.submitClicks, 'JobFill clicked a submit / next-step control').toEqual([]);
    expect(log.requestSubmitCalls, 'form.requestSubmit() was called').toBe(0);
    expect(log.formSubmitCalls, 'form.submit() was called').toBe(0);
    expect(navigations, 'the page navigated during a JobFill run').toBe(0);
    expect(page.url()).toBe(startUrl);

    // …while the control the human needs was found and outlined (locate + highlight only).
    expect(await fixture.overlay.count('.jf-marker--next')).toBe(1);
    expect(await fixture.overlay.text('.jf-marker--next .jf-marker__badge')).toMatch(
      /you press it$/,
    );
  });
}

test('INV-1 holds through the ✨ path too — an AI answer submits nothing', async ({ jobfill }) => {
  await jobfill.seedKey();

  const fixture = await jobfill.openFixture('/corpus/greenhouse/standard.html', {
    initScript: armTripwires,
  });
  const page = fixture.page;
  const question = page.locator('#job_application_answers_attributes_0_text_value');

  await question.scrollIntoViewIfNeeded();
  await fixture.overlay.click('.jf-spark');
  await fixture.overlay.waitForText('.jf-tag--ai', 'AI draft');
  await fixture.overlay.clickByText('button', 'Insert into form');
  await expect(question).not.toHaveValue('');

  const log = await readLog(page);
  expect(log.submits).toEqual([]);
  expect(log.submitClicks).toEqual([]);
  expect(log.requestSubmitCalls).toBe(0);
  expect(log.formSubmitCalls).toBe(0);
});

test('the tripwires are real: a human press of Submit does trip them', async ({ jobfill }) => {
  const fixture = await jobfill.openFixture('/corpus/greenhouse/standard.html', {
    initScript: armTripwires,
  });

  await fixture.fill();
  expect((await readLog(fixture.page)).submits).toEqual([]);

  // The one thing JobFill may never do, done by a human with a real mouse.
  await fixture.page.locator('#submit_app').click();

  const log = await readLog(fixture.page);
  expect(log.submitClicks).toEqual(['input#submit_app']);
  expect(log.submits).toEqual(['form#application_form']);
});
