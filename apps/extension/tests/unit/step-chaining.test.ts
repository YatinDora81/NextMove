import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getOverlay } from '@/content';
import { FormScanner, nodeElement } from '@/core';
import { REASON, type FillEngineOptions, type FillFieldEvent } from '@/core/fill';
import { disposePageObserver } from '@/core/observer';
import { setSettings } from '@/platform/storage';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import { makeEnvelope, okReply } from '@/shared/messages';
import type { FillReport, MatchResult, Settings } from '@/shared/types';

import { FIXTURE_URLS, makeProfile, readFixture, resetBrowserMock, type BrowserMock } from '../setup';

const { runFillMock } = vi.hoisted(() => ({
  runFillMock:
    vi.fn<(matches: readonly MatchResult[], options: FillEngineOptions) => Promise<FillReport>>(),
}));

vi.mock('@/core/fill', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/fill')>();
  return { ...actual, runFill: runFillMock };
});

const HERE = dirname(fileURLToPath(import.meta.url));

const STEP1_HTML = readFixture('workday');
const STEP2_HTML = readFileSync(
  join(HERE, '..', 'fixtures', 'workday', 'step2-my-experience.html'),
  'utf8',
);

const STEP1_URL = FIXTURE_URLS.workday;
const NAVIGATED_URL = `${FIXTURE_URLS.workday}/review`;

const SWAP_POINT = '[data-automation-id="jobApplicationPage"]';

const FILLED_VALUE = 'written-by-the-fake-engine';

function fakeFillRun(
  matches: readonly MatchResult[],
  options: FillEngineOptions,
): Promise<FillReport> {
  const report: FillReport = {
    atsId: String(options.atsId),
    url: options.url,
    filled: 0,
    suggested: 0,
    skipped: 0,
    errors: 0,
    perField: [],
  };

  for (const match of matches) {
    const action = match.action;
    const ok = action !== 'skip';
    const el = nodeElement(match.node);
    const event: FillFieldEvent = {
      hash: match.node.sig.hash,
      path: match.path,
      score: match.score,
      action,
      value: ok ? FILLED_VALUE : '',
      ok,
      el: el instanceof HTMLElement ? el : null,
      sig: match.node.sig,
      selector: null,
    };
    options.onField?.(event);
    report.perField.push({ hash: event.hash, action, ok });
    if (action === 'fill') report.filled += 1;
    else if (action === 'suggest') report.suggested += 1;
    else report.skipped += 1;
  }

  return Promise.resolve(report);
}

/**
 * A run where the engine wrote nothing at all: every field the matcher recognised came back as a
 * skip carrying `reason`. `already-answered` is the interesting one — the field was recognised and
 * deliberately left alone — and it reports 0 filled / 0 suggested, exactly like a page where
 * nothing matched.
 */
function fakeSkipAllRun(
  reason: string,
): (matches: readonly MatchResult[], options: FillEngineOptions) => Promise<FillReport> {
  return (matches, options) => {
    const report: FillReport = {
      atsId: String(options.atsId),
      url: options.url,
      filled: 0,
      suggested: 0,
      skipped: 0,
      errors: 0,
      perField: [],
    };

    for (const match of matches) {
      const el = nodeElement(match.node);
      const event: FillFieldEvent = {
        hash: match.node.sig.hash,
        path: match.path,
        score: match.score,
        action: 'skip',
        value: '',
        ok: false,
        reason,
        el: el instanceof HTMLElement ? el : null,
        sig: match.node.sig,
        selector: null,
      };
      options.onField?.(event);
      report.perField.push({ hash: event.hash, action: 'skip', ok: false });
      report.skipped += 1;
    }

    return Promise.resolve(report);
  };
}

function backgroundStub(...args: unknown[]): unknown {
  const message = args[0];
  if (typeof message !== 'object' || message === null) return undefined;
  const type = (message as { type?: unknown }).type;

  switch (type) {
    case 'PROFILE_GET':
      return okReply({ profile: makeProfile() });
    case 'FIELD_MAP_GET':
      return okReply({ mappings: {} });
    case 'FIELD_MAP_SAVE':
      return okReply({ saved: true });
    case 'FILL_REPORT':
      return okReply({ logged: true, applicationId: 'app_test_0001' });
    case 'KEYS_STATUS':
      return okReply({ keys: [], pool: [], model: null });
    case 'ANSWERS_SAVE':
      return okReply({
        record: {
          id: 'ans_test_0001',
          qRaw: '',
          qNorm: '',
          answer: '',
          source: 'user',
          scope: 'global',
          profileId: null,
          company: null,
          usedCount: 0,
          createdAt: 0,
          updatedAt: 0,
        },
        created: true,
      });
    default:
      return undefined;
  }
}

