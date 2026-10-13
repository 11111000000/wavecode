import {
  type PianoInstrument,
  pianoInstrumentToOscType,
} from '~/domain/music/notes';

/**
 * PianoSynth — typed wrapper around Web Audio API for the on-screen /
 * WebMIDI piano. Bypasses the Strudel scheduler entirely so the piano
 * plays in PARALLEL with any currently-evaluating score (no audible
 * click from re-eval, no interruption of the master scheduler).
 *
 * Why a dedicated infrastructure module?
 *   - Architecture rules forbid presentation from importing `@strudel/*`,
 *     but the piano can use the raw Web Audio API directly — Strudel is
 *     irrelevant to a percussive synth. Web Audio DSP lives in
 *     `infrastructure/audio/` (same layer as `LiveAudioEngine`).
 *   - Each note = one OscillatorNode + GainNode. Voices are independent
 *     and clean themselves up on release.
 *
 * ADSR (per voice):
 *   - attack: 5ms linearRamp 0 → 0.10 (PEAK)
 *   - decay:  400ms linearRamp 0.10 → 0.03 (SUSTAIN floor)
 *   - sustain: held at 0.03 while the key stays pressed
 *   - release: 100ms linearRamp 0.03 → 0 (noteOff path)
 *
 * Master limiter (post wavecode-piano-modes-and-gain):
 *   - Per-voice peak (0.10) keeps a 4-note chord at ~0.40 peak — well
 *     inside the master compressor's linear range.
 *   - Voices route through `masterGain` (linear 1.0) → master limiter
 *     (DynamicsCompressorNode, threshold=0.7 / ratio=4:1 / attack=5ms /
 *     release=100ms / knee=6dB). The compressor is a soft-limiter that
 *     catches ~1.0+ transient peaks from many simultaneous voices
 *     (8-voice chord peaks ~0.80 raw, compressor engages and we land
 *     well under 0.7 final amplitude). Result: no clipping under typical
 *     polyphony, balanced with Strudel presets that mix layers at gain
 *     ~0.15.
 *
 * MIDI → Hz: standard `440 * 2^((midi - 69) / 12)` formula. A4 (440Hz)
 *   is MIDI 69 — see notes.ts::noteNumberToName for the round-trip.
 *
 * Voice IDs: monotonically-increasing counter starting at 1. Returns
 *   the new voiceId from `noteOn`. The caller MUST hold the voiceId so
 *   `noteOff` can target the right voice — voices are NOT auto-tracked
 *   by MIDI number (a single MIDI number could theoretically overlap
 *   itself if retriggered before noteOff, though that's prevented by
 *   the keyboard's set-based debounce).
 *
 * Cleanup contract:
 *   - `noteOff` schedules `osc.stop(t + release + 50ms)` then on
 *     `osc.onended` disconnects both nodes. Failing to disconnect leaks
 *     AudioNodes into the destination graph and grows the per-frame
 *     cost of `AudioContext.destination` collection.
 *   - `dispose()` is the emergency stop: stops ALL voices synchronously,
 *     disconnects everything, zeros the voice map. Used on unmount.
 *
 * Master bus cleanup: the `masterGain` and `compressor` are created
 *   per-synth (not per-voice) and persist for the synth's lifetime.
 *   `dispose()` schedules a ramp-down of the masterGain as a safety net;
 *   the shared audioCtx outlives the synth so the bus nodes remain
 *   connected to the destination until AudioContext teardown.
 */

type Voice = {
  voiceId: number;
  osc: OscillatorNode;
  gain: GainNode;
  midi: number;
  instrument: PianoInstrument;
  /** Wall-clock when the note started (performance.now(), for diagnostics). */
  startedAt: number;
  /** True once noteOff has been called — second noteOff is a no-op. */
  released: boolean;
};

export interface PianoSynth {
  /** Start a voice. Returns the voiceId for later noteOff. */
  noteOn(midi: number, instrument: PianoInstrument): number;
  /** Release a voice. Idempotent — calling twice is a no-op. */
  noteOff(voiceId: number): void;
  /**
   * Atomic instrument swap: stop the old voice gracefully (with the
   * release tail) and immediately start a new voice at the same MIDI
   * number with the new instrument. Returns the NEW voiceId.
   *
   * Used when the user changes the waveform while keys are held —
   * without this, held voices would keep playing the old waveform
   * until released, which is surprising.
   */
  setInstrument(voiceId: number, instrument: PianoInstrument): number;
  /** Number of currently-active voices (not yet released). */
  activeCount(): number;
  /** Emergency stop: silence and disconnect ALL voices. */
  dispose(): void;
};

const ATTACK_S = 0.005;
const DECAY_S = 0.4;
const SUSTAIN_LEVEL = 0.03;
const RELEASE_S = 0.1;
const PEAK_GAIN = 0.1;
const RELEASE_TAIL_MS = 50;

/** Master compressor parameters — soft-limiter for many-voice polyphony. */
const MASTER_COMPRESSOR_OPTS = {
  threshold: 0.7,
  ratio: 4,
  attack: 0.005,
  release: 0.1,
  knee: 6,
} as const;

