import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for tests targeting the deployed production bundle
 * at https://wavecode.kosov.online/. No local dev server is started.
 * Uses the system chromium at /run/current-system/sw/bin/chromium
 * (per AGENTS.md: shared browser, no local install).
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /mic-phase3\.spec\.mjs$/,
  reporter: 'list',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'https://wavecode.kosov.online',
    trace: 'on-first-retry' as const,
    screenshot: 'only-on-failure' as const,
    launchOptions: {
      executablePath: '/run/current-system/sw/bin/chromium',
      args: ['--no-sandbox'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});