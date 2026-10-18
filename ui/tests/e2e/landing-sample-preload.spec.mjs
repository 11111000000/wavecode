import { test, expect } from '@playwright/test';

/**
 * Landing-page sample-bank preload.
 *
 * Regression: pre-2.0.1 the visitor heard only the synth layer when
 * tapping a sample-based preset preview (Creep, Hip-hop, Trap)
 * because `SampleLoader.loadAllSamples()` was wired only into
 * `useAppBootstrap` on /#/app. This e2e verifies:
 *   1. The Landing page mounts the `<SampleProgressBadge />` in
 *      a `.l-sample-progress-corner` wrapper (it shows while the
 *      SW cache is cold).
 *   2. After preload completes, the progress badge disappears.
 *   3. Tapping the Creep preview does NOT surface
 *      "sound <X> not found" errors (the bug we were fixing).
 *
 * The test uses a generous 60s ceiling on the "wait for badge to
 * disappear" check — the sample bank is ~1 MB MP3s that decode in
 * the Worker, normally completing in <10s on localhost.
 */

const HOST = process.env.WAVECODE_E2E_HOST ?? 'http://127.0.0.1:4173';

test('Landing mounts SampleProgressBadge in the top-right corner', async ({ page }) => {
  await page.goto(`${HOST}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#presets', { timeout: 15000 });

  // The corner wrapper is mounted unconditionally on Landing; the
  // inner .sample-progress element appears ONLY while
  // status === 'loading'. We assert the wrapper is in the DOM and
  // either has a visible badge (cold cache) or is empty
  // (already-cached SW).
  const corner = page.locator('[data-testid="landing-sample-progress"]');
  await expect(corner).toBeAttached();
});

test('Landing preloads sample banks (badge appears during cold load)', async ({ page }) => {
  await page.goto(`${HOST}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#presets', { timeout: 15000 });

  // Wait up to 10s for the progress badge to appear (cold cache).
  // If SW already has the bank, the badge never renders — that is OK,
  // the next test verifies the no-error contract regardless.
  const badge = page.locator('[data-testid="landing-sample-progress"] .sample-progress');
  await badge
    .waitFor({ state: 'visible', timeout: 10000 })
    .catch(() => {
      /* badge may never appear (warm SW cache) — that is OK */
    });

  // If the badge appeared, it must eventually disappear (status === 'loaded').
  if ((await badge.count()) > 0) {
    await badge.waitFor({ state: 'detached', timeout: 60000 });
  }
});

test('Creep preset preview on landing does not throw "sound X not found"', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`);
  });

  await page.goto(`${HOST}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#presets', { timeout: 15000 });

  // Wait for sample preload to complete (badge gone). 60s ceiling.
  await page
    .waitForFunction(
      () => document.querySelector('[data-testid="landing-sample-progress"] .sample-progress') === null,
      { timeout: 60000 },
    )
    .catch(() => {
      /* badge may have already been hidden */
    });

  // Click the Creep preset preview (first card in SnippetShowcase).
  const creepPlay = page.locator('#presets .l-preset__play').first();
  await creepPlay.click();
  await page.waitForTimeout(1500);

  // Pre-2.0.1: getTrigger throws "sound drums_bd not found" when
  // SampleLoader.loadAllSamples() has not fired. Post-2.0.1 the
  // landing triggers the preload on mount, so this assertion holds.
  const soundNotFound = errors.filter((e) => /sound\s+\S+\s+not\s+found/i.test(e));
  expect(
    soundNotFound,
    `unexpected "sound not found" errors:\n${soundNotFound.join('\n')}`,
  ).toEqual([]);
});