#!/usr/bin/env node
/**
 * Проверки инвариантов wavecode — БЕЗ внешних зависимостей.
 *
 * Это verifier'ы для math-coding v5: каждый claim в `spec.json` ссылается
 * на одну из этих проверок. Скрипт написан только на stdlib Node, потому
 * что math-coding исполняет verifier и в изолированной копии репозитория
 * (`git clone` без `node_modules`) — проверка обязана работать там, где
 * зависимости не установлены.
 *
 *   node scripts/check-invariants.mjs <режим>
 *
 * Код возврата: 0 — инвариант держится, 1 — нарушен.
 *
 * Режимы:
 *   layering   — слои не тянут друг друга (то же, что enforce eslint)
 *   console    — domain/application не пишут в глобальный console
 *   camera     — камера включается только явным действием пользователя
 *   deploy     — ни один CI-workflow не деплоит
 *   secrets    — в репозитории нет значений секретов
 *   decisions  — каждое решение в decisions/ сохраняет свои ключи
 *   spec       — spec.json (math-coding v5) цел и связан с живыми файлами
 *   gate       — CI-гейт math-coding использует ядро v5
 *   term       — термин-бокс раскладывает жесты по разным строкам сетки
 *   mobile     — мобильная раскладка шапки и листа ИИ не разъезжается
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Прочитать файл относительно корня репозитория. */
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** Рекурсивно собрать файлы каталога с нужным расширением. */
const walk = (relDir, extensions) => {
  const absolute = join(ROOT, relDir);
  if (!existsSync(absolute)) return [];
  const found = [];
  for (const entry of readdirSync(absolute)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const rel = `${relDir}/${entry}`;
    const stat = statSync(join(ROOT, rel));
    if (stat.isDirectory()) {
      found.push(...walk(rel, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      found.push(rel);
    }
  }
  return found;
};

/** Все файлы, отслеживаемые git (плюс не-игнорируемые новые). */
const trackedFiles = () => {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter((entry) => entry.length > 0);
};

/** Источники импортов файла. */
const importSources = (text) => {
  const sources = [];
  const pattern = /\bfrom\s+['"]([^'"]+)['"]/g;
  let match = pattern.exec(text);
  while (match !== null) {
    sources.push(match[1]);
    match = pattern.exec(text);
  }
  return sources;
};

/** Убрать комментарии — правила eslint смотрят на код, а не на прозу. */
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Совпадает ли модуль с запрещённой группой eslint. */
const matchesGroup = (source, group) => {
  if (group.endsWith('*')) return source.startsWith(group.slice(0, -1));
  return source === group || source.startsWith(`${group}/`);
};

// ── layering ────────────────────────────────────────────────────────────────

const LAYERS = [
  {
    dir: 'ui/src/domain',
    banned: [
      'solid-js',
      '@solidjs/*',
      '@strudel/*',
      'tone',
      '@ai-sdk/*',
      'ai',
      '@effect/platform*',
      'idb-keyval',
    ],
  },
  {
    dir: 'ui/src/application',
    banned: ['solid-js', '@solidjs/*', '@strudel/*', 'tone', '@ai-sdk/*', 'ai', 'idb-keyval'],
  },
  {
    dir: 'ui/src/infrastructure',
    banned: ['solid-js', '@solidjs/*'],
  },
  {
    dir: 'ui/src/presentation',
    banned: ['@strudel/*', 'tone', '@ai-sdk/*', 'ai', 'idb-keyval'],
  },
];

const checkLayering = () => {
  const violations = [];
  for (const layer of LAYERS) {
    for (const file of walk(layer.dir, ['.ts', '.tsx'])) {
      if (file.includes('.test.')) continue;
      for (const source of importSources(read(file))) {
        for (const group of layer.banned) {
          if (matchesGroup(source, group)) {
            violations.push(`${file}: импорт "${source}" запрещён в ${layer.dir}`);
          }
        }
      }
    }
  }
  return violations;
};

// ── console ─────────────────────────────────────────────────────────────────

const checkConsole = () => {
  const violations = [];
  for (const layer of ['ui/src/domain', 'ui/src/application']) {
    for (const file of walk(layer, ['.ts', '.tsx'])) {
      // Тесты могут проверять поведение console — eslint это разрешает.
      if (file.includes('.test.')) continue;
      const lines = stripComments(read(file)).split('\n');
      lines.forEach((line, index) => {
        // Глобальный console — только он запрещён; внедрённый `opts.console`
        // (см. domain/presets.ts) — законный канал для тестов.
        if (/(?<![.\w$])console\s*\./.test(line)) {
          violations.push(`${file}:${index + 1}: console в ${layer}`);
        }
      });
    }
  }
  return violations;
};

// ── camera ──────────────────────────────────────────────────────────────────

const CAMERA_TOKENS = ['toggleGestureControl', 'installGestureController', 'startGestureCapture'];
const CAMERA_ALLOWED = new Set([
  'ui/src/presentation/state/gestureStore.ts',
  'ui/src/presentation/panels/GesturePanel.tsx',
  'ui/src/infrastructure/gesture/GestureCapture.ts',
]);

const checkCamera = () => {
  const violations = [];
  for (const file of walk('ui/src', ['.ts', '.tsx'])) {
    if (file.includes('.test.')) continue;
    const text = read(file);
    const mentioned = CAMERA_TOKENS.filter((token) => text.includes(token));
    if (mentioned.length === 0) continue;
    if (CAMERA_ALLOWED.has(file)) continue;
    violations.push(`${file}: камера запускается вне панели жестов (${mentioned.join(', ')})`);
  }
  return violations;
};

// ── deploy ──────────────────────────────────────────────────────────────────

const DEPLOY_COMMANDS = /\b(ssh|scp|rsync|deploy\.sh|wrangler|netlify|vercel|surge|firebase)\b/;

const checkDeploy = () => {
  const violations = [];
  const dirs = ['.github/workflows', '.gitverse/workflows'];
  for (const dir of dirs) {
    for (const file of walk(dir, ['.yml', '.yaml'])) {
      read(file)
        .split('\n')
        .forEach((line, index) => {
          const trimmed = line.trim();
          // Комментарии и описания не являются командами деплоя.
          if (trimmed.startsWith('#')) return;
          if (DEPLOY_COMMANDS.test(line)) {
            violations.push(`${file}:${index + 1}: workflow выполняет деплой — "${trimmed}"`);
          }
        });
    }
  }
  return violations;
};

// ── secrets ─────────────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  { name: 'openai-style key', pattern: /\bsk-[A-Za-z0-9]{20,}/ },
  { name: 'litellm per-app key', pattern: /\bsk-litellm-[A-Za-z0-9]{10,}/ },
  { name: 'github token', pattern: /\bghp_[A-Za-z0-9]{30,}/ },
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    name: 'значение секрета в присвоении',
    // Ключ/токен, заданный значением: `VITE_LLM_PROXY_KEY=<значение>`.
    // Значение — сплошной буквенно-цифровой блок, поэтому плейсхолдеры
    // вида `ci-placeholder-not-used-at-runtime` (с дефисами) не ловятся.
    pattern:
      /(VITE_LLM_PROXY_KEY|LITELLM_MASTER_KEY|API_KEY|SECRET_KEY|ACCESS_TOKEN)[ \t]*[:=][ \t]*["']?[A-Za-z0-9+/]{32,}/,
  },
];

const checkSecrets = () => {
  const violations = [];
  for (const file of trackedFiles()) {
    if (file.includes('node_modules/') || file.endsWith('.png') || file.endsWith('.ico')) continue;
    let text;
    try {
      text = read(file);
    } catch {
      continue;
    }
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(text)) violations.push(`${file}: похоже на секрет (${name})`);
    }
  }
  return violations;
};

