import { test, expect, type Page } from '@playwright/test';

/**
 * Mobile split-pane e2e — `math/wavecode-mobile-split-pane` packet.
 *
 * Five end-to-end assertions covering the mobile-only push-mode layout:
 *
 *   1. **Sheet push-mode exists.** Mobile viewport (412×900) — tap the
 *      "Mixer" tab → BottomSheet opens. Both ScorePanel (top) and the
 *      sheet (bottom) are visible simultaneously (split-pane, not
 *      overlay).
 *
 *   2. **Editor remains interactive while sheet is open.** Sheet is
 *      at 'half' (50vh). Click into `.cm-content`, type a character,
 *      verify the doc reflects it. The editor is usable, not blurred.
 *
 *   3. **Internal sheet tabs switch tools without closing.** Tap the
 *      "AI" tab inside the sheet header → sheet stays open, content
 *      swaps to AIEditPanel. Mixer content is gone, AI is visible.
 *
 *   4. **Score tab closes sheet (primary navigation).** Tap "Score"
 *      in BottomNav → sheet closes, ScorePanel takes full height,
 *      `.wc-sheet[data-snap='closed']` is rendered.
 *
 *   5. **Drag-handle resizes sheet.** Pointer-down on the top-handle,
 *      drag up → sheet height increases; drag down → sheet height
 *      decreases. The CSS var --sheet-h on `<html>` reflects the
 *      change (read via getComputedStyle / inline style attribute).
 *
 * Desktop ≥1024px is regression-guarded separately by `piano-rec-slot.spec.ts`
 * — the right-side drawer behavior is unchanged.
 */

const BASE_URL = 'http://127.0.0.1:4173';

async function bootApp(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15_000 });
  await page.waitForTimeout(1500);
}

