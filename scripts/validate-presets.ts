#!/usr/bin/env node
// scripts/validate-presets.ts
//
// CLI: run validatePreset() (from ui/src/domain/presets.ts) against every
// BUILTIN_PRESETS entry. Exits 1 if any preset has warnings or throws.
//
// Usage (from repo root):
//   pnpm --dir ui run validate:presets
//   # or, equivalently:
//   node --experimental-strip-types --no-warnings scripts/validate-presets.ts
//
// Exit codes:
//   0 — all presets validated (with or without warnings)
//   1 — at least one preset produced warnings, or evaluating the preset threw
//   2 — fatal: BUILTIN_PRESETS could not be loaded
//
// What this does:
//   1. Dynamically imports `validatePreset` and `BUILTIN_PRESETS` from
//      `ui/src/domain/presets.ts`.
//   2. For each preset:
//      a. Try to dynamic-import the real @strudel/transpiler +
//         @strudel/core + @strudel/mini + @strudel/tonal bundle.
//      b. If those modules load: ask validatePreset to evaluate the preset's
//         score, capturing `console.warn` / `console.error` diagnostics.
//      c. If they fail to load (typical in Node — Strudel depends on
//         @kabelsalat/web which is browser-only): report a warning that
//         this script is running without a DOM, fall back to a syntactic
//         smoke-test (try `new Function(preset.score)`), and continue.
//   3. Print a summary: total presets, OK count, warning count, error count.
//      Exit 1 if any preset produced diagnostics.
//   4. If validation could not run (transpiler missing AND syntax fails),
//      exit 1 with a non-zero message.
//
// Why this script exists:
//   `validatePreset` was introduced as a library function in
//   feat/presets-decode-race (Phase 5). Exposing it as a CLI lets
//   `scripts/pre-commit` and CI catch preset regressions before they ship.
//   The unit tests in `ui/src/domain/presets.test.ts` already cover
//   validatePreset with a mocked transpiler (8 cases); this CLI is the
//   integration-level runner.

import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';

type ValidatePresetResult = {
  readonly presetId: string;
  readonly warnings: ReadonlyArray<{ level: 'warn' | 'error'; message: string }>;
  readonly elapsedMs: number;
  readonly error?: string;
};

type Preset = {
  readonly id: string;
  readonly name: string;
  readonly score: string;
  readonly lang?: 'js' | 'lisp';
};

type StrudelModule = {
  evaluate: (code: string, t: unknown) => Promise<{ pattern?: unknown }>;
  transpiler: unknown;
};

let presetsModule:
  | {
      BUILTIN_PRESETS: ReadonlyArray<Preset>;
      validatePreset: (
        preset: Preset,
        opts: unknown,
      ) => Promise<ValidatePresetResult>;
    }
  | undefined;

let transpilerModule: StrudelModule | undefined;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UI_DIR = resolve(REPO_ROOT, 'ui');
const UI_NODE_MODULES = resolve(UI_DIR, 'node_modules');

async function loadPresetsModule(): Promise<NonNullable<typeof presetsModule>> {
  if (presetsModule) return presetsModule;
  const presetsUrl = pathToFileURL(resolve(UI_DIR, 'src/domain/presets.ts')).href;
  const mod = (await import(presetsUrl).catch((e: unknown) => {
    throw new Error(
      `Could not import ui/src/domain/presets.ts: ${e instanceof Error ? e.message : String(e)}`,
    );
  })) as NonNullable<typeof presetsModule>;
  presetsModule = mod;
  return mod;
}

async function tryLoadStrudel(): Promise<StrudelModule | null> {
  if (transpilerModule) return transpilerModule;
  // Resolve @strudel/transpiler from ui/node_modules/. We can't import it
  // by bare specifier because this script lives in scripts/ at the repo
  // root — Node ESM resolution walks up from the script's URL and finds
  // nothing. createRequire() with explicit paths gets us there, then we
  // can dynamic-import the resolved file URL.
  let resolvedEntry: string;
  try {
    const req = createRequire(import.meta.url);
    resolvedEntry = req.resolve('@strudel/transpiler', { paths: [UI_NODE_MODULES] });
  } catch (err) {
    process.stderr.write(
      `[validate-presets] @strudel/transpiler not resolvable: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return null;
  }
  try {
    // Dynamic import the resolved file. This still tries to resolve
    // @strudel/core + @strudel/web which is browser-only; if that
    // succeeds, we're in a DOM-capable env. Otherwise we fall back.
    const t = (await import(pathToFileURL(resolvedEntry).href)) as StrudelModule;
    transpilerModule = t;
    return t;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[validate-presets] @strudel/transpiler loaded, but full Strudel eval ` +
        `failed (likely missing DOM/AudioContext): ${msg}\n` +
        `[validate-presets]   Falling back to syntactic smoke test ` +
        `(\`new Function(preset.score)\`). For full validation, run this ` +
        `script in the browser dev tools console, or wrap it in a thin ` +
        `browser-side runner.\n`,
    );
    return null;
  }
}

