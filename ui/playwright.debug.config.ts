import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /strudel-debug\.spec\.mjs$/,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: 'chromium', use: { viewport: { width: 1280, height: 800 } } }],
  fullyParallel: false,
  workers: 1,
});
