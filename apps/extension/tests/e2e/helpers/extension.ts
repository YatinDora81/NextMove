/**
 * tests/e2e/helpers/extension.ts — the Playwright fixtures for SEC 11's e2e row:
 * "Playwright, persistent context, unpacked build, fixtures served locally".
 *
 * ── Why a persistent context ────────────────────────────────────────────────────────────────────
 * Chrome only loads unpacked extensions into a real profile directory. The default `browser`
 * fixture has no profile, so this suite always launches through `launchPersistentContext` with a
 * throwaway user-data dir per test. That also gives every test a genuinely empty vault, empty
 * answer bank and empty tracker — no cross-test bleed through `chrome.storage`/IndexedDB.
 *
 * ── Getting the extension id ────────────────────────────────────────────────────────────────────
 * The MV3 service worker's URL is `chrome-extension://<id>/background.js`, so the id is just its
 * host. `context.serviceWorkers()` is empty for the first few hundred milliseconds after launch;
 * `waitForEvent('serviceworker')` covers that race.
 *
 * ── Seeding the vault ───────────────────────────────────────────────────────────────────────────
 * `jf.profiles` is sealed with WebCrypto by `platform/storage.ts` (SEC 7.1), so writing it from
 * outside would mean re-implementing the vault. Instead the suite drives the extension's OWN bus
 * from a real Options page (`chrome-extension://<id>/options.html`) — `PROFILE_SAVE`,
 * `PROFILE_ACTIVE_SET`, `KEYS_ADD`. That is the same code path the Options UI uses, which means
 * the seed is only ever as good as the product's own write path. The Options tab doubles as the
 * suite's trusted-UI origin for `tabs.sendMessage`, which is how a fill is triggered: exactly what
 * the popup's "Fill this application" button does (SEC 4.2).
 *
 * ── What is NOT stubbed ─────────────────────────────────────────────────────────────────────────
 * The content script, the scanner, the matcher, the fill strategies, the MAIN-world bridge, the
 * closed-Shadow-DOM overlay, the service worker and the Answer Bank are all the real shipped
 * build. Only Google's endpoint and the F-14 config CDN are intercepted.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';

import type { FillReport, Profile } from '@/shared/types';

import { installGeminiStub, type GeminiStub } from './gemini';
import { Overlay } from './overlay';
import { EXTENSION_BUILD_DIR, chromiumExecutable } from './paths';
import { E2E_PROFILE, FAKE_GEMINI_KEY } from './profile';
import { startFixtureServer, type FixtureServer } from './server';

/* ------------------------------------------------------------------------------------------------
 * Bus plumbing
 * ---------------------------------------------------------------------------------------------- */

export type BusReply<TData> =
  | { ok: true; data: TData }
  | { ok: false; error: { code: string; message: string; retryAt?: number } };

/** Minimal shape of the `chrome` surface the harness touches from an extension page. */
interface ChromeShim {
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  tabs: {
    query(query: Record<string, unknown>): Promise<Array<{ id?: number }>>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
  };
}

function unwrap<TData>(reply: BusReply<TData>, what: string): TData {
  if (reply.ok) return reply.data;
  throw new Error(`${what} failed: ${reply.error.code} — ${reply.error.message}`);
}

/* ------------------------------------------------------------------------------------------------
 * A fixture page under test
 * ---------------------------------------------------------------------------------------------- */

export interface FixturePage {
  readonly page: Page;
  /** Reader/driver for the closed-Shadow-DOM overlay. */
  readonly overlay: Overlay;
  /** Fire a real `FILL_REQUEST` at this tab's content script and return its `FillReport`. */
  fill(profileId?: string | null): Promise<FillReport>;
  /** Every non-empty control value in the page, keyed by id → name → data-automation-id. */
  values(): Promise<Record<string, string>>;
  close(): Promise<void>;
}

export interface OpenFixtureOptions {
  /**
   * Runs in the page's MAIN world before any page script — used by `inv1.spec.ts` to arm its
   * submit/navigation tripwires before the content script has had a chance to touch anything.
   */
  initScript?: () => void;
}

/* ------------------------------------------------------------------------------------------------
 * The harness
 * ---------------------------------------------------------------------------------------------- */