// ── decisions ───────────────────────────────────────────────────────────────

const DECISION_KEYS = ['schema:', 'id:', 'state:', 'intent:', 'commitment:', 'obligations:'];

const checkDecisions = () => {
  const violations = [];
  for (const file of walk('decisions', ['.yaml', '.yml'])) {
    const text = read(file);
    for (const key of DECISION_KEYS) {
      if (!new RegExp(`^${key}`, 'm').test(text)) {
        violations.push(`${file}: нет ключа "${key}"`);
      }
    }
    const schema = /^schema:\s*(.+)$/m.exec(text);
    if (schema !== null && !/^math-coding\/3\.[0-9]+$/.test(schema[1].trim())) {
      violations.push(`${file}: неожиданное семейство схемы "${schema[1].trim()}"`);
    }
  }
  return violations;
};

// ── spec ────────────────────────────────────────────────────────────────────

const checkSpec = () => {
  const violations = [];
  let spec;
  try {
    spec = JSON.parse(read('spec.json'));
  } catch (error) {
    return [`spec.json: не читается как JSON (${error.message})`];
  }
  if (spec.schema_version !== 5) {
    violations.push(`spec.json: schema_version=${spec.schema_version}, ожидался 5`);
  }
  if (spec.goal === null || spec.goal === undefined) {
    violations.push('spec.json: нет цели (goal)');
  } else {
    if (!spec.goal.text) violations.push('spec.json: цель без текста');
    if (!Array.isArray(spec.goal.scope) || spec.goal.scope.length === 0) {
      violations.push('spec.json: цель без области (scope)');
    }
    for (const path of spec.goal.scope ?? []) {
      if (!existsSync(join(ROOT, path))) violations.push(`spec.json: путь цели "${path}" не существует`);
    }
  }
  const claims = Array.isArray(spec.claims) ? spec.claims : [];
  if (claims.length === 0) violations.push('spec.json: нет ни одного утверждения (claim)');
  for (const claim of claims) {
    if (!claim.id) violations.push('spec.json: claim без id');
    if (!claim.text) violations.push(`spec.json: claim "${claim.id}" без текста`);
    if (!claim.falsifier) violations.push(`spec.json: claim "${claim.id}" без опровергателя`);
    const requirements = Array.isArray(claim.requirements) ? claim.requirements : [];
    const verifiers = requirements.filter((r) => r.kind === 'verifier');
    if (verifiers.length === 0) {
      violations.push(`spec.json: claim "${claim.id}" без исполняемой проверки`);
    }
    if (!claim.control) {
      violations.push(`spec.json: claim "${claim.id}" без отрицательного контроля`);
    }
    if (!Array.isArray(claim.scope) || claim.scope.length === 0) {
      violations.push(`spec.json: claim "${claim.id}" без области (scope)`);
    }
    for (const path of claim.scope ?? []) {
      if (!existsSync(join(ROOT, path))) {
        violations.push(`spec.json: claim "${claim.id}" — путь "${path}" не существует`);
      }
    }
    if (claim.source !== null && claim.source !== undefined) {
      if (!existsSync(join(ROOT, claim.source.path))) {
        violations.push(`spec.json: claim "${claim.id}" — источник "${claim.source.path}" не существует`);
      }
    }
  }
  return violations;
};

