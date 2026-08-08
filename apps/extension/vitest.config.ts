import { defineConfig } from 'vitest/config';

/**
 * Unit/component test runner — JF-001 SEC 11.
 *
 * happy-dom gives the scanner, signature builder and fill strategies a real-enough DOM to run
 * against the saved ATS fixtures in `fixtures/`. Playwright owns the e2e layer and lives outside
 * this config (`tests/e2e/**` is excluded here so `vitest run` never tries to drive a browser).
 */
const srcDir = decodeURIComponent(new URL('./src', import.meta.url).pathname);

export default defineConfig({
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/e2e/**', '**/node_modules/**', '.wxt/**', '.output/**'],
    // A fixture fill run walks real strategies: each unresolved typeahead honours the SEC 6.4
    // 3s listbox cap, and Workday step 1 has four of them. happy-dom never renders a listbox, so
    // those waits always run to the cap — 5s (vitest default) is not enough for a full-form run.
    testTimeout: 40_000,
    hookTimeout: 20_000,
    restoreMocks: true,
    clearMocks: true,
  },
});
