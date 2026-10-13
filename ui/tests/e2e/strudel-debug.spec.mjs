import { test, expect } from '@playwright/test';

test('Strudel eval produces triggers', async ({ page }) => {
  const consoleLogs = [];
  const errors = [];
  page.on('console', (m) => consoleLogs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });
  console.log('=== initial state ===');
  await page.waitForTimeout(2000);

  console.log('=== Test 440Hz ===');
  await page.locator('button:has-text("🔊 440")').click();
  await page.waitForTimeout(1500);

  console.log('=== Eval ===');
  await page.locator('button[aria-label="Запуск"]').click();
  await page.waitForTimeout(5000);

  const debugInfo = await page.evaluate(() => {
    const w = window;
    const dbg = w.__wavecodeDebug;
    const ctx = w.__wavecodeAudioCtx;
    return {
      debug: dbg || null,
      audioCtxExists: !!ctx,
      audioCtxState: ctx ? ctx.state : null,
      audioCtxSampleRate: ctx ? ctx.sampleRate : null,
      audioCtxCurrentTime: ctx ? ctx.currentTime : null,
    };
  });

  console.log('=== DEBUG ===');
  console.log(JSON.stringify(debugInfo, null, 2));

  console.log('=== console logs ===');
  consoleLogs.forEach((l) => console.log(l));

  console.log('=== errors ===');
  errors.forEach((e) => console.log(e));

  expect(errors).toHaveLength(0);
  expect(debugInfo.debug).not.toBeNull();
  expect(debugInfo.debug.triggers).toBeGreaterThan(0);
});
