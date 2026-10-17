import { test, expect } from '@playwright/test';

/**
 * Mic feature — UX redesign (commit ee85b0a on master).
 *
 * Smoke test against the deployed production bundle
 * (https://wavecode.kosov.online/#/app). The redesigned MicPanel
 * is intentionally empty-state-first: the 4-row layout
 * (status / cta / roll / meter) renders INSIDE
 * <Show when={!isEmpty()}> — i.e. only after the user records.
 *
 * We therefore assert the empty-state behavior in the live DOM
 * (the headline UX win) and verify the structural presence of the
 * non-empty UI in the production CSS bundle (the controls exist
 * and will render as soon as the user records).
 *
 * This test does NOT exercise the 4-row full layout itself — that
 * requires a working mic device or programmatic preview injection.
 */

const DEPLOYED_URL = 'https://wavecode.kosov.online/#/app';

test.describe('Mic panel — UX redesign (empty state + structural presence)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('empty state by default; no mode-row; shows Demo + Learn more', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

    await page.goto(DEPLOYED_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main.app', { timeout: 15_000 });
    await page.waitForTimeout(1500);

    const micTab = page.locator('.wc-tab[aria-label="Mic"]');
    await expect(micTab).toBeVisible();
    await micTab.click();
    await page.waitForTimeout(400);

    // 1. Old mode-row must NOT exist (the headline UX win).
    await expect(page.locator('.mic-mode-row')).toHaveCount(0);
    await expect(page.locator('button.mic-mode-btn')).toHaveCount(0);

    // 2. Empty state visible.
    await expect(page.locator('.mic-ux-empty')).toBeVisible();

    // 3. Empty-state copy (instructions + Demo + Learn more).
    await expect(page.locator('.mic-ux-empty-title')).toContainText(/START/);
    await expect(page.locator('.mic-ux-empty-demo')).toBeVisible();
    await expect(page.locator('.mic-ux-empty-help')).toBeVisible();

    expect(errors).toEqual([]);

    await page.screenshot({
      path: 'tests/e2e/__screenshots__/mic-ux-2026-10.png',
      fullPage: true,
    });
  });

  test('production bundle declares the redesigned MicPanel shell', async ({ page }) => {
    await page.goto(DEPLOYED_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main.app', { timeout: 15_000 });

    // The CSS bundle carries all the new layout classes. This is a
    // structural check: even when the 4-row layout is hidden behind
    // the empty-state <Show>, the styles must be in the bundle so the
    // layout renders correctly once preview content exists.
    const cssHref = await page.evaluate(() => {
      const link = document.querySelector('link[rel="stylesheet"][href*="index-"]');
      return link ? link.href : null;
    });
    expect(cssHref).not.toBeNull();
    const cssRes = await page.request.get(cssHref);
    expect(cssRes.status()).toBe(200);
    const css = await cssRes.text();
    for (const cls of [
      'mic-ux-panel',
      'mic-ux-row-status',
      'mic-ux-row-cta',
      'mic-ux-row-roll',
      'mic-ux-row-meter',
      'mic-ux-piano-roll',
      'mic-ux-meter',
      'mic-ux-empty',
      'mic-ux-empty-demo',
      'mic-ux-inst-btn',
      'mic-ux-slot-select',
      'mic-ux-cta',
    ]) {
      expect(css).toContain(cls);
    }
  });
});
