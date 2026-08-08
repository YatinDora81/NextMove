import { defineConfig } from '@playwright/test';

const isCI = process.env['CI'] !== undefined && process.env['CI'] !== '';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/global-setup.ts',

  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,

  timeout: 120_000,
  expect: { timeout: 15_000 },

  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
});
