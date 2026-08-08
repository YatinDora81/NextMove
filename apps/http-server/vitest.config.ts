import { defineConfig } from 'vitest/config';

/**
 * JF-001 SEC 15.8 — "Redaction is tested, not promised."
 *
 * The server is ESM + NodeNext, so its own source imports carry a `.js` suffix on `.ts` files
 * (`@/utils/keyVault.js`). Vite has to be told to map those back to the TypeScript sources, which
 * is what the regex aliases below do — `@/x.js` → `src/x.ts`, and the same for `@repo/*` deep
 * imports that resolve to raw `.ts` exports.
 */
const srcDir = decodeURIComponent(new URL('./src', import.meta.url).pathname);

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)\.js$/, replacement: `${srcDir}/$1.ts` },
      { find: /^@\/(.*)$/, replacement: `${srcDir}/$1` },
    ],
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.{test,spec}.ts'],
    // keyVault.ts asserts its master key at import time (SEC 15.4 fail-fast), so the suite must
    // provide one before any module under test is loaded.
    setupFiles: ['tests/setup.ts'],
  },
});
