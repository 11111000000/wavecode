import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { appStorageState } from './tests/e2e/support/storageState';

const isCI = !!process.env.CI;

/**
 * The specs run against the PRODUCTION bundle, served by `vite preview`
 * — not against the dev server. The suite asserts on built artefacts
 * (chunk split, PWA manifest, precache list), and a dev server does not
 * produce those.
 *
 * The host/port live here and nowhere else. Specs navigate with the
 * relative routes from `tests/e2e/support/appUrl.ts`, which Playwright
 * resolves against this `baseURL`.
 */
const BASE_URL = process.env.WAVECODE_E2E_BASE_URL ?? 'http://127.0.0.1:4173';

/**
 * Reuse the browser that NixOS already ships instead of downloading a
 * second copy via `npx playwright install`.
 *
 * The system Chromium lives in the Nix store and is reachable through
 * the stable `/run/current-system` symlink, which retargets on every
 * system update. Playwright drives it over CDP, so it works even though
 * its version trails the one Playwright pins.
 *
 * Fallback: when the system binary is absent (CI on ubuntu-latest),
 * `executablePath` stays undefined and Playwright uses its own build.
 */
const SYSTEM_CHROMIUM = '/run/current-system/sw/bin/chromium';
const systemChromium = existsSync(SYSTEM_CHROMIUM) ? SYSTEM_CHROMIUM : undefined;

/**
 * Firefox has no system build to reuse — it needs Playwright's own
 * download. Opt in explicitly so the default run needs no install.
 */
const withFirefox = process.env.WAVECODE_E2E_FIREFOX === '1';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // One Chromium instance per worker, and each instance forks a handful
  // of renderer/GPU helpers. On a 4-core host with ~8 GB shared with
  // other services, four workers starve the launcher (`browserType.
  // launch` timing out at 180 s). Two is the safe ceiling here; CI
  // runs single-worker for determinism.
  workers: isCI ? 1 : 2,
  reporter: isCI ? 'github' as const : 'list' as const,
  // `mic-phase3` targets the live deployment on purpose and runs only
  // under `playwright.deployed.config.ts`.
  testIgnore: /mic-phase3\.spec\.mjs$/,
  use: {
    baseURL: BASE_URL,
    // The consent gate blocks the app until the terms are accepted. The
    // storage state is seeded for the SAME origin as `baseURL` — seeding
    // it for a different origin silently does nothing.
    storageState: appStorageState(BASE_URL),
    trace: 'on-first-retry' as const,
    screenshot: 'only-on-failure' as const,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // `executablePath` belongs to this project only — pointing the
        // Firefox project at a Chromium binary would fail to launch.
        ...(systemChromium
          ? { launchOptions: { executablePath: systemChromium, args: ['--no-sandbox'] } }
          : {}),
      },
    },
    ...(withFirefox
      ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }]
      : []),
  ],
  webServer: {
    // `vite preview` serves `dist/` from disk, so an already-running
    // preview picks up a fresh bundle without a restart. `--strictPort`
    // turns a port clash into a clear error instead of a silent
    // auto-increment (which would leave Playwright polling a dead URL).
    command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
});