// ── gate ────────────────────────────────────────────────────────────────────

const checkGate = () => {
  const violations = [];
  const file = '.gitverse/workflows/math-coding.yml';
  if (!existsSync(join(ROOT, file))) {
    return [`${file}: гейт math-coding отсутствует`];
  }
  const text = read(file);
  if (!/mathc\s+run/.test(text)) violations.push(`${file}: гейт не запускает "mathc run"`);
  if (!/v5\./.test(text)) violations.push(`${file}: гейт не указывает релиз ядра v5`);
  for (const legacy of ['mathc self-check', 'mathc rehash', 'mathc new-decision']) {
    if (text.includes(legacy)) violations.push(`${file}: гейт вызывает команду v3.7 "${legacy}"`);
  }
  return violations;
};

// ── term ────────────────────────────────────────────────────────────────────

const checkTerm = () => {
  const violations = [];
  const domain = 'ui/src/domain/gesture/term.ts';
  if (!existsSync(join(ROOT, domain))) {
    return [`${domain}: домен термин-бокса отсутствует`];
  }
  const text = read(domain);
  const rows = [...text.matchAll(/\{ gesture: '([A-Za-z]+)', sample: '([a-z]+)'/g)].map((m) => ({
    gesture: m[1],
    sample: m[2],
  }));
  if (rows.length !== 4) {
    violations.push(`${domain}: маппинг жест→строка содержит ${rows.length} строк, ожидалось 4`);
  }
  const samples = rows.map((row) => row.sample);
  if (new Set(samples).size !== samples.length) {
    violations.push(`${domain}: два жеста пишут в одну строку (${samples.join(', ')})`);
  }
  for (const sample of samples) {
    if (!['bd', 'sd', 'hh', 'cp'].includes(sample)) {
      violations.push(`${domain}: строка "${sample}" не из 4×8 сетки`);
    }
  }
  const targets = /TERM_TARGET_OPTIONS\s*=\s*\[([^\]]*)\]/.exec(text);
  if (targets === null) {
    violations.push(`${domain}: нет списка целевых длин`);
  } else {
    const values = targets[1]
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    for (const expected of ['4', '8', '16']) {
      if (!values.includes(expected)) {
        violations.push(`${domain}: целевая длина ${expected} ударов не предложена`);
      }
    }
  }
  const store = 'ui/src/presentation/state/gestureStore.ts';
  const storeText = read(store);
  if (!storeText.includes('termSampleForGesture')) {
    violations.push(`${store}: запись идёт мимо маппинга жест→строка`);
  }
  if (!storeText.includes('gestureTermTarget')) {
    violations.push(`${store}: запись не сверяется с целевой длиной`);
  }
  const box = 'ui/src/presentation/components/TermBox.tsx';
  if (!existsSync(join(ROOT, box))) {
    violations.push(`${box}: термин-бокс отсутствует`);
  }
  return violations;
};

