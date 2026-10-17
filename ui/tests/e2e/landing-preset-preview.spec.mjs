import { test, expect } from '@playwright/test';

/**
 * Landing-page preset preview.
 *
 * Verifies that tapping a per-card play button in SnippetShowcase
 * does NOT navigate to /#/app and DOES set data-playing="true" on
 * the play button. The actual audio playback is exercised by the
 * existing audio-eval.spec.mjs + LiveAudioEngine unit tests; this
 * e2e is the visual / interaction contract for the landing surface.
 */

test('Tapping the play button does not navigate away from the landing page', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for the preset grid to render.
  await page.waitForSelector('#presets', { timeout: 15000 });
  const firstPlay = page.locator('#presets .l-preset__play').first();
  await expect(firstPlay).toBeVisible();

  const beforeUrl = page.url();

  await firstPlay.click();

  // Tiny pause to let the click handler settle.
  await page.waitForTimeout(250);

  // URL must NOT have changed — event.stopPropagation() is the contract.
  expect(page.url()).toBe(beforeUrl);
  expect(page.url()).not.toContain('#/app');

  // No JS errors.
  expect(errors).toHaveLength(0);
});

test('Tapping the play button flips data-playing to true', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#presets', { timeout: 15000 });

  const firstPlay = page.locator('#presets .l-preset__play').first();
  await expect(firstPlay).toHaveAttribute('data-playing', 'false');
  await firstPlay.click();
  await page.waitForTimeout(150);
  // After click, the same play button should report data-playing="true".
  // (The contract is at-most-one preview; a single card is fine here.)
  await expect(firstPlay).toHaveAttribute('data-playing', 'true');
});

test('Tapping a second card stops the first and starts the second', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#presets', { timeout: 15000 });

  const plays = page.locator('#presets .l-preset__play');
  const count = await plays.count();
  test.skip(count < 2, 'need ≥2 preset cards');

  await plays.nth(0).click();
  await page.waitForTimeout(150);
  await expect(plays.nth(0)).toHaveAttribute('data-playing', 'true');

  await plays.nth(1).click();
  await page.waitForTimeout(150);
  // First card flipped back to false, second card is now playing.
  await expect(plays.nth(0)).toHaveAttribute('data-playing', 'false');
  await expect(plays.nth(1)).toHaveAttribute('data-playing', 'true');
});