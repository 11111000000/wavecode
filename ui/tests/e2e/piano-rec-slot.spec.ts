import { test, expect, type Page } from '@playwright/test';

/**
 * Piano REC slot e2e — `math/wavecode-piano-rec-clarity` + polish.
 *
 * Five end-to-end assertions covering the three slot targets
 * (append-stack / replace-score / at-cursor) and the two layout
 * affordances (inline piano on desktop, BottomSheet on mobile):
 *
 *   1. **append-stack + apply** — REC on → tap → ↑ apply → editor
 *      score contains `note("c4")` (existing behavior, regression
 *      guard against breaking `wavecode-piano-modes-and-gain`).
 *
 *   2. **replace-score + apply + undo** — REC on → tap → switch to
 *      ⟳ replace slot → ↑ apply → editor score is the snippet
 *      verbatim (previous content gone). ⌘Z restores prior content
 *      (verifies multi-undo cooperation).
 *
 *   3. **at-cursor + apply** — Click in the editor (focus) → ⌖ cursor
 *      slot becomes enabled → REC on → tap → ↑ apply → snippet is
 *      inserted at the cursor position, editor's `.cm-content`
 *      contains the snippet. Editor's `appStore.score` is NOT
 *      wholesale-replaced (it's an insert, not a replace).
 *
 *   4. **preview-pill** — REC on → tap → `.piano-rec-pill` is
 *      visible with `data-slot` attribute matching the active slot
 *      and the `data-active` indicator lit. Apply clears the pill.
 *
 *   5. **inline-piano on desktop ≥1024px** — `.piano-toggle` is
 *      visible inside `.score-panel-inner`; clicking expands the
 *      inline piano. On mobile viewport, the toggle is absent
 *      (BottomSheet-piano takes over) and `.piano-toggle` count is 0.
 *
 * Viewport policy:
 *   - Desktop Chrome default = 1280×720, ≥1024px → inline piano path.
 *   - Mobile variant 412×900 → BottomSheet-piano path.
 */

const BASE_URL = 'http://127.0.0.1:4173';

async function bootApp(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15_000 });
  await page.waitForTimeout(1500);
}

/** On desktop ≥1024px, open the inline piano via the ScorePanel
 *  toggle. No-op if already open. */
async function openInlinePiano(page: Page): Promise<void> {
  const toggle = page.locator('.piano-toggle').first();
  await toggle.waitFor({ state: 'visible', timeout: 5000 });
  const expanded = await toggle.getAttribute('aria-expanded');
  if (expanded !== 'true') {
    await toggle.click();
    await page.waitForTimeout(150);
  }
  await page.locator('.piano-keys').first().waitFor({ state: 'visible', timeout: 5000 });
}

async function readEditorText(page: Page): Promise<string> {
  const cmContent = page.locator('.cm-content').first();
  return (await cmContent.innerText()).trim();
}

async function clearEditor(page: Page): Promise<void> {
  // Click into the editor, select-all, delete — leaves an empty doc
  // so subsequent apply behavior isn't masked by the default score.
  const cmContent = page.locator('.cm-content').first();
  await cmContent.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);
}

test('append-stack + apply: tap C4 → ↑ apply → editor score contains note("c4")', async ({ page }) => {
  await bootApp(page);
  await openInlinePiano(page);
  await clearEditor(page);

  // 1. REC ON.
  const recBtn = page.locator('.piano-rec-btn').first();
  await recBtn.click();
  await expect(recBtn).toHaveAttribute('aria-pressed', 'true');

  // 2. Default slot is append-stack — visible via data-active.
  const appendBtn = page.locator('.piano-slot-btn[data-slot="append-stack"]').first();
  await expect(appendBtn).toHaveAttribute('data-active', 'true');

  // 3. Tap C4.
  const c4 = page.locator('button.piano-key.white[aria-label="C4"]').first();
  await c4.dispatchEvent('pointerdown', { button: 0 });
  await page.waitForTimeout(40);

  // 4. Preview-pill should be visible with C4 + slot label.
  const pill = page.locator('.piano-rec-pill').first();
  await expect(pill).toBeVisible({ timeout: 1000 });
  await expect(pill).toContainText('C4');
  await expect(pill).toContainText('конец стека');

  // 5. Apply.
  const applyBtn = page.locator('.piano-apply-btn').first();
  await applyBtn.click();
  await page.waitForTimeout(300);

  // 6. Editor contains note("c4").
  const text = await readEditorText(page);
  expect(text).toContain('note("c4")');

  // 7. Buffer cleared — apply button hidden again.
  await expect(applyBtn).toBeHidden();

  // 8. Release C4.
  await c4.dispatchEvent('pointerup', { button: 0 });
  await c4.dispatchEvent('pointerleave', { button: 0 });
});

test('replace-score + apply + undo: tap → ⟳ replace → ↑ apply → editor = snippet, ⌘Z restores', async ({ page }) => {
  await bootApp(page);
  await openInlinePiano(page);
  await clearEditor(page);

  // Pre-populate the editor so we can verify destructive replace +
  // undo restoration.
  const cmContent = page.locator('.cm-content').first();
  await cmContent.click();
  await page.keyboard.type('s("hh*4")');
  await page.waitForTimeout(150);
  const before = await readEditorText(page);
  expect(before).toContain('hh*4');

  // REC ON, switch to replace-score slot.
  await page.locator('.piano-rec-btn').first().click();
  const replaceBtn = page.locator('.piano-slot-btn[data-slot="replace-score"]').first();
  await replaceBtn.click();
  await expect(replaceBtn).toHaveAttribute('data-active', 'true');

  // Tap C4.
  const c4 = page.locator('button.piano-key.white[aria-label="C4"]').first();
  await c4.dispatchEvent('pointerdown', { button: 0 });
  await page.waitForTimeout(40);

  // Apply.
  await page.locator('.piano-apply-btn').first().click();
  await page.waitForTimeout(300);

  // After replace: only the snippet remains; the prior hh*4 is gone.
  const after = await readEditorText(page);
  expect(after).toContain('note("c4")');
  expect(after).not.toContain('hh*4');

  // Undo restores the prior score.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  const restored = await readEditorText(page);
  expect(restored).toContain('hh*4');

  // Release C4.
  await c4.dispatchEvent('pointerup', { button: 0 });
  await c4.dispatchEvent('pointerleave', { button: 0 });
});