// ── mobile ──────────────────────────────────────────────────────────────────

/**
 * Мобильная раскладка: шапка не сжимается и не перекрывает транспорт,
 * строка состояния умеет сжиматься многоточием, а лист ИИ не оставляет
 * под кнопкой «Применить» мёртвого места.
 *
 * Проверка живёт в исходниках (CSS/TSX), а не в скриншотах: она должна
 * ловить возврат дефекта в том же коммите, где его вносят.
 */

/** Убрать CSS-комментарии — правила читаем по коду, а не по прозе. */
const stripCssComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');

/** Блок CSS по селектору: от селектора до его закрывающей скобки. */
const cssBlock = (text, selector) => {
  const start = text.indexOf(selector);
  if (start === -1) return null;
  const end = text.indexOf('}', start);
  if (end === -1) return null;
  return text.slice(start, end);
};

/** Все медиа-блоки с указанным условием (скобки считаем вручную). */
const mediaBlocks = (text, condition) => {
  const marker = `@media (${condition})`;
  const blocks = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf(marker, from);
    if (start === -1) return blocks;
    let depth = 0;
    let end = -1;
    for (let i = start + marker.length; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) return blocks;
    blocks.push(text.slice(start, end));
    from = end + 1;
  }
};

/** Смещение z-слоя вида `calc(var(--z-sheet) + 14)`. */
const zOffset = (text, selector) => {
  const block = cssBlock(text, selector);
  if (block === null) return null;
  const match = /z-index:\s*calc\(var\(--z-sheet\)\s*\+\s*(\d+)\)/.exec(block);
  return match === null ? null : Number(match[1]);
};

/** Абсолютное значение z-токена (`--z-sheet: 40`). */
const zToken = (text, token) => {
  const match = new RegExp(`${token}:\\s*(\\d+)`).exec(text);
  return match === null ? null : Number(match[1]);
};

/** Глифы состояния — их рисует CSS, а не текст. */
const STATUS_GLYPHS = ['●', '▶', '⚠'];

