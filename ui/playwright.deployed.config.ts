import { defineConfig, devices } from '@playwright/test';
import { appStorageState } from './tests/e2e/support/storageState';

/**
 * Playwright config for tests targeting the deployed production bundle
 * at https://wavecode.sibres.tech/. No local dev server is started.
 * Uses the system chromium at /run/current-system/sw/bin/chromium
 * (per AGENTS.md: shared browser, no local install).
 *
 * 2026-11-16: canonical origin moved from wavecode.kosov.online to
 * wavecode.sibres.tech (own domain + wildcard LE cert). The old host
 * answers 301 to the new one — but the storage state is bound to an
 * origin, so the suite must target the canonical one directly.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /mic-phase3\.spec\.mjs$/,
  reporter: 'list',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'https://wavecode.sibres.tech',
    storageState: appStorageState('https://wavecode.sibres.tech'),
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