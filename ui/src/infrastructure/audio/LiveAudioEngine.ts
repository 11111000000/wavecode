import { Effect, Layer, type Context } from 'effect';
import { AudioEngine } from '~/domain/services';

/**
 * Live AudioEngine — прямой синтез через наш собственный парсер score.
 *
 * НЕ используем coreMod.evaluate() потому что он требует transpiler (kabelsalat/web),
 * который вызывает eval/require для браузерного bundle — и падает.
 *
 * Парсим score через regex для n("X") или note("X") patterns:
 *   - "n(\"43\").s(\"triangle\").gain(0.4).lpf(800)" → MIDI 43 (G2), triangle, 0.4 gain, LPF 800Hz
 *   - "note(\"c4\").s(\"sine\").gain(0.5)" → MIDI 60 (C4), sine, 0.5 gain
 *
 * Каждый нота получает OscillatorNode + GainNode + BiquadFilter + ADSR.
 */

type AudioEngineConfig = Record<string, never>;

type ParsedHap = {
  notes: number[];
  sound: OscillatorType;
  gain: number;
  lpf: number;
  duration: number;
};

const MIDI_FREQ = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);
const WAVEFORMS: ReadonlyArray<OscillatorType> = ['sine', 'square', 'sawtooth', 'triangle'];

const parseNoteNames = (s: string): number[] => {
  const result: number[] = [];
  // Match patterns like:
  //   "43" → 43
  //   "43 44 45" → 43, 44, 45
  //   "[43,44,45]" → 43, 44, 45
  //   "c4" → 60
  //   "c#4" → 61
  const tokens = s
    .replace(/[\[\]]/g, '')
    .split(/[,\s]+/)
    .filter((t) => t.length > 0);
  for (const tok of tokens) {
    const midi = parseMidiToken(tok);
    if (midi !== null) result.push(midi);
  }
  return result;
};

const NOTE_NAMES: Record<string, number> = {
  'c': 0, 'c#': 1, 'db': 1, 'd': 2, 'd#': 3, 'eb': 3, 'e': 4, 'f': 5,
  'f#': 6, 'gb': 6, 'g': 7, 'g#': 8, 'ab': 8, 'a': 9, 'a#': 10, 'bb': 10, 'b': 11,
};

