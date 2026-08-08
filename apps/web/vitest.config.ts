import { defineConfig } from 'vitest/config';

/**
 * apps/web unit tests.
 *
 * Small on purpose. `apps/web` is overwhelmingly server-rendered marketing/dashboard shell that
 * the Next build already typechecks and lints; what it lacked was any way to pin an *interactive*
 * behaviour so a later "lint cleanup" cannot quietly change it. `tests/` is that lane.
 *
 * - `happy-dom` rather than jsdom: it is already in this repo's lockfile (apps/extension uses it)
 *   and boots in a few milliseconds.
 * - The explicit `oxc.jsx` runtime is required. The app's tsconfig sets `jsx: "preserve"` because
 *   Next owns the JSX transform in the real build; without this override Vite's transform hands
 *   raw JSX to the runtime and the file fails to parse.
 * - `@/` mirrors the tsconfig `paths` entry (`@/* -> ./*`).
 */
const rootDir = decodeURIComponent(new URL('.', import.meta.url).pathname);

export default defineConfig({
  resolve: {
    alias: {
      '@': rootDir.replace(/\/$/, ''),
    },
  },
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'react' },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '.next/**'],
    restoreMocks: true,
    clearMocks: true,
  },
});