export class JobFill {
  private optionsPage: Page | null = null;
  private readonly opened: FixturePage[] = [];

  constructor(
    readonly context: BrowserContext,
    readonly extensionId: string,
    readonly server: FixtureServer,
  ) {}

  /** The Options tab. Opened lazily, kept for the whole test — it is the suite's trusted UI. */
  async ui(): Promise<Page> {
    if (this.optionsPage === null) {
      const page = await this.context.newPage();
      await page.goto(`chrome-extension://${this.extensionId}/options.html`);
      this.optionsPage = page;
    }
    return this.optionsPage;
  }

  /** Send one bus envelope from the Options page to the service worker. */
  async send<TData>(type: string, payload: unknown): Promise<BusReply<TData>> {
    const ui = await this.ui();
    const raw = await ui.evaluate(
      async (envelope: { type: string; payload: unknown; reqId: string }) => {
        const api = (globalThis as unknown as { chrome: ChromeShim }).chrome;
        return (await api.runtime.sendMessage(envelope)) as unknown;
      },
      { type, payload, reqId: `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}` },
    );
    return raw as BusReply<TData>;
  }

  /**
   * Write the SEC 7.2 profile into the sealed vault and make it active.
   *
   * `overrides` is a shallow merge so a spec can vary one branch of the profile without
   * restating the whole thing.
   */
  async seedProfile(overrides: Partial<Profile> = {}): Promise<Profile> {
    const profile: Profile = { ...E2E_PROFILE, ...overrides };
    unwrap(await this.send<{ profile: Profile }>('PROFILE_SAVE', { profile }), 'PROFILE_SAVE');
    unwrap(
      await this.send<{ activeProfileId: string }>('PROFILE_ACTIVE_SET', {
        profileId: profile.id,
      }),
      'PROFILE_ACTIVE_SET',
    );
    return profile;
  }

  /**
   * Add the obviously-fake BYOK key. `KEYS_ADD` live-validates it against Google (SEC 2.3), which
   * the stub answers — no real request, no real key, but the real code path.
   */
  async seedKey(label = 'e2e stub key'): Promise<void> {
    unwrap(await this.send('KEYS_ADD', { key: FAKE_GEMINI_KEY, label }), 'KEYS_ADD');
  }

  /** Both of the above — the state almost every spec wants. */
  async seed(options: { withKey?: boolean; profile?: Partial<Profile> } = {}): Promise<Profile> {
    const profile = await this.seedProfile(options.profile ?? {});
    if (options.withKey !== false) await this.seedKey();
    return profile;
  }

  /** Open a served fixture in a new tab and wait until JobFill has evaluated the page. */
  async openFixture(path: string, options: OpenFixtureOptions = {}): Promise<FixturePage> {
    const page = await this.context.newPage();
    if (options.initScript !== undefined) await page.addInitScript(options.initScript);
    await page.goto(this.server.url(path), { waitUntil: 'domcontentloaded' });
    // Foreground it: the overlay anchors its ✨ buttons with requestAnimationFrame, and a
    // backgrounded tab is exactly where rAF stops being reliable.
    await page.bringToFront();

    const overlay = await Overlay.attach(this.context, page);
    await waitForOverlay(overlay);

    const fixture: FixturePage = {
      page,
      overlay,
      fill: (profileId: string | null = null) => this.fillTab(page, profileId),
      values: () => readValues(page),
      close: async () => {
        await overlay.dispose();
        await page.close();
      },
    };
    this.opened.push(fixture);
    return fixture;
  }