const parseMidiToken = (tok: string): number | null => {
  // Try direct MIDI number: "43", "60"
  const asNum = parseInt(tok, 10);
  if (!isNaN(asNum) && String(asNum) === tok) {
    return asNum;
  }
  // Try note name: "c4", "eb5", "f#3"
  const noteMatch = tok.match(/^([a-gA-G][#bB]?)(-?\d+)$/);
  if (noteMatch) {
    const note = noteMatch[1]?.toLowerCase();
    const octave = parseInt(noteMatch[2] ?? '4', 10);
    const base = note ? NOTE_NAMES[note] : undefined;
    if (base !== undefined) {
      // C4 = 60, octave 4 → 60
      return 12 * (octave + 1) + base;
    }
  }
  return null;
};

const parseScore = (score: string): ParsedHap[] => {
  const haps: ParsedHap[] = [];

  // Match: n("notes") or note("notes") with optional .s(), .gain(), .lpf(), .slow()
  // Each match is one pattern that produces a Hap
  // We allow newlines, multiple patterns on one line

  // First, find all top-level expressions: either n(...).chain or note(...).chain
  // Pattern: (?:n|note)\s*\(\s*"([^"]+)"\s*\)(?:\.([a-z]+)\(([^)]*)\))*

  const re = /(?:n|note)\s*\(\s*"([^"]+)"\s*\)(?:\s*\.\s*([a-z]+)\s*\(\s*([^)]*?)\s*\))*/g;
  let m: RegExpExecArray | null;
  let slowMul = 1; // accumulate .slow() multipliers
  while ((m = re.exec(score)) !== null) {
    const notesStr = m[1] ?? '';
    const notes = parseNoteNames(notesStr);
    if (notes.length === 0) continue;

    let sound: OscillatorType = 'sine';
    let gain = 0.4;
    let lpf = 20000;
    let duration = 0.5 * slowMul; // default duration scaled by .slow()

    for (let i = 2; i < m.length; i += 3) {
      const method = m[i];
      const arg = m[i + 1];
      if (!method || !arg) continue;
      if (method === 's') {
        const w = arg as OscillatorType;
        if (WAVEFORMS.includes(w)) sound = w;
      } else if (method === 'gain') {
        const g = parseFloat(arg);
        if (!isNaN(g)) gain = g;
      } else if (method === 'lpf') {
        const l = parseInt(arg, 10);
        if (!isNaN(l)) lpf = l;
      } else if (method === 'slow') {
        const s = parseFloat(arg);
        if (!isNaN(s) && s > 0) {
          slowMul *= s;
          duration *= s;
        }
      }
    }

    haps.push({ notes, sound, gain, lpf, duration });
  }

  return haps;
};

const make = (_config: AudioEngineConfig): Context.Tag.Service<typeof AudioEngine> => {
  let ac: AudioContext | null = null;
  const activeNodes: Set<{ osc: OscillatorNode; gain: GainNode }> = new Set();
  const intervalIds: Set<number> = new Set();

  const getAC = (): AudioContext => {
    if (!ac) {
      const Ctor =
        typeof window !== 'undefined'
          ? window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
          : null;
      if (!Ctor) throw new Error('AudioContext not available');
      ac = new Ctor();
    }
    return ac;
  };

  const stopAll = (): void => {
    activeNodes.forEach((entry) => {
      try {
        entry.osc.stop();
        entry.gain.disconnect();
        entry.osc.disconnect();
      } catch {
        /* ignore */
      }
    });
    activeNodes.clear();
  };

  const playHap = (hap: ParsedHap, startOffset: number): void => {
    const audio = getAC();
    const start = audio.currentTime + startOffset;
    const noteGain = hap.gain / hap.notes.length;

    hap.notes.forEach((midi, idx) => {
      const freq = MIDI_FREQ(midi);
      const noteStart = start + idx * 0.005;
      const noteEnd = noteStart + hap.duration;

      const osc = audio.createOscillator();
      osc.type = hap.sound;
      osc.frequency.value = freq;

      const lpf = audio.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.value = hap.lpf;
      lpf.Q.value = 1;

      const gain = audio.createGain();
      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(noteGain, noteStart + 0.01);
      gain.gain.setValueAtTime(
        noteGain,
        Math.max(noteEnd - 0.1, noteStart + 0.01),
      );
      gain.gain.linearRampToValueAtTime(0, noteEnd);

      osc.connect(lpf).connect(gain).connect(audio.destination);
      osc.start(noteStart);
      osc.stop(noteEnd);

      const entry = { osc, gain };
      activeNodes.add(entry);
      osc.onended = () => {
        activeNodes.delete(entry);
        try {
          lpf.disconnect();
          osc.disconnect();
          gain.disconnect();
        } catch {
          /* ignore */
        }
      };
    });
  };

  const evalImpl = async (snippet: string): Promise<void> => {
    const audio = getAC();
    if (audio.state === 'suspended') {
      try {
        await audio.resume();
      } catch {
        /* ignore */
      }
    }

    // НЕ вызываем stopAll() — пусть старые ноты доиграют свои ADSR
    // envelope. Новые ноты из нового score будут играть ПАРАЛЛЕЛЬНО →
    // crossfade через envelope. Через одну итерацию loop старые
    // oscillator'ы затихнут (естественно), новые заиграют.
    // Чтобы избежать "эхо" — остановим старые через 1 цикл.

    // Stop the previous loop first.
    intervalIds.forEach((id) => window.clearInterval(id));
    intervalIds.clear();

    const haps = parseScore(snippet);
    if (haps.length === 0) {
      throw new Error('No haps parsed from score');
    }

    // Compute total cycle length (sum of all hap durations + gaps)
    const gap = 0.05;
    const cycleLength = haps.reduce((acc, h) => acc + h.duration + gap, 0);

    // Repeatedly play the score in a loop using setInterval.
    // Each tick advances by cycleLength, recreating all OscillatorNodes.
    const loop = (): void => {
      // At loop boundary, stop previous cycle's old oscillators
      // (they'll have already faded by now due to release envelope).
      // Don't stopAll() — we want new notes to overlap with old fading.
      let offset = 0;
      for (const hap of haps) {
        playHap(hap, offset);
        offset += hap.duration + gap;
      }
    };

    // Play first iteration immediately, then loop every cycleLength
    loop();
    const intervalId = window.setInterval(loop, cycleLength * 1000);
    intervalIds.add(intervalId);
  };

  const stopImpl = (): void => {
    intervalIds.forEach((id) => window.clearInterval(id));
    intervalIds.clear();
    stopAll();
  };

  return {
    eval: (snippet: string) =>
      Effect.promise(() => evalImpl(snippet)).pipe(
        Effect.mapError((e: unknown) => (e instanceof Error ? e : new Error(String(e)))),
      ),
    stop: () => Effect.sync(() => stopImpl()),
  };
};

export const LiveAudioEngine: Layer.Layer<AudioEngine, never, never> = Layer.succeed(
  AudioEngine,
  make({}) as never,
);

/**
 * Eagerly bootstrap Strudel globals. Idempotent — safe to call multiple times.
 */
export const ensureAudioLoaded = (): Promise<void> =>
  import('@strudel/core')
    .then(() => undefined)
    .catch(() => undefined);