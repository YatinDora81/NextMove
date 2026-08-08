/**
 * apps/extension/eslint.config.js — JF-001 Rev 3.0 SEC 14.1.
 *
 * Boundary rule R-3 (import direction) is an INVARIANT, not a preference: the extension may
 * import `@repo/types`, `@repo/rotation`, `@repo/typescript-config` and `@repo/eslint-config` —
 * nothing else. `@repo/ui` would blow the bundle budget and drag React-web components through
 * Chrome Web Store review; `@repo/db` is Prisma and is server-only; app-to-app source imports
 * would couple two runtimes that ship on independent cadences (R-4).
 *
 * The second block enforces INV-6 / R-1: no file under `src/ai/**` may reach the NextMove API.
 * The extension's AI path is lane 1 only — user key, service worker, Google direct. If a future
 * refactor tries to route generation through our server, this rule breaks the build.
 *
 * It extends `@repo/eslint-config/base`, which is what supplies the TypeScript PARSER. That is not
 * a stylistic choice: without it ESLint falls back to espree, every `.ts` file dies with
 * "Parsing error: Unexpected token :", and — because a file that fails to parse is never linted —
 * `no-restricted-imports` never runs on a single line of the extension. The boundary rules would
 * have been promised in a config file and enforced nowhere, which is the exact failure mode SEC
 * 14.1 exists to prevent.
 *
 * The third block is the bundle guard (SEC 11 "bundle-size budget", finding D6): nothing reachable
 * from the MV3 service worker may import a PDF/DOCX parser. See the block itself for why that is a
 * hard rule rather than a performance preference.
 *
 * The shared base pulls in `eslint-plugin-only-warn`, which downgrades every rule to a warning.
 * The `lint` script therefore runs with `--max-warnings 0` (same as apps/web), so an R-3, INV-6 or
 * SEC 11 violation still fails the build.
 */

import { config as base } from '@repo/eslint-config/base';

/** SEC 14.1 R-3 — copied verbatim from the design document. */
const R3_PATTERNS = [
  {
    group: ['@repo/ui', '@repo/ui/*'],
    message: 'Extension UI is standalone — do not import web components (SEC 14.1 R-3).',
  },
  {
    group: ['@repo/db', '@repo/db/*'],
    message: 'Prisma client is server-only. The extension talks to the API, never the DB.',
  },
  {
    group: ['**/apps/web/**', '**/apps/http-server/**'],
    message: 'No app-to-app source imports. Share code via packages/ only.',
  },
];

const INV6_MESSAGE =
  'INV-6: the extension AI path never crosses the NextMove API. src/ai/** may not import ' +
  'API_BASE_URL — lease a user key and call generativelanguage.googleapis.com directly.';

/**
 * SEC 11 bundle-size budget · finding D6 — the service worker's forbidden imports.
 *
 * WXT/rolldown emits the background entry as a SINGLE file, because a classic-script MV3 service
 * worker cannot load sibling chunks at runtime. That makes `await import('pdfjs-dist')` NOT a split
 * point here: it is a ~1.6 MB static inclusion that Chrome re-parses on every worker wake-up, and
 * an MV3 worker wakes constantly. background.js was 2,463,415 B for exactly this reason before
 * SEC 4.3 Flow C moved extraction to the Options page; it is 342,967 B now.
 *
 * So this is not "keep the worker tidy" — it is the difference between a fill that starts in
 * milliseconds and one that stalls behind a 2 MB parse. Flow C is the design's own answer: the
 * Options page opens the PDF/DOCX locally, shows the user the text, and `RESUME_PARSE` carries
 * already-extracted TEXT across the bus. The worker only ever contributes the Gemini call.
 *
 * Two limits worth knowing, both covered by tests/unit/bundle.test.ts:
 *   · `no-restricted-imports` sees only the direct edge, never the transitive reach — a re-export
 *     added to `@/ai/index.ts` would slip past this rule. The module-graph test walks the whole
 *     graph from `src/entrypoints/background.ts`.
 *   · it also only inspects static import/export declarations, so a dynamic `import('pdfjs-dist')`
 *     is invisible to it. The module-graph test follows those too, and the byte budget on
 *     `build/chrome-mv3/background.js` catches whatever both miss.
 */
const WORKER_BUNDLE_MESSAGE =
  'SEC 11 / D6: the MV3 service worker is bundled as ONE file, so this import is INLINED into ' +
  'background.js (~1.6 MB) rather than split — it was how the worker reached 2.4 MB. PDF/DOCX ' +
  'extraction runs in the Options page (SEC 4.3 Flow C); RESUME_PARSE carries the extracted TEXT. ' +
  'Import @/ai/resume-extract from src/ui/** only. See tests/unit/bundle.test.ts.';

const WORKER_BUNDLE_PATTERNS = [
  {
    group: ['pdfjs-dist', 'pdfjs-dist/**'],
    message: WORKER_BUNDLE_MESSAGE,
  },
  {
    group: ['mammoth', 'mammoth/**'],
    message: WORKER_BUNDLE_MESSAGE,
  },
  {
    group: ['@/ai/resume-extract', '~/ai/resume-extract', '**/ai/resume-extract'],
    message: WORKER_BUNDLE_MESSAGE,
  },
];

/** @type {Array<import("eslint").Linter.Config>} */
export default [
  {
    ignores: [
      'build/**',
      '.wxt/**',
      'node_modules/**',
      'stats.html',
      'fixtures/**',
      'public/**',
    ],
  },
  ...base,
  {
    // Build scripts run in Node, not in the browser/extension sandbox.
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { Buffer: 'readonly', process: 'readonly', console: 'readonly', __dirname: 'readonly' },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'no-restricted-imports': ['error', { patterns: R3_PATTERNS }],
    },
  },
  {
    // INV-6 — enforced, not promised. Repeats R3_PATTERNS because a later `rules` entry for the
    // same rule id replaces the earlier one wholesale rather than merging with it.
    files: ['src/ai/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: R3_PATTERNS,
          paths: [
            {
              name: '@/shared/constants',
              importNames: ['API_BASE_URL'],
              message: INV6_MESSAGE,
            },
            {
              name: '../shared/constants',
              importNames: ['API_BASE_URL'],
              message: INV6_MESSAGE,
            },
            {
              name: '../../shared/constants',
              importNames: ['API_BASE_URL'],
              message: INV6_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    // SEC 11 / D6 — the service-worker bundle guard. Scoped to exactly the module graph that ends
    // up inside background.js. Repeats R3_PATTERNS for the same reason the INV-6 block does: a
    // later `rules` entry for the same rule id replaces the earlier one wholesale.
    // `src/ai/index.ts` is included deliberately: it IS in the worker's module graph, and
    // re-exporting the heavy extractor from the barrel is the exact shape of the original 2.4 MB
    // regression. `src/ai/resume-extract.ts` itself is of course exempt — it is the extractor.
    files: ['src/background/**/*.{ts,tsx}', 'src/entrypoints/background.ts', 'src/ai/index.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...R3_PATTERNS, ...WORKER_BUNDLE_PATTERNS] },
      ],
    },
  },
];
