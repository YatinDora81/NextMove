/**
 * packages/db/eslint.config.js
 *
 * `@repo/db` had neither `lint` nor `check-types`, so its 1k-line PGlite migration suite was
 * checked by nothing but its own runtime assertions. Both gates now exist; this is the lint half.
 *
 * Extends `@repo/eslint-config/base` for the typescript-eslint parser (see the note in
 * apps/http-server/eslint.config.js — an unparsed file is an unlinted file). Only `src/generated`
 * is ignored, because that is Prisma's own output; `prisma/` needs no entry, since `.prisma` and
 * `.sql` are not files ESLint would pick up in the first place.
 */

import { config as base } from '@repo/eslint-config/base';

/** @type {Array<import("eslint").Linter.Config>} */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'src/generated/**'],
  },
  ...base,
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
      },
    },
  },
];
