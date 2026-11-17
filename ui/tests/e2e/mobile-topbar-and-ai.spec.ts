import { test, expect, type Page } from '@playwright/test';
import { APP_URL } from './support/appUrl';

/**
 * Мобильная шапка и лист ИИ — инварианты из жалобы владельца
 * (2026-11-17, скриншоты с телефона).
 *
 * Три дефекта, которые здесь закрыты:
 *
 *   1. **Отступ между шапкой и полосой транспорта.** Шапка сжималась
 *      (flex-shrink по умолчанию), когда открывался нижний лист, а
 *      транспорт оставался на `top: var(--header-h)`. Получался 11px
 *      пустоты. Теперь шапка не сжимается — зазор равен нулю и при
 *      открытом листе, и в покое.
 *
 *   2. **Наложение кнопок в шапке.** Строка статуса («остановлен»)
 *      вылезала из своего бокса и перекрывала «Новую композицию».
 *      Теперь статус умеет сжиматься до многоточия, а его бокс
 *      физически не выходит за левый край кнопок.
 *
 *   3. **Лист ИИ.** Под кнопкой «✦ Применить» было 72px пустоты
 *      (мёртвый резерв под таббар от старой overlay-раскладки), сама
 *      кнопка висела сиротой, надпись пустого состояния занимала
 *      пять строк, а поле ввода было низким.
 */

async function bootApp(page: Page): Promise<void> {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.wc-topbar', { timeout: 15_000 });
  await page.waitForTimeout(1200);
}

/** Открыть лист ИИ через рельс (единственный вход на мобиле). */
async function openAiSheet(page: Page): Promise<void> {
  await page.locator('.wc-rail__item[aria-label="ИИ"]').click();
  await page.waitForSelector('.wc-sheet[data-kind="ai"]', { timeout: 10_000 });
  await page.waitForTimeout(500);
}

type BarGeom = { height: number; gapToTransport: number; statusRight: number; actionsLeft: number };

const barGeom = (page: Page): Promise<BarGeom> =>
  page.evaluate(() => {
    const rect = (sel: string): DOMRect | null => {
      const el = document.querySelector(sel);
      return el ? el.getBoundingClientRect() : null;
    };
    const bar = rect('.wc-topbar');
    const transport = rect('[data-testid="transport-bar"]');
    const status = rect('.wc-status');
    const actions = rect('.wc-topbar__actions');
    return {
      height: bar ? bar.height : 0,
      gapToTransport: bar && transport ? transport.top - bar.bottom : -1,
      statusRight: status ? status.right : 0,
      actionsLeft: actions ? actions.left : 0,
    };
  });

