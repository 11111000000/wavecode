#!/usr/bin/env node
/**
 * sync-mediapipe-assets — publish the MediaPipe runtime + model to
 * `ui/public/` so the app serves both from its own origin.
 *
 * Two assets are needed at runtime:
 *
 *   1. the wasm runtime (`vision_wasm_internal.js|.wasm` and
 *      `vision_wasm_module_internal.js|.wasm`) — it ships inside
 *      `node_modules/@mediapipe/tasks-vision/wasm` and is COPIED here
 *      on every run, because it is a build artefact of the installed
 *      package version (copying keeps the wasm in lockstep with the
 *      JS glue that loads it);
 *   2. the `hand_landmarker.task` model — a ~7.8 MB binary that is
 *      NOT in npm. It is committed to the repository at
 *      `ui/public/models/hand_landmarker.task` so a cold checkout
 *      works without a second download.
 *
 * Only the wasm folder is generated; the model is source-controlled.
 *
 * Usage:
 *   node scripts/sync-mediapipe-assets.mjs [--root REPO_ROOT]
 *
 * Exit codes:
 *   0 — wasm published (model present)
 *   1 — model missing or wasm sources missing
 *   2 — bad invocation / unreadable inputs
 */

import { cpSync, existsSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root = the parent of the `scripts/` directory holding this file. */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');

const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};

const ROOT = resolve(argValue('--root') ?? DEFAULT_ROOT);

const UI_DIR = join(ROOT, 'ui');
const WASM_SRC = join(
  UI_DIR,
  'node_modules',
  '@mediapipe',
  'tasks-vision',
  'wasm',
);
const WASM_DEST = join(UI_DIR, 'public', 'mediapipe', 'wasm');
const MODEL_PATH = join(UI_DIR, 'public', 'models', 'hand_landmarker.task');

/**
 * Reference size of `hand_landmarker.task` (float16, `latest`).
 * A mismatch means a truncated download — worth a warning, not worth
 * a hard failure (the model is updated upstream from time to time).
 */
const REFERENCE_MODEL_BYTES = 7819105;

const MODEL_DOWNLOAD_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/'
  + 'hand_landmarker/float16/latest/hand_landmarker.task';

const fail = (message) => {
  process.stderr.write(`sync-mediapipe-assets: ${message}\n`);
  process.exit(1);
};

// 1. The model must be there — a missing model is a setup error, not
//    something this script can fix.
if (!existsSync(MODEL_PATH)) {
  process.stderr.write(
    'sync-mediapipe-assets: the hand landmarker model is missing.\n'
    + `  expected: ${relative(ROOT, MODEL_PATH)}\n`
    + '  fetch it with:\n'
    + `    curl -fsSL "${MODEL_DOWNLOAD_URL}" \\\n`
    + `      -o ${relative(ROOT, MODEL_PATH)}\n`
    + `  (expected size: ${REFERENCE_MODEL_BYTES} bytes)\n`,
  );
  process.exit(1);
}

const modelBytes = statSync(MODEL_PATH).size;
if (modelBytes !== REFERENCE_MODEL_BYTES) {
  process.stderr.write(
    `sync-mediapipe-assets: WARNING — model size is ${modelBytes} bytes, `
    + `reference is ${REFERENCE_MODEL_BYTES} bytes. The download may be truncated.\n`,
  );
}

// 2. The wasm runtime comes from the installed package.
if (!existsSync(WASM_SRC)) {
  process.stderr.write(
    'sync-mediapipe-assets: the MediaPipe wasm sources are missing.\n'
    + `  expected: ${relative(ROOT, WASM_SRC)}\n`
    + '  install the dependency first:\n'
    + '    npm install @mediapipe/tasks-vision@1.2.3\n',
  );
  process.exit(1);
}

// Replace the destination wholesale so a version bump never leaves a
// stale wasm file behind.
rmSync(WASM_DEST, { recursive: true, force: true });
cpSync(WASM_SRC, WASM_DEST, { recursive: true });

process.stdout.write(
  `sync-mediapipe-assets: wasm -> ${relative(ROOT, WASM_DEST)}\n`
  + `sync-mediapipe-assets: model -> ${relative(ROOT, MODEL_PATH)} `
  + `(${modelBytes} bytes)\n`,
);