function setUrl(url: string): void {
  (window as unknown as { happyDOM: { setURL(value: string): void } }).happyDOM.setURL(url);
}

function writeDocument(html: string): void {
  document.open();
  document.write(html);
  document.close();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(15);
  }
  throw new Error(`timed out waiting for ${what}`);
}

interface FakeContentScriptContext {
  onInvalidated(fn: () => void): void;
}

interface ContentScriptModule {
  default: { main(ctx: FakeContentScriptContext): void };
}

let teardownContentScript: (() => void) | null = null;
let mock: BrowserMock;

async function bootContentScript(html: string, url: string, patch: Partial<Settings>): Promise<void> {
  mock = resetBrowserMock();
  mock.runtime.onMessage.addListener(backgroundStub);
  await setSettings({ ...DEFAULT_SETTINGS, ...patch });

  setUrl(url);
  writeDocument(html);

  Object.defineProperty(globalThis, 'defineContentScript', {
    value: <T,>(definition: T): T => definition,
    configurable: true,
    writable: true,
  });

  const contentScript = (await import('@/entrypoints/content')) as unknown as ContentScriptModule;
  contentScript.default.main({
    onInvalidated: (fn) => {
      teardownContentScript = fn;
    },
  });
}

function fills(): number {
  return runFillMock.mock.calls.length;
}

function panel(): HTMLElement {
  return getOverlay().layer('panel');
}

function panelTitle(): string {
  return panel().querySelector('.jf-panel__title')?.textContent ?? '';
}

function panelSubtitle(): string {
  return panel().querySelector('.jf-panel__sub')?.textContent ?? '';
}

function panelRowLabels(): string[] {
  return [...panel().querySelectorAll('.jf-row__label')].map((el) =>
    (el.textContent ?? '').replace(/\s*\*$/, '').trim(),
  );
}

function sentPayload(type: string): Record<string, unknown> | null {
  for (const sent of mock.__sent) {
    const envelope = sent as { type?: unknown; payload?: unknown };
    if (envelope.type !== type) continue;
    if (typeof envelope.payload !== 'object' || envelope.payload === null) continue;
    return envelope.payload as Record<string, unknown>;
  }
  return null;
}

function pillMounted(): boolean {
  return getOverlay().layer('pill').childElementCount > 0;
}