test.describe('мобильная шапка (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('шапка не сжимается: зазор до полосы транспорта равен нулю', async ({ page }) => {
    await bootApp(page);

    const idle = await barGeom(page);
    expect(idle.gapToTransport).toBe(0);

    await openAiSheet(page);

    const open = await barGeom(page);
    // Высота шапки не изменилась — значит, она не ужалась.
    expect(Math.abs(open.height - idle.height)).toBeLessThanOrEqual(1);
    // И главное: зазора между шапкой и транспортом нет.
    expect(open.gapToTransport).toBe(0);
  });

  test('статус не перекрывает кнопки и обрезается многоточием, а не вылезает', async ({ page }) => {
    await bootApp(page);

    const g = await barGeom(page);
    // Правый край статуса не заходит за левый край блока кнопок.
    expect(g.statusRight).toBeLessThanOrEqual(g.actionsLeft + 1);

    // Текст статуса физически не может выйти за свой бокс.
    const clipped = await page.evaluate(() => {
      const status = document.querySelector('.wc-status');
      const led = document.querySelector('.wc-status__led');
      if (!status || !led) return false;
      return (
        getComputedStyle(status).overflow === 'hidden' &&
        getComputedStyle(led).overflow === 'hidden'
      );
    });
    expect(clipped).toBe(true);

    // На 390px слово «остановлен» помещается целиком — обрезать нечего.
    const labelFits = await page.evaluate(() => {
      const label = document.querySelector('.wc-led__label');
      if (!label) return false;
      return label.scrollWidth <= label.clientWidth + 1;
    });
    expect(labelFits).toBe(true);

    // И та же проверка с открытым листом — вложенный контент тоже
    // не должен сжимать шапку.
    await openAiSheet(page);
    const g2 = await barGeom(page);
    expect(g2.statusRight).toBeLessThanOrEqual(g2.actionsLeft + 1);
  });

  test('на узком экране слово и кнопки уходят в меню «Ещё»', async ({ page }) => {
    await bootApp(page);

    // Слово «wavecode» — дубль логотипа, на телефоне скрыто.
    await expect(page.locator('.wc-topbar__title')).toBeHidden();
    // «Поделиться» и «Консоль» — в меню «Ещё».
    await expect(page.locator('.wc-topbar__share')).toBeHidden();
    await expect(page.locator('.wc-topbar__console')).toBeHidden();

    await page.locator('.wc-icon-btn[aria-label="Ещё"]').first().click();
    await expect(page.locator('.wc-overflow-item--mobile')).toHaveCount(2);
    await expect(
      page.locator('.wc-overflow-menu__panel').getByText('Поделиться'),
    ).toBeVisible();
    await expect(
      page.locator('.wc-overflow-menu__panel').getByText('Консоль'),
    ).toBeVisible();
  });

  test('«Поделиться» из меню «Ещё» открывает ту же модалку', async ({ page }) => {
    await bootApp(page);

    await page.locator('.wc-icon-btn[aria-label="Ещё"]').first().click();
    await page.locator('.wc-overflow-menu__panel').getByText('Поделиться').click();

    const modal = page.locator('.share-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute('aria-label', 'Поделиться партитурой');
  });
});

test.describe('лист ИИ на мобиле (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('под «Применить» нет пустоты, кнопка во всю ширину', async ({ page }) => {
    await bootApp(page);
    await openAiSheet(page);

    const footer = page.locator('.ai-footer');
    const apply = page.locator('[data-ai-apply-btn]');
    const sheet = page.locator('.wc-sheet[data-kind="ai"]');
    const textarea = page.locator('textarea.ai-textarea');

    const footerBox = await footer.boundingBox();
    const applyBox = await apply.boundingBox();
    const sheetBox = await sheet.boundingBox();
    const textareaBox = await textarea.boundingBox();
    expect(footerBox).not.toBeNull();
    expect(applyBox).not.toBeNull();
    expect(sheetBox).not.toBeNull();
    expect(textareaBox).not.toBeNull();

    // Кнопка занимает всю ширину футера (минус его поля), а не висит
    // сиротой отдельной строкой.
    expect(applyBox!.width).toBeGreaterThan(footerBox!.width - 32);

    // Под кнопкой — только поле футера (12px), а не 72px мёртвого
    // резерва под таббар.
    const gapBelow = footerBox!.y + footerBox!.height - (applyBox!.y + applyBox!.height);
    expect(gapBelow).toBeLessThanOrEqual(24);
    // Лист стоит вплотную к рельсу — пустоты под листом нет.
    const sheetGapToRail = footerBox!.y + footerBox!.height - sheetBox!.y - sheetBox!.height;
    expect(Math.abs(sheetGapToRail)).toBeLessThanOrEqual(1);

    // Поле ввода выше, чем было (было 56px).
    expect(textareaBox!.height).toBeGreaterThanOrEqual(72);
  });

  test('надпись пустого состояния мельче', async ({ page }) => {
    await bootApp(page);
    await openAiSheet(page);

    const empty = page.locator('.ai-messages-empty');
    await expect(empty).toBeVisible();
    const fontSize = await empty.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeLessThanOrEqual(12);
  });
});

test.describe('узкий экран 360×800 — ничего не пробило', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('статус не наезжает на кнопки даже на 360px', async ({ page }) => {
    await bootApp(page);

    const g = await barGeom(page);
    expect(g.statusRight).toBeLessThanOrEqual(g.actionsLeft + 1);
    expect(g.gapToTransport).toBe(0);

    await openAiSheet(page);
    const g2 = await barGeom(page);
    expect(g2.statusRight).toBeLessThanOrEqual(g2.actionsLeft + 1);
    expect(g2.gapToTransport).toBe(0);
  });
});