const checkMobile = () => {
  const violations = [];
  const components = stripCssComments(read('ui/src/styles/components.css'));
  const zen = stripCssComments(read('ui/src/styles/zen.css'));
  const tokens = read('ui/src/styles/tokens.css');

  // ── шапка не сжимается ────────────────────────────────────────────────
  // Иначе при открытом листе .app-body переполняется, шапка сжимается, а
  // полоса транспорта остаётся на `top: var(--header-h)` — между ними
  // появляется зазор.
  const topbar = cssBlock(components, '.wc-topbar {');
  if (topbar === null) {
    violations.push('components.css: нет правила .wc-topbar');
  } else if (!/flex-shrink:\s*0/.test(topbar)) {
    violations.push('.wc-topbar: нет flex-shrink: 0 — шапка сожмётся и оторвётся от полосы транспорта');
  }

  // ── кнопки шапки не ужимаются ─────────────────────────────────────────
  const actions = cssBlock(components, '.wc-topbar__actions {');
  if (actions === null) {
    violations.push('components.css: нет правила .wc-topbar__actions');
  } else if (!/flex-shrink:\s*0/.test(actions)) {
    violations.push('.wc-topbar__actions: нет flex-shrink: 0 — кнопки шапки начнут сжиматься');
  }

  // ── слой шапки: выше транспорта, ниже модалки и тоста ─────────────────
  // Поповер меню «Ещё» открывается вниз в полосу транспорта; транспорт —
  // сосед шапки в дереве, поэтому перекрывал всё поддерево шапки.
  const topbarZ = zOffset(components, '.wc-topbar {');
  const transportZ = zOffset(components, '.app-transport-bar {');
  const sheetBase = zToken(tokens, '--z-sheet');
  const modalZ = zToken(tokens, '--z-modal');
  const toastZ = zToken(tokens, '--z-toast');
  if (topbarZ === null) {
    violations.push('.wc-topbar: нет z-index с calc(var(--z-sheet) + N)');
  } else if (transportZ === null) {
    violations.push('.app-transport-bar: нет z-index с calc(var(--z-sheet) + N)');
  } else if (topbarZ <= transportZ) {
    violations.push(
      `.wc-topbar (z-sheet+${topbarZ}) не выше транспорта (z-sheet+${transportZ}) — поповер шапки перекроет полоса транспорта`,
    );
  }
  if (topbarZ !== null && sheetBase !== null && modalZ !== null && toastZ !== null) {
    const absolute = sheetBase + topbarZ;
    if (absolute >= modalZ) violations.push(`.wc-topbar (${absolute}) не ниже модалки (${modalZ})`);
    if (absolute >= toastZ) violations.push(`.wc-topbar (${absolute}) не ниже тоста (${toastZ})`);
  }

  // ── строка состояния умеет сжиматься ───────────────────────────────────
  const status = cssBlock(zen, '.wc-status {');
  if (status === null) {
    violations.push('zen.css: нет правила .wc-status');
  } else if (!/overflow:\s*hidden/.test(status)) {
    violations.push('.wc-status: нет overflow: hidden — статус вылезет за свою полосу на кнопки');
  }

  const led = cssBlock(components, '.wc-led {');
  if (led === null) {
    violations.push('components.css: нет правила .wc-led');
  } else {
    if (!/min-width:\s*0/.test(led)) violations.push('.wc-led: нет min-width: 0 — слово состояния не сможет сжаться');
    if (!/overflow:\s*hidden/.test(led)) violations.push('.wc-led: нет overflow: hidden');
  }

  const ledLabel = cssBlock(components, '.wc-led__label {');
  if (ledLabel === null) {
    violations.push('components.css: нет правила .wc-led__label');
  } else {
    if (!/min-width:\s*0/.test(ledLabel)) violations.push('.wc-led__label: нет min-width: 0');
    if (!/overflow:\s*hidden/.test(ledLabel)) violations.push('.wc-led__label: нет overflow: hidden');
    if (!/text-overflow:\s*ellipsis/.test(ledLabel)) {
      violations.push('.wc-led__label: нет text-overflow: ellipsis — длинное состояние вылезет за бокс');
    }
  }

  const chip = cssBlock(zen, '.wc-status__chip {');
  if (chip === null) {
    violations.push('zen.css: нет правила .wc-status__chip');
  } else if (!/flex-shrink:\s*0/.test(chip)) {
    violations.push('.wc-status__chip: нет flex-shrink: 0 — плашки («офлайн», «12/143») начнут сжиматься');
  }

  // ── слово состояния без глифа ──────────────────────────────────────────
  // Точку рисует `.wc-led::before`; глиф в тексте давал две точки подряд.
  const labels = read('ui/src/presentation/state/labels.ts');
  const labelBlock = /AUDIO_STATUS_LABEL[\s\S]*?\};/.exec(labels);
  if (labelBlock === null) {
    violations.push('labels.ts: нет AUDIO_STATUS_LABEL');
  } else {
    for (const glyph of STATUS_GLYPHS) {
      if (labelBlock[0].includes(glyph)) {
        violations.push(`labels.ts: AUDIO_STATUS_LABEL содержит глиф "${glyph}" — точка рисуется CSS, а не текстом`);
      }
    }
  }

  // ── лист ИИ: кнопка во всю ширину, поле выше, мёртвого места нет ─────
  const narrow = mediaBlocks(components, 'max-width: 720px');
  if (narrow.length === 0) {
    violations.push('components.css: нет медиа-блока max-width: 720px');
  } else {
    const apply = narrow.some((block) => /\.ai-apply-btn\s*\{[^}]*flex:\s*1 0 100%/.test(block));
    if (!apply) {
      violations.push('@media (max-width: 720px): .ai-apply-btn не во всю ширину (flex: 1 0 100%)');
    }
    const applyMargin = narrow.some((block) => /\.ai-apply-btn\s*\{[^}]*margin-left:\s*0/.test(block));
    if (!applyMargin) {
      violations.push('@media (max-width: 720px): .ai-apply-btn не сброшен margin-left: 0');
    }
    const textarea = narrow.some((block) => /textarea\.ai-textarea\s*\{[^}]*min-height:\s*72px/.test(block));
    if (!textarea) {
      violations.push('@media (max-width: 720px): у textarea.ai-textarea нет min-height: 72px');
    }
    // Мёртвый резерв под таббар: лист — обычный flex-child, таббар его
    // не перекрывает, значит пустота под кнопкой ни к чему.
    const dead = narrow.find((block) => /\.ai-footer[^{]*\{[^}]*padding-bottom/.test(block));
    if (dead !== undefined) {
      violations.push('@media (max-width: 720px): у .ai-footer остался padding-bottom — под кнопкой зияет пустота');
    }
  }

  // ── оболочка не перекрывает слоевую таблицу стилей ─────────────────────
  // Un-layered inline имеет приоритет над @layer components: копия правил
  // шапки в index.html молча убивала мобильные правки.
  const shell = stripCssComments(read('ui/index.html'));
  for (const selector of ['.wc-topbar {', '.wc-topbar__title {', '.wc-topbar__actions {', '.wc-icon-btn {']) {
    if (shell.includes(selector)) {
      violations.push(`ui/index.html: неслойная копия "${selector.trim()}" перекрывает @layer components`);
    }
  }

  return violations;
};

// ── точка входа ─────────────────────────────────────────────────────────────

const MODES = {
  layering: checkLayering,
  console: checkConsole,
  camera: checkCamera,
  deploy: checkDeploy,
  secrets: checkSecrets,
  decisions: checkDecisions,
  spec: checkSpec,
  gate: checkGate,
  term: checkTerm,
  mobile: checkMobile,
};

const mode = process.argv[2];
if (mode === undefined || !(mode in MODES)) {
  process.stderr.write(`usage: node scripts/check-invariants.mjs <${Object.keys(MODES).join('|')}>\n`);
  process.exit(2);
}

const violations = MODES[mode]();
if (violations.length === 0) {
  process.stdout.write(`[${mode}] инвариант держится\n`);
  process.exit(0);
}
for (const violation of violations) {
  process.stdout.write(`[${mode}] ${violation}\n`);
}
process.stdout.write(`[${mode}] нарушений: ${violations.length}\n`);
process.exit(1);
