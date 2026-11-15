#!/usr/bin/env node
/**
 * check-zen-ui — guard for the wavecode "minimal / zen" UI direction.
 *
 * The point of this script is not to enforce a look. It is to make the
 * cheapest-to-lose properties of the interface measurable, so a redesign
 * can be judged by numbers instead of by taste:
 *
 *   1. every `var(--token)` used in the UI resolves to a defined token
 *      (no dangling references -> no silently dropped visual property),
 *   2. hardcoded colors do not multiply outside the token file,
 *   3. focus visibility is not allowed to regress against hover styling,
 *   4. the inventory of surfaces stays under the recorded baseline.
 *
 * Usage:
 *   node scripts/check-zen-ui.mjs [--root REPO_ROOT] [--json] [--no-baseline]
 *   node scripts/check-zen-ui.mjs --targets        # zen v1 gate
 *   node scripts/check-zen-ui.mjs --write-baseline # re-record the floor
 *
 * Exit codes:
 *   0 — no regression against the recorded baseline (and, with --targets,
 *       the zen v1 targets are met)
 *   1 — regression detected (or dangling token reference, or a missed
 *       zen v1 target)
 *   2 — bad invocation / unreadable inputs
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(argValue('--root') ?? process.cwd());
const BASELINE_PATH = join(ROOT, 'scripts', 'zen-ui-baseline.json');
const USE_BASELINE = !process.argv.includes('--no-baseline');
const AS_JSON = process.argv.includes('--json');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

const STYLES_DIR = join(ROOT, 'ui', 'src', 'styles');
const INDEX_CSS = join(ROOT, 'ui', 'src', 'index.css');
const UI_SRC = join(ROOT, 'ui', 'src');
const TOKENS_FILE = join(ROOT, 'ui', 'src', 'styles', 'tokens.css');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function read(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** Line number (1-based) of the nth occurrence of `needle` in `text`. */
function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

// Every stylesheet the app actually loads lives under ui/src — including
// page-local ones (ui/src/presentation/pages/admin.css) that are imported
// from a component rather than from ui/src/index.css. Scanning only
// ui/src/styles would miss a dangling var() there.
const cssFiles = existsSync(UI_SRC) ? walk(UI_SRC).filter((f) => f.endsWith('.css')).sort() : [];

if (cssFiles.length === 0) {
  console.error('check-zen-ui: no stylesheet found under ui/src');
  process.exit(2);
}

const cssTexts = new Map(cssFiles.map((f) => [f, read(f)]));
const sourceFiles = walk(UI_SRC).filter((f) => /\.(ts|tsx|html)$/.test(f));
const sourceTexts = new Map(sourceFiles.map((f) => [f, read(f)]));

// ---------------------------------------------------------------- tokens
const defined = new Map(); // token -> { file, line }
for (const [file, text] of cssTexts) {
  const re = /(--[a-zA-Z0-9-]+)\s*:/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!defined.has(m[1])) defined.set(m[1], { file, line: lineOf(text, m.index) });
  }
}

const dangling = []; // { token, file, line }
const usageRe = /var\(\s*(--[a-zA-Z0-9-]+)/g;
// CSS custom properties set at runtime (style={{'--x': …}} / setProperty('--x'))
// are defined by the code, not by a stylesheet — they must not be reported
// as dangling references.
const runtimeDefined = new Set();
const runtimeRe = /(--[a-zA-Z0-9-]+)/g;
for (const [file, text] of sourceTexts) {
  const re = new RegExp(runtimeRe.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 4), m.index);
    if (!before.endsWith('var(')) runtimeDefined.add(m[1]);
  }
}

for (const [file, text] of [...cssTexts, ...sourceTexts]) {
  const re = new RegExp(usageRe.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const token = m[1];
    if (!defined.has(token) && !runtimeDefined.has(token)) {
      dangling.push({ token, file: relative(ROOT, file), line: lineOf(text, m.index) });
    }
  }
}

// ------------------------------------------------------- hardcoded color
const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
const hardcoded = [];
for (const [file, text] of cssTexts) {
  if (file === TOKENS_FILE) continue;
  const re = new RegExp(hexRe.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    hardcoded.push({ value: m[0], file: relative(ROOT, file), line: lineOf(text, m.index) });
  }
}

// ------------------------------------------------------ focus vs hover
function countSelectors(text, needle) {
  const re = new RegExp(`:${needle}\\b`, 'g');
  return (text.match(re) ?? []).length;
}
let hoverCount = 0;
let focusVisibleCount = 0;
let outlineNoneCount = 0;
let infiniteAnimations = 0;
let keyframes = 0;
for (const text of cssTexts.values()) {
  hoverCount += countSelectors(text, 'hover');
  focusVisibleCount += countSelectors(text, 'focus-visible');
  outlineNoneCount += (text.match(/outline\s*:\s*none/g) ?? []).length;
  infiniteAnimations += (text.match(/animation[^;]*\binfinite\b/g) ?? []).length;
  keyframes += (text.match(/@keyframes/g) ?? []).length;
}

// ------------------------------------------------------------- surfaces
// Surface classes are the real navigation cost: every sheet, drawer,
// modal, FAB and panel is a place the eye has to learn.
const classNames = new Set();
for (const text of cssTexts.values()) {
  for (const m of text.matchAll(/^\.([a-zA-Z0-9_-]+)/gm)) classNames.add(m[1]);
}
const surfaceClasses = [...classNames].filter((c) => /(sheet|drawer|modal|fab|dock|panel|overlay)/.test(c));
const countBy = (re) => surfaceClasses.filter((c) => re.test(c)).length;

