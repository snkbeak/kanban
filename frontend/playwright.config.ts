import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:4321', headless: true, trace: 'retain-on-failure' },
  reporter: 'list',
});
