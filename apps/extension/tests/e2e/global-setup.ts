/**
 * tests/e2e/global-setup.ts — build the unpacked extension before anything is launched.
 *
 * SEC 11's e2e row is explicit that the suite runs against the **unpacked build**, so the build is
 * part of the test run rather than a thing you have to remember. `pnpm --filter extension e2e`
 * works from a clean checkout: this hook runs `wxt build`, which writes `build/chrome-mv3`,
 * which is what Chrome is pointed at.
 *
 * `wxt` is invoked directly from the workspace's own `node_modules/.bin` rather than through
 * pnpm/turbo — the e2e suite is not part of the turbo graph and should not re-enter it.
 *
 * Set `JF_E2E_SKIP_BUILD=1` while iterating on specs against a build you already have.
 */

/* eslint-disable turbo/no-undeclared-env-vars --
 * The e2e suite is deliberately outside the turbo task graph (`e2e` is not a turbo pipeline task,
 * so turbo can neither cache it nor need its inputs declared). These variables are local escape
 * hatches for a developer running Playwright by hand; nothing turbo builds reads them.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { EXTENSION_BUILD_DIR, EXTENSION_ROOT, chromiumExecutable } from './helpers/paths';

export default function globalSetup(): void {
  // Fail here, with an actionable message, rather than inside the first test's launch.
  const executable = chromiumExecutable();
  process.stdout.write(`[jobfill-e2e] chromium: ${executable}\n`);

  if (process.env['JF_E2E_SKIP_BUILD'] === '1') {
    if (!existsSync(join(EXTENSION_BUILD_DIR, 'manifest.json'))) {
      throw new Error(
        `JF_E2E_SKIP_BUILD=1 but there is no build at ${EXTENSION_BUILD_DIR}. ` +
          'Run `pnpm --filter extension build` first, or unset the variable.',
      );
    }
    process.stdout.write('[jobfill-e2e] reusing the existing build/chrome-mv3 output\n');
    return;
  }

  const wxt = join(EXTENSION_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'wxt.cmd' : 'wxt');
  if (!existsSync(wxt)) {
    throw new Error(`wxt is not installed at ${wxt} — run pnpm install in the workspace root.`);
  }

  process.stdout.write('[jobfill-e2e] building the MV3 extension (wxt build)…\n');
  execFileSync(wxt, ['build'], { cwd: EXTENSION_ROOT, stdio: 'inherit' });

  if (!existsSync(join(EXTENSION_BUILD_DIR, 'manifest.json'))) {
    throw new Error(`wxt build finished but produced no manifest at ${EXTENSION_BUILD_DIR}`);
  }
}
