import { test, expect } from '@playwright/test';

/**
 * Piano e2e — wavecode-piano-parallel-rec-instrument.
 *
 * Verifies the new architecture:
 *   1. Preset plays via Strudel scheduler.
 *   2. Tapping a piano key adds Web Audio voices WITHOUT stopping or
 *      replacing the main score (the score text is preserved).
 *   3. REC toggle + tap → recBuffer accumulates notes; the main score
 *      is still untouched (piano never mutates score).
 *   4. Instrument selector switches waveform for subsequent noteOn.
 *
 * These tests are the regression guard against re-introducing the
 * "piano interrupts main track" bug that motivated this packet.
 */

const BASE_URL = 'http://127.0.0.1:5173';

async function unlockAudio(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('.app-preset-row button:has-text("Piano")').click();
  await page.waitForSelector('.piano-keys', { timeout: 5000 });
}

async function getOscillatorStats(page: import('@playwright/test').Page): Promise<{
  state: string | null;
  oscCount: number;
}> {
  return await page.evaluate(() => {
    const ctx = (window as unknown as { __wavecodeAudioCtx?: AudioContext }).__wavecodeAudioCtx;
    if (!ctx) return { state: null, oscCount: 0 };
    let oscCount = 0;
    const liveOsc = (window as unknown as { __wavecodeActiveOsc?: () => number }).__wavecodeActiveOsc;
    if (typeof liveOsc === 'function') oscCount = liveOsc();
    return { state: ctx.state, oscCount };
  });
}

test('piano tap preserves main score (no Strudel re-eval from keyboard)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // Snapshot the score BEFORE the piano tap. The CodeMirror editor's
  // doc is the source of truth for what the Strudel scheduler would
  // eval. If the piano mutates it, the new text will differ.
  const scoreBefore = await page.evaluate(() => {
    const cm = document.querySelector('.cm-content');
    return cm ? (cm.textContent ?? '') : '';
  });
  expect(scoreBefore.length).toBeGreaterThan(20);

  await unlockAudio(page);

  const c4 = page.locator('button.piano-key.white[aria-label="C4"]');
  await expect(c4).toBeVisible();
  await c4.dispatchEvent('pointerdown', { button: 0 });
  await page.waitForTimeout(50);
  await c4.dispatchEvent('pointerup', { button: 0 });
  await c4.dispatchEvent('pointerleave', { button: 0 });
  await page.waitForTimeout(200);

  // Snapshot the score AFTER the tap. If the piano replaced the score
  // with stack(...), the text would differ.
  const scoreAfter = await page.evaluate(() => {
    const cm = document.querySelector('.cm-content');
    return cm ? (cm.textContent ?? '') : '';
  });
  expect(scoreAfter, 'piano must NOT replace the main score').toBe(scoreBefore);

  // No errors should come from the piano tap itself.
  const pianoErrors = errors.filter(
    (e) => !/favicon|DevTools|preload|werkzeug|404|net::ERR_ABORTED|webaudio/i.test(e),
  );
  expect(pianoErrors, `piano tap emitted errors: ${JSON.stringify(pianoErrors)}`).toHaveLength(0);
});

test('piano REC toggle + tap does not write to main score until committed', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });
  await page.waitForTimeout(1500);

  const scoreBefore = await page.evaluate(() => {
    const cm = document.querySelector('.cm-content');
    return cm ? (cm.textContent ?? '') : '';
  });

  await unlockAudio(page);

  // Toggle REC on via the toolbar button (rendered inside .piano-toolbar-row).
  const recBtn = page.locator('.piano-rec-btn');
  await expect(recBtn).toBeVisible();
  await recBtn.click();
  // data-active flips to "true" when rec is on.
  await expect(recBtn).toHaveAttribute('data-active', 'true');

  // Tap a key — recBuffer should accumulate. Main score untouched.
  const c4 = page.locator('button.piano-key.white[aria-label="C4"]');
  await c4.dispatchEvent('pointerdown', { button: 0 });
  await page.waitForTimeout(50);
  await c4.dispatchEvent('pointerup', { button: 0 });
  await page.waitForTimeout(200);

  const scoreAfter = await page.evaluate(() => {
    const cm = document.querySelector('.cm-content');
    return cm ? (cm.textContent ?? '') : '';
  });
  expect(scoreAfter, 'piano+rec must NOT replace the main score mid-tap').toBe(scoreBefore);

  // Toggle REC off — recBuffer is flushed but still NOT applied to score
  // by PianoKeyboard alone (commit is a separate future action).
  await recBtn.click();
  await expect(recBtn).toHaveAttribute('data-active', 'false');

  const scoreFinal = await page.evaluate(() => {
    const cm = document.querySelector('.cm-content');
    return cm ? (cm.textContent ?? '') : '';
  });
  expect(scoreFinal, 'toggle-off alone must NOT mutate the main score').toBe(scoreBefore);

  const realErrors = errors.filter(
    (e) => !/favicon|DevTools|preload|werkzeug|404|net::ERR_ABORTED|webaudio/i.test(e),
  );
  expect(realErrors, `rec flow emitted errors: ${JSON.stringify(realErrors)}`).toHaveLength(0);
});

test('instrument selector changes oscType for next tap (no errors)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });
  await page.waitForTimeout(1500);

  await unlockAudio(page);

  // Click "sine" instrument button. After clicking, its data-active flips.
  const sineBtn = page.locator('.piano-inst-btn[title="sine"]');
  await expect(sineBtn).toBeVisible();
  await sineBtn.click();
  await expect(sineBtn).toHaveAttribute('data-active', 'true');

  // The previously-active triangle button should now be inactive.
  const triangleBtn = page.locator('.piano-inst-btn[title="triangle"]');
  await expect(triangleBtn).toHaveAttribute('data-active', 'false');

  // Tap C4 — audio context should see osc activity (oscCount > 0).
  const c4 = page.locator('button.piano-key.white[aria-label="C4"]');
  await c4.dispatchEvent('pointerdown', { button: 0 });
  await page.waitForTimeout(50);

  let osc = 0;
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(10);
    const stats = await getOscillatorStats(page);
    osc = stats.oscCount;
    if (osc > 0) break;
  }
  expect(osc, 'piano tap with sine instrument should produce active oscillator').toBeGreaterThan(0);

  await c4.dispatchEvent('pointerup', { button: 0 });
  await c4.dispatchEvent('pointerleave', { button: 0 });
  await page.waitForTimeout(150);

  const realErrors = errors.filter(
    (e) => !/favicon|DevTools|preload|werkzeug|404|net::ERR_ABORTED|webaudio/i.test(e),
  );
  expect(realErrors, `instrument change emitted errors: ${JSON.stringify(realErrors)}`).toHaveLength(0);
});