function swapStep(html: string): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const incoming = parsed.querySelector(SWAP_POINT);
  const live = document.querySelector(SWAP_POINT);
  if (incoming === null || live === null) throw new Error('the swap point is missing');
  live.replaceWith(document.importNode(incoming, true));
}

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function syntheticStep(stepLabel: string, labels: readonly string[]): string {
  const fields = labels
    .map((label) => {
      const id = slug(label);
      return `
            <div data-automation-id="formField-${id}">
              <label for="${id}">${label}</label>
              <input type="text" id="${id}" data-automation-id="${id}" />
            </div>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Apply - Data Engineer II - Grimsby Aerospace</title>
  </head>
  <body>
    <div data-automation-id="jobApplicationPage">
      <div data-automation-id="applyFlowPage">
        <ol data-automation-id="progressBar">
          <li data-automation-id="progressBarActiveStep" aria-current="step">${stepLabel}</li>
        </ol>
        <h2 data-automation-id="pageHeader">${stepLabel}</h2>
        <form action="#" method="post" novalidate>${fields}
          <div data-automation-id="bottom-navigation">
            <button type="button" data-automation-id="bottom-navigation-next-button">
              Save and Continue
            </button>
          </div>
        </form>
      </div>
    </div>
  </body>
</html>`;
}

function keyDefiningFields(): HTMLInputElement[] {
  const fields = [...new FormScanner({ frameId: 0 }).scan().fields].sort((a, b) =>
    a.sig.hash < b.sig.hash ? -1 : 1,
  );
  const ends = [fields[0], fields[fields.length - 1]];
  const out: HTMLInputElement[] = [];
  for (const field of ends) {
    if (field === undefined) continue;
    const el = nodeElement(field);
    if (el instanceof HTMLInputElement) out.push(el);
  }
  return out;
}

function hashesOf(html: string): Set<string> {
  writeDocument(html);
  const scan = new FormScanner({ frameId: 0 }).scan();
  return new Set(scan.fields.map((field) => field.sig.hash));
}

function sharedCount(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0;
  for (const value of a) {
    if (b.has(value)) shared += 1;
  }
  return shared;
}

const STEP_LABEL = 'My Information';

const BASE_LABELS = [
  'First Name',
  'Last Name',
  'Email Address',
  'Phone Number',
  'Address Line 1',
  'City',
  'Postal Code',
  'Country of Residence',
  'Preferred Name',
  'How Did You Hear About Us',
] as const;

const REPLACEMENT_LABELS = [
  'Job Title',
  'Employer',
  'Work Location',
  'Start Date',
  'End Date',
  'Degree Awarded',
  'School or University',
  'Field of Study',
  'Notice Period',
  'LinkedIn Profile',
] as const;

function withKept(kept: number): string[] {
  const keep = BASE_LABELS.slice(0, kept);
  const replace = REPLACEMENT_LABELS.slice(0, BASE_LABELS.length - kept);
  return [...keep, ...replace];
}

describe('content script — step identity, chaining and panel state', () => {
  beforeEach(() => {
    runFillMock.mockImplementation(fakeFillRun);
  });

  afterEach(async () => {
    teardownContentScript?.();
    teardownContentScript = null;
    disposePageObserver();
    await sleep(10);
  });

  describe('step-swap threshold', () => {
    it('treats a field set sharing 3 of 10 hashes as a new step and refills it', async () => {
      const before = hashesOf(syntheticStep(STEP_LABEL, [...BASE_LABELS]));
      const after = hashesOf(syntheticStep(STEP_LABEL, withKept(3)));
      expect(before.size).toBe(10);
      expect(after.size).toBe(10);
      expect(sharedCount(before, after)).toBe(3);

      await bootContentScript(syntheticStep(STEP_LABEL, [...BASE_LABELS]), STEP1_URL, {
        autoFillOnLoad: true,
        humanPacing: false,
      });
      await waitFor(() => fills() === 1, 'the first auto-fill');
      expect(panelRowLabels()).toContain('First Name');

      swapStep(syntheticStep(STEP_LABEL, withKept(3)));
      await waitFor(() => fills() === 2, 'the swapped-in step to be filled');
      await sleep(600);

      expect(fills()).toBe(2);
      expect(panelRowLabels()).toContain('Job Title');
      expect(panelRowLabels()).not.toContain('Postal Code');
    });

    it('treats a 10-field form that grew by 2 fields as the same step and does not refill', async () => {
      const before = hashesOf(syntheticStep(STEP_LABEL, [...BASE_LABELS]));
      const grown = hashesOf(
        syntheticStep(STEP_LABEL, [...BASE_LABELS, ...REPLACEMENT_LABELS.slice(0, 2)]),
      );
      expect(before.size).toBe(10);
      expect(grown.size).toBe(12);
      expect(sharedCount(before, grown)).toBe(10);

      await bootContentScript(syntheticStep(STEP_LABEL, [...BASE_LABELS]), STEP1_URL, {
        autoFillOnLoad: true,
        humanPacing: false,
      });
      await waitFor(() => fills() === 1, 'the first auto-fill');

      swapStep(syntheticStep(STEP_LABEL, [...BASE_LABELS, ...REPLACEMENT_LABELS.slice(0, 2)]));
      await sleep(1_500);

      expect(fills()).toBe(1);
      expect(panelRowLabels()).toContain('Email Address');
    });

    it('treats a field set sharing exactly 4 of 10 hashes as the same step', async () => {
      const before = hashesOf(syntheticStep(STEP_LABEL, [...BASE_LABELS]));
      const after = hashesOf(syntheticStep(STEP_LABEL, withKept(4)));
      expect(sharedCount(before, after)).toBe(4);

      await bootContentScript(syntheticStep(STEP_LABEL, [...BASE_LABELS]), STEP1_URL, {
        autoFillOnLoad: true,
        humanPacing: false,
      });
      await waitFor(() => fills() === 1, 'the first auto-fill');

      swapStep(syntheticStep(STEP_LABEL, withKept(4)));
      await sleep(1_500);

      expect(fills()).toBe(1);
    });
  });

  describe('scan key', () => {
    it('ignores what the user typed but not a field set of the same size', async () => {
      const before = hashesOf(syntheticStep(STEP_LABEL, [...BASE_LABELS]));
      const after = hashesOf(syntheticStep(STEP_LABEL, withKept(0)));
      expect(before.size).toBe(10);
      expect(after.size).toBe(10);
      expect(sharedCount(before, after)).toBe(0);

      await bootContentScript(syntheticStep(STEP_LABEL, [...BASE_LABELS]), STEP1_URL, {
        autoFillOnLoad: true,
        humanPacing: false,
      });
      await waitFor(() => fills() === 1, 'the first auto-fill');

      const sampled = keyDefiningFields();
      expect(sampled).toHaveLength(2);
      for (const el of sampled) {
        el.value = 'typed by the user';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }

      window.dispatchEvent(new Event('popstate'));
      await sleep(1_500);
      expect(fills()).toBe(1);

      swapStep(syntheticStep(STEP_LABEL, withKept(0)));
      window.dispatchEvent(new Event('popstate'));
      await waitFor(() => fills() === 2, 'the replaced field set to be filled');
      expect(fills()).toBe(2);
    });
  });

  describe('panel reset', () => {
    it('empties the rows and zeroes the stats when the page navigates', async () => {
      await bootContentScript(STEP1_HTML, STEP1_URL, {
        autoFillOnLoad: false,
        autoFillNextSteps: false,
      });
      await waitFor(pillMounted, 'the content script to finish its first evaluate');

      mock.__emitMessage(makeEnvelope('FILL_REQUEST', { profileId: null, trigger: 'popup' }));
      await waitFor(() => fills() === 1, 'the requested fill');
      await waitFor(() => panelRowLabels().length > 0, 'the review panel to list its rows');
      expect(panelTitle()).toMatch(/^Filled \d+ of \d+ fields$/);

      setUrl(NAVIGATED_URL);
      await waitFor(() => panelRowLabels().length === 0, 'the panel to empty on navigation');

      expect(panelTitle()).toBe('Nothing to fill on this page');
      expect(panelSubtitle()).toBe('Workday · 0 to check · 0 left for you');
      expect(fills()).toBe(1);
    });
  });

  describe('chained auto-fill', () => {
    it('fills the next step exactly once after the user filled the first one', async () => {
      const clicked: string[] = [];
      const realClick = HTMLElement.prototype.click;
      vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(function patchedClick(
        this: HTMLElement,
      ): void {
        clicked.push(this.getAttribute('data-automation-id') ?? this.tagName);
        realClick.call(this);
      });

      await bootContentScript(STEP1_HTML, STEP1_URL, {
        autoFillOnLoad: false,
        autoFillNextSteps: true,
        humanPacing: false,
      });
      await waitFor(pillMounted, 'the content script to finish its first evaluate');
      expect(fills()).toBe(0);

      mock.__emitMessage(makeEnvelope('FILL_REQUEST', { profileId: null, trigger: 'popup' }));
      await waitFor(() => fills() === 1, 'the fill the user asked for on step 1');
      await waitFor(() => panelRowLabels().length > 0, 'step 1 rows');

      swapStep(STEP2_HTML);
      await waitFor(() => fills() === 2, 'step 2 to be auto-filled');
      await sleep(1_500);

      expect(fills()).toBe(2);
      expect(panelRowLabels()).toContain('Job Title');
      expect(clicked).toEqual([]);
    });

    it('does not refill a step the user filled by hand when the wizard returns to it', async () => {
      await bootContentScript(STEP1_HTML, STEP1_URL, {
        autoFillOnLoad: false,
        autoFillNextSteps: true,
        humanPacing: false,
      });
      await waitFor(pillMounted, 'the content script to finish its first evaluate');

      mock.__emitMessage(makeEnvelope('FILL_REQUEST', { profileId: null, trigger: 'popup' }));
      await waitFor(() => fills() === 1, 'the fill the user asked for on step 1');

      swapStep(STEP2_HTML);
      await waitFor(() => fills() === 2, 'step 2 to be auto-filled');
      await waitFor(() => panelRowLabels().includes('Job Title'), 'step 2 rows');

      swapStep(STEP1_HTML);
      await sleep(1_500);

      expect(fills()).toBe(2);
    });

    it('arms the chain when step 1 was recognised and deliberately left alone', async () => {
      // Every field on step 1 already carries the user's answer, so the run writes nothing: 0
      // filled, 0 suggested. That is still "we recognised this page", and the later, genuinely
      // empty steps must keep being filled for the user.
      runFillMock.mockImplementation(fakeSkipAllRun(REASON.alreadyAnswered));

      await bootContentScript(STEP1_HTML, STEP1_URL, {
        autoFillOnLoad: false,
        autoFillNextSteps: true,
        humanPacing: false,
      });
      await waitFor(pillMounted, 'the content script to finish its first evaluate');

      mock.__emitMessage(makeEnvelope('FILL_REQUEST', { profileId: null, trigger: 'popup' }));
      await waitFor(() => fills() === 1, 'the fill the user asked for on step 1');
      await waitFor(() => panelRowLabels().length > 0, 'step 1 rows');

      runFillMock.mockImplementation(fakeFillRun);
      swapStep(STEP2_HTML);
      await waitFor(() => fills() === 2, 'the empty step 2 to be auto-filled');
      expect(panelRowLabels()).toContain('Job Title');
    });

    it('does not arm the chain when nothing on step 1 was recognised', async () => {
      // `no-value` is the other 0-filled/0-suggested shape: fields we know nothing about. Nothing
      // was respected here, so there is no evidence the chain belongs to this wizard.
      runFillMock.mockImplementation(fakeSkipAllRun(REASON.noValue));

      await bootContentScript(STEP1_HTML, STEP1_URL, {
        autoFillOnLoad: false,
        autoFillNextSteps: true,
        humanPacing: false,
      });
      await waitFor(pillMounted, 'the content script to finish its first evaluate');

      mock.__emitMessage(makeEnvelope('FILL_REQUEST', { profileId: null, trigger: 'popup' }));
      await waitFor(() => fills() === 1, 'the fill the user asked for on step 1');
      await waitFor(() => panelRowLabels().length > 0, 'step 1 rows');

      swapStep(STEP2_HTML);
      await sleep(1_500);

      expect(fills()).toBe(1);
    });

    it('does not fill a step whose key it has already auto-filled', async () => {
      await bootContentScript(STEP1_HTML, STEP1_URL, {
        autoFillOnLoad: true,
        autoFillNextSteps: true,
        humanPacing: false,
      });
      await waitFor(() => fills() === 1, 'step 1 to be auto-filled');

      swapStep(STEP2_HTML);
      await waitFor(() => fills() === 2, 'step 2 to be auto-filled');
      await waitFor(() => panelRowLabels().includes('Job Title'), 'step 2 rows');

      swapStep(STEP1_HTML);
      await sleep(1_500);

      expect(fills()).toBe(2);
    });
  });

  describe('already-answered rows', () => {
    it('explains the row instead of flagging it red with no reason', async () => {
      runFillMock.mockImplementation(fakeSkipAllRun(REASON.alreadyAnswered));

      await bootContentScript(STEP1_HTML, STEP1_URL, {
        autoFillOnLoad: true,
        autoFillNextSteps: false,
        humanPacing: false,
      });
      await waitFor(() => fills() === 1, 'the first auto-fill');
      await waitFor(() => panelRowLabels().length > 0, 'the review panel to list its rows');

      // A field NextMove deliberately respected is not a field that needs the user.
      expect(panel().querySelectorAll('.jf-row--unmatched')).toHaveLength(0);
      expect(panel().querySelectorAll('.jf-row--answered').length).toBeGreaterThan(0);
      expect(panel().textContent ?? '').toContain(
        'You have already answered this — NextMove left it alone.',
      );
    });
  });

  describe('focus awareness', () => {
    it('surfaces the focused field in the panel and banks what the user typed', async () => {
      await bootContentScript(STEP1_HTML, STEP1_URL, { autoFillOnLoad: false });
      await waitFor(pillMounted, 'the content script to finish its first evaluate');

      const target = document.querySelector<HTMLInputElement>('#input-9');
      if (target === null) throw new Error('the phone field is missing from the fixture');
      target.value = 'Only reachable on weekday evenings';
      target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      await waitFor(() => panelRowLabels().includes('Phone Number'), 'the focused row');
      const rowText = panel().textContent ?? '';
      expect(rowText).toContain('map it once');
      expect(rowText).toContain('Save what I typed as a reusable answer');

      const button = [...panel().querySelectorAll('button')].find(
        (el) => (el.textContent ?? '').trim() === 'Save what I typed as a reusable answer',
      );
      if (button === undefined) throw new Error('the panel offered no way to bank the answer');
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      await waitFor(() => sentPayload('ANSWERS_SAVE') !== null, 'the answer to reach the background');
      expect(sentPayload('ANSWERS_SAVE')).toMatchObject({
        qRaw: 'Phone Number',
        answer: 'Only reachable on weekday evenings',
        source: 'user',
      });
    });
  });
});
