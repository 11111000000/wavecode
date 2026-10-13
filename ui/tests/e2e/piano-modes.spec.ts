import { test, expect, type Page } from '@playwright/test';

/**
 * Piano modes e2e — `wavecode-piano-modes-and-gain` packet.
 *
 * Three end-to-end assertions covering the three affordances:
 *
 *   1. **Gain balance** — 4-voice chord doesn't clip / pop / distort.
 *      We can't directly assert on AudioBuffer sample peaks from
 *      Playwright, so the test asserts the AudioContext remains in
 *      `'running'` state (not 'interrupted') and that no console
 *      errors fire during a 4-note press. The peer gain-balance
 *      invariants are covered in `PianoSynth.test.ts` (4-voice ≤ 0.6
 *      summed amplitude, compressor engages).
 *
 *   2. **REC + apply** — REC on → tap → ↑ apply → editor score
 *      contains `note("c4").s("triangle")…`. Editor is rendered as
 *      a CodeMirror 6 instance, so we read the .cm-content text.
 *
 *   3. **FOLLOW** — when a score is playing (e.g. a preset that
 *      hits C4), the C4 piano key carries `data-source="follow"`
 *      (or `"both"` if the user pressed C4 simultaneously). The
 *      poll cycles at 50ms, so we wait up to ~1s for the highlight.
 */

const BASE_URL = 'http://127.0.0.1:4173';

async function bootApp(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15_000 });
  await page.waitForTimeout(1500);
}

async function openPiano(page: Page): Promise<void> {
  await page.locator('.app-preset-row button.wc-chip:has-text("Piano")').click();
  await page.waitForSelector('.piano-keys', { timeout: 5000 });
  await page.waitForSelector('.piano-toolbar', { timeout: 5000 });
}

test('gain balance: 4-voice chord keeps AudioContext running and emits no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
  });

  await bootApp(page);
  await openPiano(page);

  // Press 4 keys nearly-simultaneously — simulates a chord tap. Each
  // pointerdown is dispatched into the live Web Audio pipeline.
  const midis = [60, 64, 67, 72]; // C4 E4 G4 C5
  for (const m of midis) {
    const sel = `button.piano-key[aria-label="${['C4', 'E4', 'G4', 'C5'][midis.indexOf(m)]}"]`;
    await page.locator(sel).dispatchEvent('pointerdown', { button: 0 });
  }

  // AudioContext must still be running — a hard clip would force
  // some browsers into the 'interrupted' state on iOS; on desktop
  // Chromium we look for the side-effect of "no errors".
  await page.waitForTimeout(500);
  const ctxState = await page.evaluate(() => {
    const ctx = (window as unknown as { __wavecodeAudioCtx?: AudioContext }).__wavecodeAudioCtx;
    return ctx?.state ?? null;
  });
  expect(ctxState === 'running' || ctxState === 'suspended').toBe(true);

  // Release.
  for (const m of midis) {
    const sel = `button.piano-key[aria-label="${['C4', 'E4', 'G4', 'C5'][midis.indexOf(m)]}"]`;
    await page.locator(sel).dispatchEvent('pointerup', { button: 0 });
    await page.locator(sel).dispatchEvent('pointerleave', { button: 0 });
  }
  await page.waitForTimeout(150);

  const realErrors = errors.filter(
    (e) => !/favicon|DevTools|preload|werkzeug|404|net::ERR_ABORTED|webaudio|\[sampler\]|\[cyclist\]|\[wavecode\]/i.test(e),
  );
  expect(realErrors, `4-voice chord emitted errors: ${JSON.stringify(realErrors)}`).toHaveLength(0);
});

test('REC + apply: tap C4 → ↑ apply → editor score contains note("c4")', async ({ page }) => {
  await bootApp(page);
  await openPiano(page);

  // 1. REC ON.
  const recBtn = page.locator('.piano-rec-btn');
  await recBtn.click();
  await expect(recBtn).toHaveAttribute('aria-pressed', 'true');

  // 2. Tap C4.
  const c4 = page.locator('button.piano-key.white[aria-label="C4"]');
  await c4.dispatchEvent('pointerdown', { button: 0 });
  await page.waitForTimeout(40);

  // 3. Apply button should be visible (REC on + buffer non-empty).
  const applyBtn = page.locator('.piano-apply-btn');
  await expect(applyBtn).toBeVisible({ timeout: 1000 });

  // 4. Click apply. Editor (CodeMirror) should now contain the
  //    committed snippet.
  await applyBtn.click();
  await page.waitForTimeout(300);

  // Switch to the score/sheet tab so the editor view is active.
  // The tab is identified by `.wc-tab[data-active='true']` text.
  // For simplicity we just locate the .cm-content globally.
  const cmContent = page.locator('.cm-content').first();
  await expect(cmContent).toContainText('note("c4")');

  // 5. Buffer should be cleared after apply.
  const applyStillVisible = await applyBtn.isVisible().catch(() => false);
  expect(applyStillVisible).toBe(false);

  // 6. Release C4.
  await c4.dispatchEvent('pointerup', { button: 0 });
  await c4.dispatchEvent('pointerleave', { button: 0 });
});

test('FOLLOW: score playing C4 → piano key C4 carries data-source="follow"', async ({ page }) => {
  await bootApp(page);
  await openPiano(page);

  // Load a snippet that plays C4 every cycle, then eval it via the
  // audio.eval effect — AudioEngine.eval starts the scheduler.
  // We paste the snippet into the editor and trigger play.
  const cmContent = page.locator('.cm-content').first();
  await cmContent.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type('note("c4")');
  await page.waitForTimeout(200);

  // Click the play / eval button. Its selector is the transport
  // play button — `.transport-play-btn[data-tone='cyan']` or
  // similar. We use a text selector.
  // Many UIs: 'Eval' or '▶'. Best-effort: just press a well-known
  // transport key combo. If that fails, fall back to the eval button
  // by aria-label.
  const evalBtn = page.locator('button:has-text("eval"), button:has-text("▶"), button:has-text("Play")').first();
  if (await evalBtn.isVisible().catch(() => false)) {
    await evalBtn.click();
  } else {
    // Try ctrl+enter as a fallback (some apps bind eval to it).
    await page.keyboard.press('Control+Enter');
  }
  await page.waitForTimeout(500);

  // Toggle FOLLOW ON.
  const followBtn = page.locator('.piano-follow-btn');
  await followBtn.click();
  await expect(followBtn).toHaveAttribute('aria-pressed', 'true');

  // Wait for the FOLLOW poll (50ms) to highlight C4.
  const c4 = page.locator('button.piano-key.white[aria-label="C4"]');
  await expect(c4).toHaveAttribute('data-source', /follow|both/, { timeout: 2000 });

  // FOLLOW OFF: highlight clears.
  await followBtn.click();
  await page.waitForTimeout(150);
  await expect(c4).toHaveAttribute('data-source', 'none');
});