test('at-cursor + apply: focus editor → ⌖ cursor enabled → tap → ↑ apply → snippet at cursor', async ({ page }) => {
  await bootApp(page);
  await openInlinePiano(page);
  await clearEditor(page);

  // Pre-populate with one anchor line so cursor position is meaningful.
  const cmContent = page.locator('.cm-content').first();
  await cmContent.click();
  await page.keyboard.type('note("e4")');
  await page.waitForTimeout(150);

  // Click in the editor to gain focus.
  await cmContent.click();
  await page.waitForTimeout(100);

  // The ⌖ cursor slot should now be enabled (was disabled without focus).
  const cursorBtn = page.locator('.piano-slot-btn[data-slot="at-cursor"]').first();
  await expect(cursorBtn).toBeEnabled({ timeout: 2000 });
  await cursorBtn.click();
  await expect(cursorBtn).toHaveAttribute('data-active', 'true');

  // REC ON.
  await page.locator('.piano-rec-btn').first().click();

  // Tap C4.
  const c4 = page.locator('button.piano-key.white[aria-label="C4"]').first();
  await c4.dispatchEvent('pointerdown', { button: 0 });
  await page.waitForTimeout(40);

  // Apply.
  await page.locator('.piano-apply-btn').first().click();
  await page.waitForTimeout(300);

  // Editor now has both the original anchor and the inserted snippet.
  const text = await readEditorText(page);
  expect(text).toContain('note("e4")');
  expect(text).toContain('note("c4")');

  // Release C4.
  await c4.dispatchEvent('pointerup', { button: 0 });
  await c4.dispatchEvent('pointerleave', { button: 0 });
});

test('preview-pill: shows count + first note + active slot, cleared after apply', async ({ page }) => {
  await bootApp(page);
  await openInlinePiano(page);
  await clearEditor(page);

  // REC ON. Default slot append-stack.
  await page.locator('.piano-rec-btn').first().click();

  // Tap 3 distinct notes.
  const c4 = page.locator('button.piano-key.white[aria-label="C4"]').first();
  const e4 = page.locator('button.piano-key.white[aria-label="E4"]').first();
  const g4 = page.locator('button.piano-key.white[aria-label="G4"]').first();

  for (const k of [c4, e4, g4]) {
    await k.dispatchEvent('pointerdown', { button: 0 });
    await page.waitForTimeout(40);
  }

  // Pill: count=3, names C4 E4 G4, slot = конец стека.
  const pill = page.locator('.piano-rec-pill').first();
  await expect(pill).toBeVisible({ timeout: 1000 });
  await expect(pill).toContainText('3');
  await expect(pill).toContainText('C4');
  await expect(pill).toContainText('E4');
  await expect(pill).toContainText('G4');
  await expect(pill).toHaveAttribute('data-slot', 'append-stack');

  // Release all.
  for (const k of [c4, e4, g4]) {
    await k.dispatchEvent('pointerup', { button: 0 });
    await k.dispatchEvent('pointerleave', { button: 0 });
  }

  // Apply — pill clears.
  await page.locator('.piano-apply-btn').first().click();
  await page.waitForTimeout(300);
  await expect(pill).toBeHidden();
});

test('inline-piano on desktop ≥1024px: piano-toggle visible; mobile: hidden', async ({ page, viewport }) => {
  await bootApp(page);

  // On default desktop viewport (1280×720), the toggle exists.
  expect(viewport).toBeTruthy();
  expect(viewport!.width).toBeGreaterThanOrEqual(1024);
  const toggle = page.locator('.piano-toggle').first();
  await expect(toggle).toBeVisible({ timeout: 2000 });

  // Click expand → piano keys appear inline.
  await toggle.click();
  await page.waitForTimeout(150);
  await expect(page.locator('.piano-keys').first()).toBeVisible({ timeout: 2000 });

  // Click collapse → piano keys hidden again.
  await toggle.click();
  await page.waitForTimeout(150);
  await expect(page.locator('.score-piano-inline')).toHaveCount(0);
});

test.describe('mobile BottomSheet-piano', () => {
  test.use({ viewport: { width: 412, height: 900 } });

  test('mobile: inline-piano toggle absent; TabBar Piano opens BottomSheet', async ({ page }) => {
    await bootApp(page);

    // On mobile (<1024px), the inline toggle should NOT render.
    await expect(page.locator('.piano-toggle')).toHaveCount(0);

    // The TabBar Piano tab opens the BottomSheet (instead of the
    // dead-on-desktop fallback we shipped in the polish).
    const tab = page.locator('.wc-tab[aria-label="Piano"]').first();
    await tab.click();
    await page.waitForTimeout(300);

    // BottomSheet-piano body should be visible.
    await expect(page.locator('.piano-keys').first()).toBeVisible({ timeout: 3000 });
  });
});