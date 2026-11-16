import { test, expect } from '@playwright/test';
import { APP_URL } from './support/appUrl';

/**
 * Mini-notation toolbar — полоса кнопок вставки сниппетов
 * (note(, s(, stack(, <, >, etc.). Вставляет сниппет в позицию курсора
 * через CodeMirror's view.dispatch и оставляет курсор сразу за ним.
 *
 * wavecode-zen-ui-phases-6-7 (фаза 6, «Тишина»): мини-нотация убрана
 * под раскрытием «⋯ Подробнее» под партитурой — 14 кнопок не должны кричать
 * о себе в покое. Раскрытие закрыто по умолчанию на всех экранах.
 */
test('mobile (375×667): mini-toolbar is visible and tapping `note(` inserts the snippet into the editor', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });
  // CodeMirror mounts async; give it a moment to render and for onReady to fire.
  await page.waitForSelector('.cm-content', { timeout: 15000 });

  // Полоса закрыта по умолчанию: живёт под раскрытием «⋯ Подробнее».
  const toggle = page.locator('[data-testid="score-extra-toggle"]');
  await expect(toggle).toBeVisible();
  await toggle.click();

  const toolbar = page.locator('.mini-toolbar');
  await expect(toolbar).toBeVisible();

  // Default code is empty for a fresh user; clear any IDB-restored text
  // by selecting all + delete so we have a deterministic baseline.
  // .cm-scroller is the visible editor surface; .cm-content is taller
  // than its clipped viewport, so clicking the latter aims at the
  // centre of a box that is mostly scrolled out of sight.
  const editor = page.locator('.cm-scroller');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await expect(page.locator('.cm-content')).toHaveText('');

  // Park cursor at end of (now empty) doc and tap `note(`.
  const noteBtn = toolbar.locator('button.mini-toolbar-btn', { hasText: 'note(' });
  await expect(noteBtn).toBeVisible();
  await noteBtn.click();

  await expect(page.locator('.cm-content')).toContainText('note(');
});

test('desktop (1280): mini-toolbar is behind the same disclosure', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15000 });
  await page.waitForSelector('.cm-content', { timeout: 15000 });

  // На десктопе полоса тоже за раскрытием — тишина одинакова везде.
  const toggle = page.locator('[data-testid="score-extra-toggle"]');
  await expect(toggle).toBeVisible();
  await toggle.click();

  const toolbar = page.locator('.mini-toolbar');
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator('button.mini-toolbar-btn').first()).toBeVisible();
});
