import { test, expect } from '@playwright/test';

/**
 * Sample loader e2e — verifies that CC0 Freesound drum samples
 * (registered via loadAllSamples → Strudel `samples({drums: ...})`)
 * are reachable through the standard preset flow.
 *
 * Smoke checks (headless chromium — no real audio playback):
 *   - все drum-файлы из public/samples/drums/ отдают 200,
 *   - 808-king preset загружается без ошибок,
 *   - ▶ Запуск не падает.
 */

const SAMPLE_FILES = [
  'bd.mp3', 'bd-sub.mp3', 'sd.mp3', 'hh.mp3', 'oh.mp3',
  'cp.mp3', 'rim.mp3', 'tom-l.mp3', 'tom-m.mp3', 'tom-h.mp3',
  'crash.mp3', 'ride.mp3', 'sh.mp3', 'cb.mp3',
];

test('all 14 CC0 drum samples are served by Vite (HTTP 200)', async ({ page }) => {
  const responses = [];
  for (const f of SAMPLE_FILES) {
    const r = await page.request.get(`/samples/drums/${f}`);
    expect(r.status(), `${f} should be 200`).toBe(200);
    responses.push({ file: f, status: r.status(), size: (await r.body()).length });
  }
  // All sizes > 0 — none of the files are empty placeholders.
  for (const r of responses) {
    expect(r.size, `${r.file} body is empty`).toBeGreaterThan(0);
  }
});

test('LICENSE.txt is served and mentions CC0', async ({ page }) => {
  const r = await page.request.get('/samples/drums/LICENSE.txt');
  expect(r.status()).toBe(200);
  const body = await r.text();
  expect(body).toMatch(/CC0|Creative Commons/);
});

test('808-king preset loads, eval plays, no console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });
  // Give the onMount a beat to call loadAllSamples() (samples are registered
  // lazily — only on first eval). 1s is enough for the dynamic import.
  await page.waitForTimeout(1000);

  // Select 808-king preset.
  const presetSelect = page.locator('select.preset-select');
  await expect(presetSelect).toBeVisible();
  await presetSelect.selectOption('808-king');

  // CodeMirror should reflect the new score.
  const editorText = await page.locator('.cm-content').textContent();
  expect(editorText || '').toContain('808 king');

  // Trigger ▶ Запуск (Eval).
  await page.locator('button:has-text("Запуск")').click();
  await page.waitForTimeout(2000);

  // No uncaught exceptions; allow Strudel/network warnings but not errors.
  const realErrors = errors.filter(
    (e) => !/favicon|DevTools|preload|werkzeug|404|net::ERR_ABORTED/i.test(e),
  );
  expect(realErrors, `unexpected errors: ${JSON.stringify(realErrors)}`).toHaveLength(0);
});
