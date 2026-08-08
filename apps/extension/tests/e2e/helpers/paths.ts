/**
 * tests/e2e/helpers/paths.ts — where the built extension and a usable Chromium live.
 *
 * JF-001 Rev 3.0 SEC 11: the e2e row runs against the **unpacked build**, not against source, so
 * everything here points at `build/chrome-mv3` — the exact directory `wxt zip` ships.
 *
 * Chromium resolution deserves a word. An MV3 extension cannot be loaded by Playwright's
 * `chrome-headless-shell` (it has no extensions subsystem at all), so the suite always needs the
 * FULL Chromium build. `chromium.executablePath()` names the revision this Playwright release was
 * pinned to, which is not necessarily the revision present in the local browser cache — a machine
 * that installed browsers for an earlier Playwright still has a perfectly good Chromium sitting
 * one directory over. Rather than fail with "Executable doesn't exist", we fall back to the newest
 * cached `chromium-<rev>` build and say which one we picked.
 */

/* eslint-disable turbo/no-undeclared-env-vars --
 * The e2e suite is deliberately outside the turbo task graph (`e2e` is not a turbo pipeline task,
 * so turbo can neither cache it nor need its inputs declared). These variables are local escape
 * hatches for a developer running Playwright by hand; nothing turbo builds reads them.
 */

import { existsSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

/** `apps/extension` — this file is at `apps/extension/tests/e2e/helpers/paths.ts`. */
export const EXTENSION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The unpacked MV3 build Chrome is pointed at (`--load-extension`). */
export const EXTENSION_BUILD_DIR = join(EXTENSION_ROOT, 'build', 'chrome-mv3');

/** The SEC 11 ATS fixture corpus, served over HTTP (content scripts do not run on `file://`). */
export const CORPUS_DIR = join(EXTENSION_ROOT, 'fixtures');

/** E2E-only pages: the corpus is static HTML, and some behaviours need a page that reacts. */
export const LIVE_FIXTURE_DIR = join(EXTENSION_ROOT, 'tests', 'e2e', 'fixtures');

/** Fixed port, per SEC 11's "fixtures served locally". Overridable for a busy machine. */
export const FIXTURE_PORT = Number(process.env['JF_E2E_PORT'] ?? 4599);

export const FIXTURE_ORIGIN = `http://localhost:${FIXTURE_PORT}`;

/** The browser-cache root Playwright downloads into. */
function browsersRoot(): string {
  const override = process.env['PLAYWRIGHT_BROWSERS_PATH'];
  if (override !== undefined && override.length > 0 && override !== '0') return override;
  switch (platform()) {
    case 'darwin':
      return join(homedir(), 'Library', 'Caches', 'ms-playwright');
    case 'win32':
      return join(homedir(), 'AppData', 'Local', 'ms-playwright');
    default:
      return join(homedir(), '.cache', 'ms-playwright');
  }
}

/** The platform-specific binary inside one `chromium-<rev>` directory. */
function binaryIn(buildDir: string): string | null {
  const candidates =
    platform() === 'darwin'
      ? [
          join(
            buildDir,
            'chrome-mac-arm64',
            'Google Chrome for Testing.app',
            'Contents',
            'MacOS',
            'Google Chrome for Testing',
          ),
          join(
            buildDir,
            'chrome-mac',
            'Google Chrome for Testing.app',
            'Contents',
            'MacOS',
            'Google Chrome for Testing',
          ),
        ]
      : platform() === 'win32'
        ? [join(buildDir, 'chrome-win', 'chrome.exe')]
        : [join(buildDir, 'chrome-linux', 'chrome')];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Newest cached full-Chromium build (`chromium-1234` beats `chromium-1228`). */
function newestCachedChromium(): string | null {
  const root = browsersRoot();
  if (!existsSync(root)) return null;

  const builds: Array<{ revision: number; dir: string }> = [];
  for (const entry of readdirSync(root)) {
    // `chromium_headless_shell-*` is deliberately excluded: it cannot load extensions.
    const match = /^chromium-(\d+)$/.exec(entry);
    if (match === null) continue;
    const revision = Number(match[1]);
    if (!Number.isFinite(revision)) continue;
    builds.push({ revision, dir: join(root, entry) });
  }

  builds.sort((a, b) => b.revision - a.revision);
  for (const build of builds) {
    const binary = binaryIn(build.dir);
    if (binary !== null) return binary;
  }
  return null;
}

let resolvedExecutable: string | null = null;

/**
 * A Chromium that can load an unpacked MV3 extension.
 *
 * Order: `JF_E2E_CHROME` → the revision this Playwright is pinned to → the newest cached build.
 * Throws with an actionable message rather than letting Playwright fail deep inside launch.
 */
export function chromiumExecutable(): string {
  if (resolvedExecutable !== null) return resolvedExecutable;

  const override = process.env['JF_E2E_CHROME'];
  if (override !== undefined && override.length > 0) {
    if (!existsSync(override)) {
      throw new Error(`JF_E2E_CHROME points at a file that does not exist: ${override}`);
    }
    resolvedExecutable = override;
    return resolvedExecutable;
  }

  const pinned = chromium.executablePath();
  if (pinned.length > 0 && !pinned.includes('headless_shell') && existsSync(pinned)) {
    resolvedExecutable = pinned;
    return resolvedExecutable;
  }

  const cached = newestCachedChromium();
  if (cached !== null) {
    resolvedExecutable = cached;
    return resolvedExecutable;
  }

  throw new Error(
    'No full Chromium build was found for the JobFill e2e suite.\n' +
      `Playwright expects one at: ${pinned}\n` +
      `Nothing usable was found under: ${browsersRoot()}\n` +
      'Install one with `pnpm --filter extension exec playwright install chromium`, ' +
      'or point JF_E2E_CHROME at an existing Chrome/Chromium binary.\n' +
      'Note: chrome-headless-shell cannot be used — it has no extensions subsystem.',
  );
}
