import {
  micListening,
  micPreviewNotes,
  micTransients,
  micCurrentHz,
  micCurrentRms,
} from './micStore';

/**
 * micStoreAdapter — UI-facing boundary for mic state.
 *
 * Why this file exists
 * --------------------
 * The parallel domain work (WS-A, branch `feat/ux-domain`) drops the
 * `micMode` signal entirely and replaces it with three derived signals:
 * `micDetectionActive()` (callable getter), `micMeterFrame` (signal of
 * per-frame audio metrics), and `micPeakTimes` (signal of recent
 * onset marks). That branch is still open at the time of writing;
 * when it lands, the implementations below flip from "derive locally
 * from existing signals" to "re-export from micStore". The contract
 * this file exposes is stable across both states, so MicPanel and
 * MicMeter don't have to change when the merge happens.
 *
 * Why an adapter (not direct imports)
 * -----------------------------------
 * The Mic feature is the only consumer that needs to know about the
 * shape change. Funnelling all reads through this one file means:
 *
 *   1. Today, before the WS-A merge: the adapter provides best-effort
 *      compatibility shims derived from the *existing* signals
 *      (`micListening`, `micPreviewNotes`, `micTransients`, `micCurrentHz`,
 *      `micCurrentRms`). Typecheck passes even though `micMode` is
 *      about to disappear, because we never re-export it from here.
 *
 *   2. After the WS-A merge: the local definitions are deleted and
 *      replaced with `export { ... } from '../state/micStore'`. The
 *      exported types stay identical so the UI doesn't notice.
 *
 * 4 layers reminder: presentation/state/ is presentation-layer state.
 * It re-shapes domain signals; it does not own Web Audio. The
 * adapter lives here precisely because it is presentation
 * (component contract), not domain (still pure TS).
 */

/** The kind of audio the detector is currently producing.
 *
 *  - `idle`        — not listening, no preview buffer
 *  - `sustained`   — only `micPreviewNotes` has content (voice/whistle)
 *  - `percussive`  — only `micTransients` has content (drum/clap)
 *  - `both`        — both buffers have content (auto-mode / pitched kick)
 *
 *  Today we derive this from the buffer state. After WS-A, the store
 *  owns the derivation; the adapter just re-exports its signal. */
export type MicDetectionKind = 'idle' | 'sustained' | 'percussive' | 'both';

/** One RMS+Hz sample. WS-A emits one per RAF tick from inside
 *  MicCapture. Today, the adapter emits one on demand from the
 *  existing `micCurrentRms` / `micCurrentHz` signals, sampled by
 *  Solid's reactivity so the consumer still gets a fresh value
 *  per render. */
export type MeterFrame = {
  readonly rms: number;
  readonly peak: number;
  readonly hz: number | null;
  readonly timestampMs: number;
};

/** An onset marker — used by MicMeter to draw a spike on the meter
 *  bar. `type: 'note'` is for sustain note onsets (post WS-A), `type:
 *  'transient'` for drum/clap onsets. Pre-merge, only 'transient'
 *  appears because we don't track note onsets yet. */
export type MicPeakMark = {
  readonly ms: number;
  readonly type: 'note' | 'transient';
};

// ── derived "new" symbols (until WS-A merges) ────────────────────────

/** Sliding window for `micPeakTimes`. Mirrors `PEAK_HISTORY_WINDOW_MS`
 *  in WS-A's spec. */
const PEAK_WINDOW_MS = 3000;

/** Return the active detection kind. Pure read of two buffer
 *  signals — no state. */
export const micDetectionActive = (): MicDetectionKind => {
  const sustained = micPreviewNotes().length > 0;
  const percussive = micTransients().length > 0;
  if (sustained && percussive) return 'both';
  if (sustained) return 'sustained';
  if (percussive) return 'percussive';
  return 'idle';
};

/** Latest RMS/HZ sample, or `null` if the mic isn't listening.
 *
 *  `peak` is best-effort today: we don't track peak separately so we
 *  emit `rms`. WS-A's MicCapture will report peak from the
 *  AnalyserNode's `getByteTimeDomainData` max; identical contract. */
export const micMeterFrame = (): MeterFrame | null => {
  if (!micListening()) return null;
  const rms = micCurrentRms();
  const hz = micCurrentHz();
  return {
    rms,
    peak: rms,
    hz,
    timestampMs: typeof performance !== 'undefined' ? performance.now() : 0,
  };
};

/** Recent onset marks inside the last `PEAK_WINDOW_MS` ms.
 *
 *  Pre-WS-A: derived from `micTransients()` (each transient carries
 *  `startMs` and a type). Note onsets aren't tracked yet so they
 *  don't appear here. The UI renders what it gets.
 *
 *  Post-WS-A: re-exported from micStore directly; both pipelines
 *  contribute. */
export const micPeakTimes = (): ReadonlyArray<MicPeakMark> => {
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  const cutoff = now - PEAK_WINDOW_MS;
  return micTransients()
    .filter((t) => t.startMs >= cutoff)
    .map<MicPeakMark>((t) => ({ ms: t.startMs, type: 'transient' }));
};

// ── re-exports (unchanged by WS-A) ──────────────────────────────────

export {
  micPreviewNotes,
  micTransients,
  micSlot,
  setMicSlot,
  startMic,
  stopMic,
  freezePreview,
  clearPreview,
  applyToScore,
  previewPillPayload,
  setMicInstrument,
  micInstrument,
  micListening,
  micError,
  micEditorApi,
  setMicEditorApi,
  micEditorFocused,
  setMicEditorFocused,
  micSlotLabel,
  micSlotGlyph,
} from './micStore';

/** Re-export the slot id type for the UI. `MicSlot` lives in micStore
 *  and survives the WS-A merge (the slot mechanic is orthogonal to
 *  the mode-vs-detection change). */
export type { MicSlot } from './micStore';