/**
 * Transient (percussion) → drum-pattern pipeline: pure helpers, no Web APIs.
 *
 * Pipeline:
 *   mic (getUserMedia)
 *     → AudioContext  (sampleRate negotiation)
 *     → MediaStreamSource → AnalyserNode
 *     → requestAnimationFrame poll
 *     → getFloatTimeDomainData + getByteFrequencyData
 *     → feedTransient(state, { timeDomain, freqDomain, sampleRate, ts })
 *     → Transient[] with type (kick / snare / hat / click) + timing
 *     → transientsToSnippet(transients) → Strudel `s("drums_bd*0.25").gain(0.5)`
 *
 * Co-exists with `micCapture.ts` (sustained-tone → MIDI notes). The two
 * pipelines read from the same AnalyserNode; the MicPanel's mode
 * selector picks one. In a future "auto" mode both run in parallel
 * and a per-frame classifier decides.
 *
 * Why pure
 * --------
 * Same as micCapture.ts — the segmentation logic is testable without
 * a DOM, so it lives in domain/ and the implementation in
 * infrastructure/audio/MicCapture.ts is just a thin RAF driver
 * calling these pure functions.
 *
 * Glossary:
 *   - TransientFrame = one AnalyserNode read (time + freq + sample rate + ts)
 *   - Transient      = one detected onset with classification + amplitude + ts
 *   - Tune           = thresholds (RMS-flux dB jump, refractory ms, etc.)
 */

export type OnsetType = 'kick' | 'snare' | 'hat' | 'click';

export type TransientFrame = {
  /** Time-domain samples in [-1, 1]. Float32Array from getFloatTimeDomainData. */
  readonly timeDomain: ArrayLike<number>;
  /** Frequency-domain magnitudes [0, 255]. Uint8Array from getByteFrequencyData. */
  readonly freqDomain: ArrayLike<number>;
  /** AudioContext.sampleRate at capture time. */
  readonly sampleRate: number;
  /** AudioContext.currentTime in ms (used for the snippet's time-stamps). */
  readonly timestampMs: number;
};

export type Transient = {
  readonly type: OnsetType;
  /** AudioContext.currentTime in ms when the onset fired. */
  readonly startMs: number;
  /** Peak RMS amplitude at the onset frame (0..1). */
  readonly amplitude: number;
  /** Spectral centroid (Hz) — used to derive the type. */
  readonly spectralCentroidHz: number;
};

export type TransientTune = {
  /** RMS jump (dB) required to count as an onset. Default 6 dB. */
  readonly rmsFluxDb: number;
  /** Refractory period after an onset (ms) — no new onsets in this window. */
  readonly minTransMs: number;
  /** Spectral centroid below this Hz → 'kick'. Default 200. */
  readonly centroidLowHz: number;
  /** Spectral centroid above this Hz → 'hat'. Default 2000. */
  readonly centroidHighHz: number;
  /** RMS dB floor — frames below this are noise/silence, not transients. */
  readonly silenceDb: number;
};

/**
 * Defaults tuned for general acoustic percussion. 6 dB flux is the
 * commonly-recommended threshold for onset detection (Bello et al.
 * 2005) — high enough to ignore background hum, low enough to fire on
 * a soft finger-snap. Spectral boundaries (200 / 2000 Hz) follow the
 * standard kick/snare/hat split.
 */
export const DEFAULT_TRANSIENT_TUNE: TransientTune = {
  rmsFluxDb: 6,
  minTransMs: 50,
  centroidLowHz: 200,
  centroidHighHz: 2000,
  silenceDb: -55,
};

export type TransientState = {
  readonly transients: ReadonlyArray<Transient>;
  readonly lastOnsetMs: number | null;
  /** Previous frame's RMS dB; needed to compute dB/dt across frames. */
  readonly prevRmsDb: number | null;
};

export const initialTransientState = (): TransientState => ({
  transients: [],
  lastOnsetMs: null,
  prevRmsDb: null,
});

/** Compute RMS of [-1, 1] samples. */
export const computeRms = (samples: ArrayLike<number>): number => {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i] ?? 0;
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
};

/** Linear amplitude → dBFS. Clamp at -200 dB for very small signals. */
export const rmsToDb = (rms: number): number => {
  if (rms < 1e-10) return -200;
  return 20 * Math.log10(rms);
};

/**
 * Spectral centroid: amplitude-weighted mean of frequency bins.
 * `freqs` is the byte-magnitude array from getByteFrequencyData.
 * Bin `i` corresponds to frequency `i * sampleRate / (2 * N)`.
 */
export const computeCentroidHz = (
  freqs: ArrayLike<number>,
  sampleRate: number,
): number => {
  if (freqs.length === 0 || sampleRate <= 0) return 0;
  const halfRate = sampleRate / 2;
  const numBins = freqs.length;
  let sumF = 0;
  let sumM = 0;
  for (let i = 0; i < numBins; i += 1) {
    const f = (i * halfRate) / numBins;
    const m = freqs[i] ?? 0;
    sumF += f * m;
    sumM += m;
  }
  return sumM > 0 ? sumF / sumM : 0;
};

/**
 * Map a spectral centroid to a Strudel sample slot. The mapping is
 * intentionally one-to-one to keep the snippet simple — we don't
 * distinguish "low tom" from "kick" because both would just be
 * `drums_bd` in the snippet anyway.
 */
