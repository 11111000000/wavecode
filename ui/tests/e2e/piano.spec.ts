import { test, expect } from '@playwright/test';

/**
 * Piano e2e — verifies the polyphonic + debounced PianoKeyboard
 * from `math/wavecode-piano-polyphony`.
 *
 * Test strategy:
 *   1. Load app, wait for first eval.
 *   2. Enable the piano via the chip in PresetRow
 *      (`button:has-text("Piano")` in `.app-preset-row`).
 *      Wait for the piano sheet to render with `.piano-keys`.
 *   3. Click a single white key (e.g. C4 / D4 — find by
 *      aria-label).
 *   4. Poll the AudioContext (exposed via
 *      `window.__wavecodeAudioCtx`) for active oscillators
 *      > 0 — within 200ms — and assert NO console errors
 *      were emitted by the playNote path.
 *   5. Release the key (pointerup on the same element).
 *   6. Poll for oscillators == 0 within 1s.
 *
 * Notes:
 *   - WebAudio `audioContext.state` may be 'suspended' until
 *     the user gesture unlocks it; the piano click IS a
 *     user gesture, so the first tap should unlock.
 *   - Active oscillator count: walk audioContext.destination
 *     via `getOutputTimestamp()` is not available, but a
 *     simpler heuristic is: every `playNote` creates
 *     OscillatorNode-backed voices whose `.startedAt <
 *     audioContext.currentTime`; Strudel's `webaudioRepl`
 *     exposes `triggeredHaps` count, but for a piano tap
 *     the simplest assertion is that the source count
 *     (alive oscillators in any connected path) is > 0.
 *
 *     In practice: `window.__wavecodeAudioCtx` is set by
 *     LiveAudioEngine.ts in `useAppBootstrap`. We read
 *     `audioContext.state` and a custom stat — the same
 *     source the existing piano-input tests rely on.
 */

const BASE_URL = 'http://127.0.0.1:5173';

async function unlockAudio(page: import('@playwright/test').Page): Promise<void> {
  // The Piano toggle click counts as a user gesture.
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
    // We can't walk `ctx.destination` connections portably, so use
    // a simple protocol: the patched Strudel globals expose a
    // `_activeOscCount` counter that increments on each
    // OscillatorNode start and decrements on `onended`.
    const liveOsc = (window as unknown as { __wavecodeActiveOsc?: () => number }).__wavecodeActiveOsc;
    if (typeof liveOsc === 'function') oscCount = liveOsc();
    return { state: ctx.state, oscCount };
  });
}

test('piano tap on a single key produces audible voice (oscillator active > 0)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // Enable the piano sheet.
  await unlockAudio(page);

  // Click C4 (white key, aria-label="C4").
  const c4 = page.locator('button.piano-key.white[aria-label="C4"]');
  await expect(c4).toBeVisible();
  await c4.dispatchEvent('pointerdown', { button: 0 });

  // Poll for oscillator activity within 200ms.
  let osc = 0;
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(10);
    const stats = await getOscillatorStats(page);
    osc = stats.oscCount;
    if (osc > 0) break;
  }
  expect(osc, 'piano tap should produce at least 1 active oscillator').toBeGreaterThan(0);

  // No errors should have come from the piano path itself.
  // Filter out Strudel/network noise unrelated to piano tap.
  const pianoErrors = errors.filter(
    (e) => !/favicon|DevTools|preload|werkzeug|404|net::ERR_ABORTED|webaudio/i.test(e),
  );
  expect(pianoErrors, `piano tap emitted errors: ${JSON.stringify(pianoErrors)}`).toHaveLength(0);

  // Release: dispatch pointerup. This triggers the accumulated
  // silence / release path.
  await c4.dispatchEvent('pointerup', { button: 0 });
  await c4.dispatchEvent('pointerleave', { button: 0 });

  // Within 1s the oscillators should be down to 0.
  let finalOsc = osc;
  for (let i = 0; i < 100; i += 1) {
    await page.waitForTimeout(10);
    const stats = await getOscillatorStats(page);
    finalOsc = stats.oscCount;
    if (finalOsc === 0) break;
  }
  expect(finalOsc, 'all oscillators should silence within 1s after release').toBe(0);
});

test('piano chord (D4 + E4 simultaneous taps) plays both notes (2 active oscillators)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });
  await page.waitForTimeout(1500);

  await unlockAudio(page);

  const d4 = page.locator('button.piano-key.white[aria-label="D4"]');
  const e4 = page.locator('button.piano-key.white[aria-label="E4"]');
  await expect(d4).toBeVisible();
  await expect(e4).toBeVisible();

  // Press both nearly-simultaneously — inside the 30ms debounce
  // window so the buildPianoSnippet accumulator emits `stack(d4,
  // e4)` as a single eval.
  await d4.dispatchEvent('pointerdown', { button: 0 });
  await e4.dispatchEvent('pointerdown', { button: 0 });

  let osc = 0;
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(10);
    const stats = await getOscillatorStats(page);
    osc = stats.oscCount;
    if (osc >= 2) break;
  }
  expect(osc, 'chord should produce at least 2 active oscillators').toBeGreaterThanOrEqual(2);

  // Release D4 first — the buildPianoSnippet for the still-pressed
  // E4 should keep osc > 0. We don't assert exact count because
  // Strudel's voice-pool may overlap.
  await d4.dispatchEvent('pointerup', { button: 0 });
  await d4.dispatchEvent('pointerleave', { button: 0 });

  // Release E4 → silence.
  await e4.dispatchEvent('pointerup', { button: 0 });
  await e4.dispatchEvent('pointerleave', { button: 0 });

  let finalOsc = osc;
  for (let i = 0; i < 100; i += 1) {
    await page.waitForTimeout(10);
    const stats = await getOscillatorStats(page);
    finalOsc = stats.oscCount;
    if (finalOsc === 0) break;
  }
  expect(finalOsc, 'all oscillators should silence within 1s after both notes released').toBe(0);

  const realErrors = errors.filter(
    (e) => !/favicon|DevTools|preload|werkzeug|404|net::ERR_ABORTED|webaudio/i.test(e),
  );
  expect(realErrors, `chord tap emitted errors: ${JSON.stringify(realErrors)}`).toHaveLength(0);
});
