import { test, expect } from '@playwright/test';

/**
 * Mic feature Phase 3 — mode-row (sustain / transient / auto).
 *
 * Smoke test against the deployed production bundle
 * (https://wavecode.kosov.online/#/app). Verifies that the MicPanel
 * renders the Phase 3 mode selector with 3 buttons, that '♪ sustain'
 * is the default-active mode, and that clicking '✦ transient' and
 * '◆ auto' updates data-active correctly.
 *
 * Does NOT exercise the mic pipeline itself — chromium without a
 * real audio device cannot produce a usable micCapture feed, and the
 * unit tests already cover the detector / pipeline behaviour. This
 * test is a structural sanity check on the production bundle.
 */

const DEPLOYED_URL = 'https://wavecode.kosov.online/#/app';

async function bootApp(page) {
  await page.goto(DEPLOYED_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15_000 });
  await page.waitForTimeout(1500);
}

test.describe('Mic panel — Phase 3 mode selector', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Mode row: 3 buttons, sustain default, transient/auto toggling', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

    await bootApp(page);

    const micTab = page.locator('.wc-tab[aria-label="Mic"]');
    await expect(micTab).toBeVisible();
    await micTab.click();
    await page.waitForTimeout(400);

    const modeRow = page.locator('.mic-mode-row[aria-label="Режим приёма"]');
    await expect(modeRow).toBeVisible();

    const buttons = modeRow.locator('button.mic-mode-btn');
    await expect(buttons).toHaveCount(3);

    await expect(buttons.nth(0)).toHaveText('♪ sustain');
    await expect(buttons.nth(1)).toHaveText('✦ transient');
    await expect(buttons.nth(2)).toHaveText('◆ auto');

    await expect(buttons.nth(0)).toHaveAttribute('data-mode', 'sustain');
    await expect(buttons.nth(1)).toHaveAttribute('data-mode', 'transient');
    await expect(buttons.nth(2)).toHaveAttribute('data-mode', 'auto');

    await expect(buttons.nth(0)).toHaveAttribute('data-active', 'true');
    await expect(buttons.nth(1)).toHaveAttribute('data-active', 'false');
    await expect(buttons.nth(2)).toHaveAttribute('data-active', 'false');

    await buttons.nth(1).click();
    await page.waitForTimeout(150);
    await expect(buttons.nth(1)).toHaveAttribute('data-active', 'true');
    await expect(buttons.nth(0)).toHaveAttribute('data-active', 'false');
    await expect(buttons.nth(2)).toHaveAttribute('data-active', 'false');

    await buttons.nth(2).click();
    await page.waitForTimeout(150);
    await expect(buttons.nth(2)).toHaveAttribute('data-active', 'true');
    await expect(buttons.nth(1)).toHaveAttribute('data-active', 'false');
    await expect(buttons.nth(0)).toHaveAttribute('data-active', 'false');

    await buttons.nth(0).click();
    await page.waitForTimeout(150);
    await expect(buttons.nth(0)).toHaveAttribute('data-active', 'true');
    await expect(buttons.nth(1)).toHaveAttribute('data-active', 'false');
    await expect(buttons.nth(2)).toHaveAttribute('data-active', 'false');

    expect(errors).toEqual([]);

    await page.screenshot({
      path: 'tests/e2e/__screenshots__/mic-phase3.png',
      fullPage: true,
    });
  });
});