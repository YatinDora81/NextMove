/**
 * apps/http-server/eslint.config.js
 *
 * The API had ~55 source files and no lint script at all, so `pnpm turbo run lint` silently
 * skipped it — including every file JF-001 added (keyVault, keyLane, the rotation store, the
 * device/sync/job-application lanes). This config puts it under the same gate as apps/extension
 * and apps/web.
 *
 * It extends `@repo/eslint-config/base`, which supplies the typescript-eslint PARSER. Without it
 * ESLint falls back to espree and every `.ts` file dies at the first type annotation — and a file
 * that fails to parse is never linted, so the gate would exist on paper only.
 *
 * The shared base also pulls in `eslint-plugin-only-warn`, which downgrades every rule to a
 * warning; the `lint` script therefore runs `--max-warnings 0` so a violation still fails CI.
 *
 * Server-specific bits:
 *  - Node globals. This is an ESM Node service: `process`, `console`, `Buffer`, `URL`, timers.
 *    The shared base declares no environment, so without this every one of them is `no-undef`.
 *  - `turbo/no-undeclared-env-vars` is a real rule here, not noise: every `process.env` key the
 *    server reads must also be declared in the root `turbo.json` `http-server#build` / `#dev`
 *    env lists, or turbo will hand out a stale cached build when that variable changes.
 */

import { config as base } from '@repo/eslint-config/base';

/** @type {Array<import("eslint").Linter.Config>} */
export default [
  {
    ignores: ['dist/**', 'logs/**', 'node_modules/**'],
  },
  ...base,
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // Node ESM runtime surface used across the service.
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        queueMicrotask: 'readonly',
        structuredClone: 'readonly',
      },
    },
    rules: {
      // `declare global { namespace Express { interface Request { user?: … } } }` is the only
      // way to augment Express's Request — interface merging into a global namespace has no
      // ES-module equivalent, which is why typescript-eslint ships `allowDeclarations` for
      // exactly this case. Ambient declarations stay legal; a real runtime `namespace Foo {}`
      // still warns.
      '@typescript-eslint/no-namespace': ['warn', { allowDeclarations: true }],
    },
  },
];
