import {
  micDetectionActive,
  micMeterFrame,
  micPeakTimes,
  type MicDetectionKind,
  type MicPeakMark,
  micListening,
  micPreviewNotes,
  micTransients,
  micCurrentHz,
  micCurrentRms,
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
  micError,
  setMicEditorApi,
  setMicEditorFocused,
  micSlotLabel,
  micSlotGlyph,
  type MicSlot,
} from './micStore';
import type { MeterFrame } from '~/infrastructure/audio/MicCapture';

/**
 * micStoreAdapter — UI-facing boundary for mic state.
 *
 * Why this file exists
 * --------------------
 * Post-WS-A merge (commit d3d3891 on `feat/ux-domain`), micStore has
 * the new derived signals `micDetectionActive()`, `micMeterFrame`,
 * `micPeakTimes` and the supporting types. This adapter re-exports
 * them so MicPanel, MicMeter, PianoRollPreview, and the test files
 * have a single import surface. The legacy fallback (deriving
 * `micDetectionActive` locally from `micPreviewNotes` + `micTransients`)
 * has been deleted — the real source is in micStore now.
 *
 * If micStore is ever missing a signal in a future refactor, restore
 * the local derivation as a fallback rather than breaking the UI.
 *
 * 4 layers reminder: presentation/state/ is presentation-layer state.
 * It re-shapes domain signals; it does not own Web Audio. The
 * adapter lives here precisely because it is presentation
 * (component contract), not domain (still pure TS).
 */

export {
  micDetectionActive,
  micMeterFrame,
  micPeakTimes,
  micPreviewNotes,
  micTransients,
  micListening,
  micError,
  micSlot,
  micInstrument,
};

export type {
  MicDetectionKind,
  MicPeakMark,
  MeterFrame,
  MicSlot,
};

export {
  setMicSlot,
  startMic,
  stopMic,
  freezePreview,
  clearPreview,
  applyToScore,
  previewPillPayload,
  setMicInstrument,
  setMicEditorApi,
  setMicEditorFocused,
  micSlotLabel,
  micSlotGlyph,
  // Internal signals exposed for low-level UI consumers (e.g. live meter
  // tick animation). The MicPanel doesn't read these directly — the
  // adapter wrappers above are the supported contract.
  micCurrentHz,
  micCurrentRms,
};
