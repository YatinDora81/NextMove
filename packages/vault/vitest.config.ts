import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // WebCrypto, btoa/atob and TextEncoder all exist in Node 20+ globals, so the default
    // environment is enough — no jsdom, no polyfills.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