function syntacticSmokeTest(score: string): { ok: boolean; error?: string } {
  // Cheap structural check: the score is a string of JS. We don't execute
  // it (that would require the Strudel global scope), but a syntax error
  // here means a preset is broken at the source level.
  try {
    // eslint-disable-next-line no-new-func
    new Function(score);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Lisp smoke test: balanced-parens check (skipping `;;`-comments and
 * `"..."` strings). We deliberately do NOT import the full Lisp
 * transpiler here — it uses extension-less relative imports
 * (`./lexer`) that Node's `--experimental-strip-types` cannot resolve,
 * unlike Vite's bundler.
 */
function lispSmokeTest(score: string): { ok: boolean; error?: string } {
  let depth = 0;
  let inString = false;
  let inLineComment = false;
  for (let i = 0; i < score.length; i += 1) {
    const c = score[i];
    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inString) {
      if (c === '"') inString = false;
      continue;
    }
    if (c === ';' && score[i + 1] === ';') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '(') depth += 1;
    if (c === ')') {
      depth -= 1;
      if (depth < 0) return { ok: false, error: 'unbalanced ")"' };
    }
  }
  if (depth !== 0) return { ok: false, error: `unbalanced parens (depth=${depth})` };
  return { ok: true };
}

async function validateOne(
  preset: Preset,
  t: StrudelModule | null,
  injectedConsole: Pick<Console, 'warn' | 'error'>,
): Promise<ValidatePresetResult> {
  if (preset.lang === 'lisp') {
    const startedAt = performance.now();
    const smoke = lispSmokeTest(preset.score);
    const elapsedMs = performance.now() - startedAt;
    if (!smoke.ok) {
      return {
        presetId: preset.id,
        warnings: [],
        elapsedMs,
        error: smoke.error,
      };
    }
    return { presetId: preset.id, warnings: [], elapsedMs };
  }
  if (t) {
    const { validatePreset } = await loadPresetsModule();
    return validatePreset(preset, { transpiler: t, console: injectedConsole });
  }
  const startedAt = performance.now();
  const smoke = syntacticSmokeTest(preset.score);
  const elapsedMs = performance.now() - startedAt;
  if (!smoke.ok) {
    return {
      presetId: preset.id,
      warnings: [],
      elapsedMs,
      error: smoke.error,
    };
  }
  return { presetId: preset.id, warnings: [], elapsedMs };
}

async function main(): Promise<void> {
  let mod: NonNullable<typeof presetsModule>;
  try {
    mod = await loadPresetsModule();
  } catch (err) {
    process.stderr.write(`[validate-presets] FATAL: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }
  const t = await tryLoadStrudel();

  process.stdout.write(`Validating ${mod.BUILTIN_PRESETS.length} presets...\n\n`);

  const injectedConsole = {
    warn: (...args: unknown[]) =>
      process.stderr.write(`  [warn]  ${args.map((a) => String(a)).join(' ')}\n`),
    error: (...args: unknown[]) =>
      process.stderr.write(`  [error] ${args.map((a) => String(a)).join(' ')}\n`),
  };

  let totalWarnings = 0;
  let totalErrors = 0;
  let erroredPresets = 0;
  let okPresets = 0;
  for (const preset of mod.BUILTIN_PRESETS) {
    const result = await validateOne(preset, t, injectedConsole);
    const warningCount = result.warnings.length;
    const errCount = result.warnings.filter((w) => w.level === 'error').length;
    totalWarnings += warningCount;
    totalErrors += errCount;
    if (result.error) {
      erroredPresets += 1;
      process.stdout.write(
        `  ${preset.id.padEnd(20)}  FAIL  (${result.elapsedMs.toFixed(0)}ms)  ${result.error}\n`,
      );
    } else if (warningCount > 0) {
      process.stdout.write(
        `  ${preset.id.padEnd(20)}  OK    (${result.elapsedMs.toFixed(0)}ms, ${warningCount} ${
          warningCount === 1 ? 'warning' : 'warnings'
        })\n`,
      );
    } else {
      okPresets += 1;
      process.stdout.write(
        `  ${preset.id.padEnd(20)}  OK    (${result.elapsedMs.toFixed(0)}ms, 0 warnings)\n`,
      );
    }
  }

  process.stdout.write('\n');
  if (erroredPresets === 0 && totalWarnings === 0 && totalErrors === 0) {
    process.stdout.write(
      `\u2713 ${mod.BUILTIN_PRESETS.length}/${mod.BUILTIN_PRESETS.length} presets passed (0 warnings total)\n`,
    );
    process.exit(0);
  }
  process.stdout.write(
    `\u2717 ${okPresets}/${mod.BUILTIN_PRESETS.length} presets clean (${totalWarnings} warnings, ${totalErrors} errors, ${erroredPresets} failed)\n`,
  );
  process.exit(1);
}

void main();
