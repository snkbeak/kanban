import { defineConfig } from '@playwright/test';

// Separate from the fixture suite: no automatic server startup or account seed.
export default defineConfig({
  testDir: './tests/live',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  globalSetup: './tests/live/setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:4321',
    headless: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  // Avoid persisting credential-bearing request/DOM diagnostics.
  reporter: 'list',
  preserveOutput: 'never',
});
