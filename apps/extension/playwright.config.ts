/**
 * playwright.config.ts — JF-001 Rev 3.0 SEC 11, the e2e layer.
 *
 * "Playwright, persistent context, unpacked build, fixtures served locally; Gemini stubbed via
 *  request interception."
 *
 * This is the only layer that can prove the claims the unit layer physically cannot reach:
 * happy-dom never renders a typeahead listbox, never runs a MAIN-world content script, never
 * executes a service worker, and never lays a form out — so "the option was really selected",
 * "the draft really landed in the field" and "the submit button was never pressed" are all
 * assertions that only exist here.
 *
 * Notes on the settings that are not defaults:
 *
 *  - `workers: 1`. Each test launches its own Chrome with its own profile directory, and the
 *    fixture server binds one fixed port. Serialising is both cheaper and more honest than
 *    juggling ports and profile dirs for a suite this size.
 *  - `fullyParallel: false`, for the same reason.
 *  - No `projects`. The suite is Chromium-only by construction: MV3 is a Chromium extension
 *    format, and the browser is resolved in `helpers/paths.ts` (the headless *shell* cannot load
 *    extensions, so a full Chromium build is required).
 *  - `globalSetup` builds `build/chrome-mv3` first, so `pnpm --filter extension e2e` works from
 *    a clean checkout.
 *
 * `CI` is declared in the root `turbo.json` `globalEnv`, so reading it here needs no lint escape
 * hatch. It is a real input to what this file produces — `forbidOnly`, `retries` and the HTML
 * reporter all change with it.
 */

import { defineConfig } from '@playwright/test';

const isCI = process.env['CI'] !== undefined && process.env['CI'] !== '';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/global-setup.ts',

  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,

  // A full fill walks every strategy with SEC 6.4 human pacing and up to a 3s listbox wait per
  // typeahead, on top of a per-test browser launch. 120s is generous on purpose: a flaky timeout
  // would be a worse outcome than a slow suite.
  timeout: 120_000,
  expect: { timeout: 15_000 },

  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
});