export const classifyOnset = (centroidHz: number, tune: TransientTune): OnsetType => {
  if (centroidHz < tune.centroidLowHz) return 'kick';
  if (centroidHz > tune.centroidHighHz) return 'hat';
  const mid = (tune.centroidLowHz + tune.centroidHighHz) / 2;
  return centroidHz < mid ? 'snare' : 'click';
};

/**
 * Default mapping from onset type → Strudel sample slot. Wavecode's
 * SampleLoader pre-registers these on the superdough soundMap; see
 * SampleLoader.ts:loadDrumSamples.
 */
export const DEFAULT_INSTRUMENT_MAP: Readonly<Record<OnsetType, string>> = {
  kick: 'drums_bd',
  snare: 'drums_sd',
  hat: 'drums_hh',
  click: 'drums_cp',
};

/**
 * Append-style state transition. Returns a NEW TransientState.
 *
 *   1. Compute frame's RMS (dBFS) and spectral centroid (Hz).
 *   2. If frame is below silenceDb → no onset, just update prevRmsDb.
 *   3. Compute flux = rmsDb - prevRmsDb. If flux > rmsFluxDb AND
 *      we're outside the refractory window after the last onset →
 *      fire a new Transient of the classified type.
 *   4. Otherwise just update prevRmsDb.
 */
export const feedTransient = (
  state: TransientState,
  frame: TransientFrame,
  tune: TransientTune = DEFAULT_TRANSIENT_TUNE,
): TransientState => {
  const rms = computeRms(frame.timeDomain);
  const rmsDb = rmsToDb(rms);
  const centroidHz = computeCentroidHz(frame.freqDomain, frame.sampleRate);

  if (rmsDb < tune.silenceDb) {
    return { ...state, prevRmsDb: rmsDb };
  }

  const prevRmsDb = state.prevRmsDb;
  const fluxDb = prevRmsDb === null ? 0 : rmsDb - prevRmsDb;
  const lastOnsetMs = state.lastOnsetMs;
  const refractoryOk = lastOnsetMs === null
    || frame.timestampMs - lastOnsetMs > tune.minTransMs;
  const isOnset = fluxDb > tune.rmsFluxDb && refractoryOk;

  if (!isOnset) {
    return { ...state, prevRmsDb: rmsDb };
  }

  const type = classifyOnset(centroidHz, tune);
  const next: Transient = {
    type,
    startMs: frame.timestampMs,
    amplitude: rms,
    spectralCentroidHz: centroidHz,
  };
  return {
    transients: [...state.transients, next],
    lastOnsetMs: frame.timestampMs,
    prevRmsDb: rmsDb,
  };
};

/** Force-close semantics — no-op for transients. The transient
 *  pipeline has no "open" state; each frame either fires or doesn't. */
export const closeOpenTransient = (state: TransientState): TransientState => state;

/**
 * Convert a buffer of detected transients into a Strudel snippet.
 *
 * Output structure (one `s(...)` per distinct onset type, stacked):
 *
 *   transientsToSnippet([
 *     { type: 'kick',  startMs: 0,    ... },
 *     { type: 'snare', startMs: 250,  ... },
 *     { type: 'kick',  startMs: 500,  ... },
 *     { type: 'snare', startMs: 750,  ... },
 *   ])
 *   → 'stack(\n  s("drums_bd ~ drums_bd ~"),\n  s("~ drums_sd ~ drums_sd")\n)'
 *
 * Pattern construction:
 *   - Normalize times to a single cycle starting at the first transient
 *     + a 200ms tail (covers natural decay of the last hit).
 *   - Quantize the cycle into 16 steps (configurable).
 *   - For each type, build a 16-step pattern with the right samples
 *     at the quantized positions and '~' elsewhere.
 *   - Wrap each in `s("…")`, join with `stack(…)`.
 *
 * If there's only one type, skip the `stack` wrap and emit the bare
 * `s("…")` — looks cleaner in the editor.
 *
 * Empty buffer → null.
 */
export const transientsToSnippet = (
  transients: ReadonlyArray<Transient>,
  instrumentMap: Readonly<Record<OnsetType, string>> = DEFAULT_INSTRUMENT_MAP,
  opts: { readonly steps?: number; readonly tailMs?: number } = {},
): string | null => {
  if (transients.length === 0) return null;
  const STEPS = opts.steps ?? 16;
  const TAIL = opts.tailMs ?? 200;
  const firstMs = transients[0]!.startMs;
  const lastMs = transients[transients.length - 1]!.startMs;
  const cycleMs = Math.max(STEPS, (lastMs - firstMs) + TAIL);

  // Bucket by type, computing each transient's quantized step index.
  const byType = new Map<OnsetType, number[]>();
  for (const t of transients) {
    const stepIdx = Math.min(STEPS - 1, Math.max(0,
      Math.round(((t.startMs - firstMs) / cycleMs) * (STEPS - 1)),
    ));
    const arr = byType.get(t.type) ?? [];
    arr.push(stepIdx);
    byType.set(t.type, arr);
  }

  const layers: string[] = [];
  for (const [type, steps] of byType) {
    const slot = instrumentMap[type];
    const pattern: string[] = new Array(STEPS).fill('~');
    for (const step of steps) pattern[step] = slot;
    layers.push(`s("${pattern.join(' ')}")`);
  }
  if (layers.length === 0) return null;
  if (layers.length === 1) return layers[0]!;
  return `stack(\n  ${layers.join(',\n  ')}\n)`;
};
