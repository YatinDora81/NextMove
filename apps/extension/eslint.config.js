import { config as base } from '@repo/eslint-config/base';

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
    files: ['src/background/**/*.{ts,tsx}', 'src/entrypoints/background.ts', 'src/ai/index.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...R3_PATTERNS, ...WORKER_BUNDLE_PATTERNS] },
      ],
    },
  },
];