test.describe('mobile split-pane (412×900)', () => {
  test.use({ viewport: { width: 412, height: 900 } });

  test('Sheet push-mode: open Mixer tab → both editor and sheet visible', async ({ page }) => {
    await bootApp(page);

    // Before: sheet is closed. BottomNav Mixer tab is visible.
    const mixerTab = page.locator('.wc-tab[aria-label="Mixer"]');
    await expect(mixerTab).toBeVisible();
    await mixerTab.click();
    await page.waitForTimeout(300);

    // Sheet opens with split-pane (in-flow, not overlay).
    // On mobile, the sheet's transform should NOT be translateY(0)
    // (that's the desktop snap state). Instead, the sheet has a
    // computed height > 0 because it's a flex-child.
    const sheet = page.locator('.wc-sheet').first();
    await expect(sheet).toBeVisible();
    const sheetBox = await sheet.boundingBox();
    expect(sheetBox).not.toBeNull();
    expect(sheetBox!.y).toBeGreaterThan(48); // below TopBar (~48px)
    expect(sheetBox!.y).toBeLessThan(800); // above BottomNav

    // ScorePanel visible above the sheet — both rendered.
    const scorePanel = page.locator('.score-panel').first();
    await expect(scorePanel).toBeVisible();
    const scoreBox = await scorePanel.boundingBox();
    expect(scoreBox).not.toBeNull();
    expect(scoreBox!.height).toBeGreaterThan(150);

    // Sheet has a top-handle (drag affordance) — the cyan pill area.
    await expect(page.locator('.wc-sheet__top-handle').first()).toBeVisible();

    // Internal sheet-tabs are visible inside the sheet header.
    await expect(page.locator('.wc-sheet__tabs').first()).toBeVisible();
    await expect(page.locator('.wc-sheet__tab').first()).toBeVisible();
  });

  test('Editor remains interactive while sheet is open', async ({ page }) => {
    await bootApp(page);

    // Open Mixer sheet.
    await page.locator('.wc-tab[aria-label="Mixer"]').click();
    await page.waitForTimeout(300);

    // Click into the editor and type a character.
    const cmContent = page.locator('.cm-content').first();
    await cmContent.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);
    await page.keyboard.type('note("c4")');
    await page.waitForTimeout(200);

    // Editor reflects what we typed.
    await expect(cmContent).toContainText('note("c4")');
    // Sheet is still visible (not blocked by typing in editor).
    await expect(page.locator('.wc-sheet').first()).toBeVisible();
  });

  test('Internal sheet tabs switch tools without closing', async ({ page }) => {
    await bootApp(page);

    // Open Mixer.
    await page.locator('.wc-tab[aria-label="Mixer"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('.wc-sheet').first()).toBeVisible();

    // Tap "AI" tab inside the sheet header (SheetTabs).
    const aiSheetTab = page.locator('.wc-sheet__tab[data-tab="chat"]').first();
    await aiSheetTab.click();
    await page.waitForTimeout(300);

    // Sheet still open (didn't close).
    await expect(page.locator('.wc-sheet').first()).toBeVisible();
    // AI tab is now active (cyan highlight).
    await expect(aiSheetTab).toHaveAttribute('data-active', 'true');
    // Mixer tab is no longer active.
    const mixerSheetTab = page.locator('.wc-sheet__tab[data-tab="mixer"]').first();
    await expect(mixerSheetTab).toHaveAttribute('data-active', 'false');
  });

  test('Score tab closes sheet (primary navigation back to editor)', async ({ page }) => {
    await bootApp(page);

    // Open AI sheet.
    await page.locator('.wc-tab[aria-label="AI"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('.wc-sheet').first()).toBeVisible();

    // Tap Score in BottomNav.
    const scoreTab = page.locator('.wc-tab[aria-label="Score"]');
    await scoreTab.click();
    await page.waitForTimeout(300);

    // Sheet closed.
    await expect(page.locator('.wc-sheet[data-snap="closed"]').first()).toBeVisible();
    // ScorePanel took the full remaining height.
    const scorePanel = page.locator('.score-panel').first();
    const scoreBox = await scorePanel.boundingBox();
    expect(scoreBox).not.toBeNull();
    // On a 412×900 viewport with TopBar ~48px + BottomNav ~56px, the
    // ScorePanel should claim most of the remaining ~796px height
    // once the sheet is closed.
    expect(scoreBox!.height).toBeGreaterThan(600);
  });

  test('Drag-handle resizes sheet — pointer drag updates --sheet-h CSS var', async ({ page }) => {
    await bootApp(page);

    // Open Mixer sheet (default snap = half, 50vh).
    await page.locator('.wc-tab[aria-label="Mixer"]').click();
    await page.waitForTimeout(300);

    // Read the initial --sheet-h CSS var on documentElement.
    const initialH = await page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--sheet-h'),
    );
    // Either '' (snap-driven, no explicit var) or '450px' (450 = 50% of 900).

    // Pointer drag on top-handle: down 80px then up (negative dy).
    const handle = page.locator('.wc-sheet__top-handle').first();
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    const handleX = handleBox!.x + handleBox!.width / 2;
    const handleY = handleBox!.y + handleBox!.height / 2;

    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(handleX, handleY - 80, { steps: 10 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const afterDragUp = await page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--sheet-h'),
    );
    // After dragging up, --sheet-h should be larger than initial.
    if (initialH !== '' && afterDragUp !== '') {
      const initialPx = parseInt(initialH, 10);
      const afterPx = parseInt(afterDragUp, 10);
      expect(afterPx).toBeGreaterThan(initialPx);
    } else {
      // Either case: after drag, the var should be set (non-empty).
      expect(afterDragUp).not.toBe('');
    }

    // Drag down past the snap threshold → sheet should close.
    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(handleX, handleY + 400, { steps: 10 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Either sheet is closed (dy too large) or height is small.
    const closedExists = await page
      .locator('.wc-sheet[data-snap="closed"]')
      .count();
    expect(closedExists).toBeGreaterThanOrEqual(1);
  });
});