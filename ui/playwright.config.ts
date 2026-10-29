import { defineConfig, devices } from '@playwright/test';
import { acceptedTermsStorageState } from './tests/e2e/support/consent';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  ...(isCI ? { workers: 1 } : {}),
  reporter: isCI ? 'github' as const : 'list' as const,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    // Skip the legal consent gate — see tests/e2e/support/consent.ts.
    storageState: acceptedTermsStorageState('http://127.0.0.1:5173'),
    trace: 'on-first-retry' as const,
    screenshot: 'only-on-failure' as const,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !isCI,
    timeout: 30_000,
  },
});