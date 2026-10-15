import { test, expect, type Page } from '@playwright/test';

/**
 * Mobile sheet → TabBar overlap regression (2026-10-15 bug).
 *
 * The AI «Применить» (submit) button is the only submit-style
 * action in the messenger. It must remain reachable on every
 * viewport because there's no Cmd/Ctrl+Enter fallback that works
 * on touch keyboards. Before the fix, the BottomSheet on mobile
 * extended down to the viewport bottom while the fixed .wc-tabbar
 * overlaid the same area — the submit button sat at sheet_bottom
 * − 16px and got visually clipped behind the TabBar.
 *
 * Two assertions here:
 *
 *   1. **Bounds check.** Open the AI sheet on a 412×900 mobile
 *      viewport. Read the bounding rects of `.ai-apply-btn` and
 *      `.wc-tabbar`. The button's bottom edge must be ≤ the
 *      TabBar's top edge. If a regression flips the order, the
 *      button is partially behind the TabBar.
 *
 *   2. **Visibility / clickability.** The button is in the
 *      viewport (Playwright's `toBeVisible` considers an element
 *      hidden if it's fully covered by another element with a
 *      higher z-index — which is what was happening here). Plus
 *      a real `.click()` round-trips through the engine; a
 *      half-occluded button would either hit-test the TabBar
 *      (no click registers) or throw "intercepts pointer events".
 */

const BASE_URL = 'http://127.0.0.1:4173';

async function bootApp(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15_000 });
  await page.waitForTimeout(1500);
}

test.describe('AI submit button above TabBar (412×900)', () => {
  test.use({ viewport: { width: 412, height: 900 } });

  test('Apply button bottom edge is above the TabBar top edge', async ({ page }) => {
    await bootApp(page);

    // Open AI sheet (chat tab in BottomNav).
    await page.locator('.wc-tab[aria-label="AI"]').click();
    await page.waitForTimeout(300);

    const applyBtn = page.locator('.ai-apply-btn').first();
    await expect(applyBtn).toBeAttached();

    const tabbar = page.locator('.wc-tabbar').first();
    await expect(tabbar).toBeVisible();

    const btnBox = await applyBtn.boundingBox();
    const tabBox = await tabbar.boundingBox();
    expect(btnBox).not.toBeNull();
    expect(tabBox).not.toBeNull();

    // The button's bottom must be at or above the TabBar's top.
    // wavecode-ai-apply-above-tabbar reserves tabbar-h + safe-bottom
    // of padding under the footer, so this gap is >= tabbar-h
    // (~60px on a non-notch device).
    const gap = tabBox!.y - (btnBox!.y + btnBox!.height);
    expect(gap).toBeGreaterThanOrEqual(0);

    // And the button must be fully inside the viewport.
    expect(btnBox!.y + btnBox!.height).toBeLessThanOrEqual(900);

    // Sanity: the button is the last interactive element of the
    // messenger — there should be no other visible UI between
    // it and the TabBar that would obscure it.
    const bottomInsideSheet = await applyBtn.evaluate((el) => {
      const sheet = el.closest('.wc-sheet');
      if (!sheet) return false;
      const sheetBottom = sheet.getBoundingClientRect().bottom;
      const btnBottom = el.getBoundingClientRect().bottom;
      // Sheet can extend below the button (it includes the reserved
      // padding) — that's the intended behavior, not a regression.
      return btnBottom <= sheetBottom + 1;
    });
    expect(bottomInsideSheet).toBe(true);
  });

  test('Apply button is clickable (not covered by TabBar)', async ({ page }) => {
    await bootApp(page);

    await page.locator('.wc-tab[aria-label="AI"]').click();
    await page.waitForTimeout(300);

    // Type something so the button isn't disabled (it gates on
    // `disabled={busy()}` but stays clickable on idle). Actually
    // the button is only disabled while a request is in flight —
    // an empty instruction does NOT disable it. Just click it.
    const applyBtn = page.locator('.ai-apply-btn').first();
    await expect(applyBtn).toBeVisible();
    await expect(applyBtn).toBeEnabled();

    // If the button is occluded by the TabBar, Playwright's click
    // throws "intercepts pointer events". The previous failure
    // mode was the TabBar (z-index higher than sheet) receiving
    // the click instead of the button.
    await applyBtn.click({ timeout: 2000 });

    // After click, the AI panel should show an error status
    // ("Введи инструкцию") because the textarea was empty —
    // that's enough to confirm the click registered on the
    // button and the submit() handler ran.
    await expect(page.locator('.ai-status-err')).toBeVisible({ timeout: 2000 });
  });
});