const metrics = {
  tokensDefined: defined.size,
  tokensUsed: new Set(
    [...cssTexts.values(), ...sourceTexts.values()]
      .flatMap((text) => [...text.matchAll(new RegExp(usageRe.source, 'g'))].map((m) => m[1]))
  ).size,
  danglingRefs: dangling.length,
  hardcodedColors: hardcoded.length,
  hoverSelectors: hoverCount,
  focusVisibleSelectors: focusVisibleCount,
  outlineNone: outlineNoneCount,
  infiniteAnimations,
  keyframes,
  surfaceClasses: surfaceClasses.length,
  sheetClasses: countBy(/sheet/),
  drawerClasses: countBy(/drawer/),
  modalClasses: countBy(/modal/),
  fabClasses: countBy(/fab/),
  panelClasses: countBy(/panel/),
  cssFiles: cssFiles.length,
  cssLines: [...cssTexts.values()].reduce(
    (n, t) => n + t.split('\n').length - (t.endsWith('\n') ? 1 : 0),
    0
  ),
};

// ----------------------------------------------------------- baseline
// Metrics that must never grow: each one of them is a way for the
// interface to become noisier, less accessible or less predictable.
const MAX_METRICS = [
  'danglingRefs',
  'hardcodedColors',
  'outlineNone',
  'infiniteAnimations',
  'surfaceClasses',
  'sheetClasses',
  'drawerClasses',
  'modalClasses',
  'fabClasses',
  'panelClasses',
  'cssLines',
];
// Metrics that must never shrink.
const MIN_METRICS = ['focusVisibleSelectors'];

const regressions = [];
let baseline = null;
if (USE_BASELINE && existsSync(BASELINE_PATH)) {
  baseline = JSON.parse(read(BASELINE_PATH));
  for (const key of MAX_METRICS) {
    const limit = baseline.metrics?.[key];
    if (typeof limit === 'number' && metrics[key] > limit) {
      regressions.push(`${key}: ${metrics[key]} > baseline ${limit}`);
    }
  }
  for (const key of MIN_METRICS) {
    const limit = baseline.metrics?.[key];
    if (typeof limit === 'number' && metrics[key] < limit) {
      regressions.push(`${key}: ${metrics[key]} < baseline ${limit}`);
    }
  }
} else if (USE_BASELINE && !process.argv.includes('--write-baseline')) {
  console.error(`check-zen-ui: baseline not found at ${relative(ROOT, BASELINE_PATH)}`);
  process.exit(2);
}

const report = {
  root: ROOT,
  metrics,
  dangling,
  hardcodedTop: hardcoded.slice(0, 10),
  regressions,
  baselinePath: baseline ? relative(ROOT, BASELINE_PATH) : null,
};

const STRICT = process.argv.includes('--strict');
const WRITE_BASELINE = process.argv.includes('--write-baseline');
const TARGETS = process.argv.includes('--targets');

// ------------------------------------------------------------- targets
// Phase 1 of the zen redesign ("Zen v1") reached three concrete goals.
// `--targets` turns them into a gate: it is the check that says the
// foundation is clean, independently of what the baseline floor is.
//
//   danglingRefs     == 0   every var(--token) resolves (no silently
//                            dropped visual property)
//   hardcodedColors  == 0   no colour literals outside tokens.css
//   infiniteAnimations <= 1 the one loop left is the functional
//                            loading spinner
const targetViolations = [];
if (TARGETS) {
  if (metrics.danglingRefs > 0) {
    targetViolations.push(`danglingRefs: ${metrics.danglingRefs} (target 0)`);
  }
  if (metrics.hardcodedColors > 0) {
    targetViolations.push(`hardcodedColors: ${metrics.hardcodedColors} (target 0)`);
  }
  if (metrics.infiniteAnimations > 1) {
    targetViolations.push(`infiniteAnimations: ${metrics.infiniteAnimations} (target <= 1)`);
  }
}

if (WRITE_BASELINE) {
  const payload = {
    recordedAt: new Date().toISOString(),
    note: 'Baseline of the minimal/zen UI guard. Metrics listed as MAX must not grow; MIN must not shrink.',
    metrics,
    dangling,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`check-zen-ui: baseline written to ${relative(ROOT, BASELINE_PATH)}`);
  process.exit(0);
}

if (AS_JSON) {
  console.log(JSON.stringify({ ...report, targetViolations }, null, 2));
} else {
  console.log('check-zen-ui — минимальный zen-интерфейс: метрики');
  console.log('---------------------------------------------------');
  for (const [k, v] of Object.entries(metrics)) console.log(`  ${k.padEnd(24)} ${v}`);
  if (dangling.length) {
    console.log('\nНеопределённые токены (визуальное свойство молча теряется):');
    for (const d of dangling) console.log(`  ${d.file}:${d.line}  var(${d.token})`);
  } else {
    console.log('\nНеопределённых токенов нет.');
  }
  if (targetViolations.length) {
    console.log('\nЦЕЛИ ZEN v1 НЕ ДОСТИГНУТЫ:');
    for (const t of targetViolations) console.log(`  ${t}`);
  } else if (TARGETS) {
    console.log('\nЦели zen v1 достигнуты: danglingRefs=0, hardcodedColors=0, infiniteAnimations<=1.');
  }
  if (regressions.length) {
    console.log('\nРЕГРЕССИИ против базовой линии:');
    for (const r of regressions) console.log(`  ${r}`);
  } else if (baseline) {
    console.log('\nРегрессий против базовой линии нет.');
  }
}

const failed =
  regressions.length > 0 || (STRICT && dangling.length > 0) || targetViolations.length > 0;
process.exit(failed ? 1 : 0);