  /**
   * The SEC 4.3 Flow A trigger, exactly as the popup does it: `FILL_REQUEST` to the active tab.
   *
   * The tab is identified by making it active first — the extension has no `tabs` permission
   * (by design; it does not need to read anyone's URLs), so `tabs.query` returns ids and nothing
   * else, and "the tab the user is looking at" is the only handle the popup has either.
   */
  private async fillTab(page: Page, profileId: string | null): Promise<FillReport> {
    await page.bringToFront();
    const ui = await this.ui();

    const envelope = {
      type: 'FILL_REQUEST',
      reqId: `e2e-fill-${Date.now()}`,
      payload: { profileId, trigger: 'popup' },
    };

    const deadline = Date.now() + 15_000;
    for (;;) {
      try {
        const raw = await ui.evaluate(async (message: unknown) => {
          const api = (globalThis as unknown as { chrome: ChromeShim }).chrome;
          const tabs = await api.tabs.query({ active: true, lastFocusedWindow: true });
          const tab = tabs[0];
          if (tab === undefined || tab.id === undefined) throw new Error('no active tab');
          return (await api.tabs.sendMessage(tab.id, message)) as unknown;
        }, envelope);
        return unwrap(raw as BusReply<FillReport>, 'FILL_REQUEST');
      } catch (error) {
        // The content script registers its listener at document_idle; until then Chrome answers
        // "Receiving end does not exist". Nothing was delivered, so retrying cannot double-fill.
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('Receiving end does not exist') || Date.now() > deadline) throw error;
        await page.waitForTimeout(200);
      }
    }
  }

  async dispose(): Promise<void> {
    for (const fixture of this.opened) {
      await fixture.close().catch(() => undefined);
    }
  }
}

/** Wait until the content script has mounted its overlay host — i.e. it has evaluated the page. */
async function waitForOverlay(overlay: Overlay, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await overlay.mounted()) return;
    await new Promise<void>((done) => setTimeout(done, 100));
  }
  throw new Error(
    'the JobFill overlay never mounted on this fixture — the content script did not run, ' +
      'or the page was not recognised as an application form (SEC 9.2)',
  );
}

/** Every non-empty value in the page, keyed by the most stable identifier each control has. */
async function readValues(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    const controls = document.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >('input, textarea, select');
    for (const el of controls) {
      const key =
        el.id.length > 0
          ? el.id
          : el.getAttribute('name') ?? el.getAttribute('data-automation-id') ?? '';
      if (key.length === 0) continue;
      if (el instanceof HTMLInputElement && el.type === 'file') {
        out[key] = `files:${el.files?.length ?? 0}`;
        continue;
      }
      if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) {
        if (el.checked) out[key] = `checked:${el.value}`;
        continue;
      }
      if (el.value.length > 0) out[key] = el.value;
    }
    return out;
  });
}

/* ------------------------------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------------------------- */

/** Gemini stubs, keyed by the context they were installed on. */
const STUBS = new WeakMap<BrowserContext, GeminiStub>();

interface WorkerFixtures {
  server: FixtureServer;
}

interface TestFixtures {
  context: BrowserContext;
  extensionId: string;
  gemini: GeminiStub;
  jobfill: JobFill;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // One static file server per worker. `workers: 1` keeps the fixed port honest.
  // Playwright reads a fixture's destructuring pattern to discover its dependencies; an empty
  // pattern is the documented way to declare "this fixture depends on nothing".
  server: [
    // eslint-disable-next-line no-empty-pattern -- see above
    async ({}, use) => {
      const server = await startFixtureServer();
      await use(server);
      await server.close();
    },
    { scope: 'worker' },
  ],

  // The stub is installed inside this fixture, not a later one, so there is no window in which
  // the freshly-started service worker could reach the real network.
  // eslint-disable-next-line no-empty-pattern -- see the note on `server` above.
  context: async ({}, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'jobfill-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      executablePath: chromiumExecutable(),
      args: [
        // Chrome refuses `--load-extension` unless the extension is also allow-listed.
        `--disable-extensions-except=${EXTENSION_BUILD_DIR}`,
        `--load-extension=${EXTENSION_BUILD_DIR}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
      ],
      viewport: { width: 1280, height: 900 },
    });

    STUBS.set(context, await installGeminiStub(context));

    await use(context);

    STUBS.delete(context);
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  },

  gemini: async ({ context }, use) => {
    const stub = STUBS.get(context);
    if (stub === undefined) throw new Error('the Gemini stub was not installed on this context');
    await use(stub);
  },

  extensionId: async ({ context }, use) => {
    const worker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 30_000 }));
    await use(new URL(worker.url()).host);
  },

  jobfill: async ({ context, extensionId, gemini, server }, use) => {
    void gemini; // ordering dependency: the stub must exist before any extension traffic
    const harness = new JobFill(context, extensionId, server);
    await use(harness);
    await harness.dispose();
  },
});

export const expect = test.expect;
