import { defineConfig } from 'vitest/config';

/**
 * Migration-chain test runner — JF-001 SEC 7.4 / 7.5.
 *
 * `tests/migrations.test.ts` executes every `prisma/migrations/*\/migration.sql` against
 * @electric-sql/pglite (real PostgreSQL compiled to WASM, in-process), so no Postgres server,
 * container or `DATABASE_URL` is required. Node environment only — nothing here touches a DOM.
 *
 * Each test that needs isolation boots its own PGlite instance; a boot costs ~0.5s, so the
 * timeouts below are generous relative to the real cost purely to survive a cold/slow CI box.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', 'dist/**', 'src/generated/**'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
