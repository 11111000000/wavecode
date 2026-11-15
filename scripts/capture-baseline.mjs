#!/usr/bin/env node
/**
 * capture-baseline — визуальная базовая линия wavecode.
 *
 * Фаза 7 плана zen-ui («Замер»): интерфейс менялся семь фаз, и
 * «красиво» проверить нечем — сравнивать не с чем. Baseline-скриншоты
 * дают точку отсчёта: снимок дефолтного вида редактора на двух
 * размерах экрана, который лежит в репозитории и по которому видно,
 * что следующая правка не развалила композицию.
 *
 * Снимки НЕ используются как пиксельный тест: рендер в разных
 * браузерах и на разных GPU отличается на пиксели, и сравнение
 * картинок в CI даёт только ложные срабатывания. Это — артефакт для
 * человека: открыть и посмотреть, что интерфейс выглядит так, как
 * задумано.
 *
 * Использование:
 *   node scripts/capture-baseline.mjs           # переснять baseline
 *   node scripts/capture-baseline.mjs --check   # только проверить, что он есть
 *
 * Требует собранный `ui/dist` (npm run build в ui/).
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Корень репозитория — от самого скрипта, а не от текущей директории:
// скрипт можно звать из любого места.
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'ui', 'dist');
const OUT_DIR = join(ROOT, 'ui', 'tests', 'baseline');

// Playwright живёт в ui/node_modules, а скрипт — в scripts/ верхнего
// уровня. Резолвим пакет от ui/package.json, а не от scripts/.
const require = createRequire(join(ROOT, 'ui', 'package.json'));
const { chromium } = require('@playwright/test');

/** Кадры: имя файла → размер окна. */
const SHOTS = [
  { file: 'desktop-1440.png', width: 1440, height: 900 },
  { file: 'mobile-390.png', width: 390, height: 844 },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Минимальный статический сервер с SPA-фолбэком на index.html:
 * приложение живёт по hash-роутам, но service worker и манифест
 * запрашиваются обычными путями.
 */
const serveDist = async () => {
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    const rel = normalize(decodeURIComponent(url)).replace(/^(\.\.[/\\])+/, '');
    let file = join(DIST, rel);
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
      file = join(DIST, 'index.html');
    }
    if (!existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}` };
};

/** Системный Chromium — тот же, что и в playwright.config.ts. */
const SYSTEM_CHROMIUM = '/run/current-system/sw/bin/chromium';

const check = () => {
  let ok = true;
  for (const shot of SHOTS) {
    const path = join(OUT_DIR, shot.file);
    if (!existsSync(path)) {
      console.error(`capture-baseline: НЕТ ${path}`);
      ok = false;
      continue;
    }
    const size = statSync(path).size;
    if (size < 10_000) {
      console.error(`capture-baseline: ${shot.file} слишком мал (${size} Б) — похоже на пустой кадр`);
      ok = false;
      continue;
    }
    console.log(`  ${shot.file}  ${(size / 1024).toFixed(0)} КБ`);
  }
  return ok;
};

const capture = async () => {
  if (!existsSync(DIST)) {
    console.error('capture-baseline: нет ui/dist — сначала `cd ui && npm run build`');
    process.exit(2);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const { server, url } = await serveDist();
  const browser = await chromium.launch({
    executablePath: existsSync(SYSTEM_CHROMIUM) ? SYSTEM_CHROMIUM : undefined,
    args: ['--no-sandbox'],
  });

  try {
    for (const shot of SHOTS) {
      const context = await browser.newContext({
        viewport: { width: shot.width, height: shot.height },
        deviceScaleFactor: 1,
        locale: 'ru-RU',
      });
      // Тот же seed, что и в e2e: согласие с условиями и завершённый
      // онбординг — иначе поверх редактора лежит модалка.
      await context.addInitScript(() => {
        localStorage.setItem('wavecodeTermsAccepted', 'v1');
        localStorage.setItem('wavecode-onboarding-complete-v1', 'true');
      });
      const page = await context.newPage();
      await page.goto(`${url}/#/app`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('main.app', { timeout: 15_000 });
      // Дождаться, пока редактор смонтируется и шрифты лягут.
      await page.waitForSelector('.cm-content', { timeout: 15_000 });
      // Мимоходовый тост («Приложение готово к офлайн-работе») живёт
      // 3 секунды и появляется недетерминированно — ждём, пока он
      // исчезнет, чтобы baseline всегда показывал состояние покоя.
      await page
        .locator('[data-testid="toast-item"]')
        .waitFor({ state: 'hidden', timeout: 8_000 })
        .catch(() => {});
      await page.waitForTimeout(600);
      const path = join(OUT_DIR, shot.file);
      await page.screenshot({ path });
      console.log(`  ${shot.file}  ${shot.width}×${shot.height}`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
};

if (process.argv.includes('--check')) {
  console.log('capture-baseline: проверка baseline в репозитории');
  if (!check()) process.exit(1);
  console.log('capture-baseline: baseline на месте.');
} else {
  console.log('capture-baseline: снимаю baseline');
  await capture();
  console.log(`capture-baseline: готово → ${OUT_DIR}`);
}