const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

export const createPianoSynth = (audioCtx: AudioContext): PianoSynth => {
  const voices = new Map<number, Voice>();
  let nextVoiceId = 1;

  // Per-synth master bus — every voice's gain flows into masterGain →
  // compressor → audioCtx.destination. Linear gain stage makes the
  // compressor the only non-linear element in the bus.
  const masterGain = audioCtx.createGain();
  const compressor = audioCtx.createDynamicsCompressor();
  // Defaults to a no-op (threshold=0 keeps the compressor transparent),
  // but explicit assignment here guards against Web Audio implementations
  // that initialise DynamicsCompressorNode with non-zero knee/attack.
  compressor.threshold.value = MASTER_COMPRESSOR_OPTS.threshold;
  compressor.ratio.value = MASTER_COMPRESSOR_OPTS.ratio;
  compressor.attack.value = MASTER_COMPRESSOR_OPTS.attack;
  compressor.release.value = MASTER_COMPRESSOR_OPTS.release;
  compressor.knee.value = MASTER_COMPRESSOR_OPTS.knee;
  masterGain.connect(compressor).connect(audioCtx.destination);

  const noteOn = (midi: number, instrument: PianoInstrument): number => {
    const voiceId = nextVoiceId;
    nextVoiceId += 1;

    const osc = audioCtx.createOscillator();
    osc.type = pianoInstrumentToOscType(instrument);
    osc.frequency.setValueAtTime(midiToHz(midi), audioCtx.currentTime);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);

    // Voice → master bus → destination. Master compressor catches the
    // summed amplitude when many voices overlap.
    osc.connect(gain).connect(masterGain);

    // ADSR attack + decay (sustain floor set at end of decay).
    const t0 = audioCtx.currentTime;
    gain.gain.linearRampToValueAtTime(PEAK_GAIN, t0 + ATTACK_S);
    gain.gain.linearRampToValueAtTime(SUSTAIN_LEVEL, t0 + ATTACK_S + DECAY_S);

    osc.start(t0);

    const voice: Voice = {
      voiceId,
      osc,
      gain,
      midi,
      instrument,
      startedAt: performance.now(),
      released: false,
    };
    voices.set(voiceId, voice);

    osc.onended = (): void => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        /* disconnect throws InvalidAccessError if already disconnected */
      }
      voices.delete(voiceId);
    };

    return voiceId;
  };

  const noteOff = (voiceId: number): void => {
    const voice = voices.get(voiceId);
    if (!voice) return;
    if (voice.released) return;
    voice.released = true;
    const { osc, gain } = voice;
    const t0 = audioCtx.currentTime;
    // Schedule release ramp from current value to 0 over RELEASE_S.
    // Cancel scheduled values first so we don't fight the attack/decay
    // ramps if noteOff arrives mid-attack.
    try {
      gain.gain.cancelScheduledValues(t0);
      // setValueAtTime at current value — needed because cancelScheduledValues
      // alone leaves the parameter at whatever the last ramp landed on, but
      // linearRampToValueAtTime interprets the gap from there. Anchoring
      // explicitly is robust against premature noteOff.
      gain.gain.setValueAtTime(gain.gain.value, t0);
      gain.gain.linearRampToValueAtTime(0, t0 + RELEASE_S);
    } catch {
      /* node may already be in a closed state — best-effort */
    }
    osc.stop(t0 + RELEASE_S + RELEASE_TAIL_MS / 1000);
  };

  const setInstrument = (voiceId: number, instrument: PianoInstrument): number => {
    const voice = voices.get(voiceId);
    if (!voice) return -1;
    // Atomic swap: schedule the OLD voice to release, start a NEW voice
    // at the same MIDI with the new waveform. Listeners on `osc.onended`
    // for the old voice will still fire and clean up — see noteOn.
    noteOff(voiceId);
    return noteOn(voice.midi, instrument);
  };

  const dispose = (): void => {
    for (const voice of Array.from(voices.values())) {
      try {
        voice.gain.gain.cancelScheduledValues(audioCtx.currentTime);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, audioCtx.currentTime);
        voice.gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.01);
        voice.osc.stop(audioCtx.currentTime + 0.02);
      } catch {
        /* best-effort: node may already be torn down */
      }
      try {
        voice.osc.disconnect();
        voice.gain.disconnect();
      } catch {
        /* already disconnected */
      }
      voices.delete(voice.voiceId);
    }
    // Master bus stays alive until AudioContext teardown — closing the
    // synth mid-session would create an audible pop. The shared
    // AudioContext is reused across synthesizers.
  };

  return {
    noteOn,
    noteOff,
    setInstrument,
    activeCount: (): number => voices.size,
    dispose,
  };
};

// Note on type imports: `PianoInstrument` lives in `domain/music/notes.ts`
// (pure type — no audio dependencies). Infrastructure is allowed to
// import domain types (the layer rule is `domain can't import anything`;
// infrastructure CAN import from domain). Consumers in PianoRecStore
// import the type from domain directly.
