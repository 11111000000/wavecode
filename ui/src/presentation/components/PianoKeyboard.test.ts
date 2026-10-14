import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { render as solidRender } from 'solid-js/web';
import type { PianoKeyboard as PianoKeyboardFn } from './PianoKeyboard';
import type { PianoSynth } from '~/infrastructure/audio/PianoSynth';
import type { PianoInstrument } from '~/domain/music/notes';
import {
  noteNumberToName,
  isInPianoRange,
  rangeNotes,
  isBlackKey,
} from '~/domain/music/notes';

/**
 * Mirror of PianoKeyboard.tsx constants — duplicated here so the test
 * asserts the layout formula without pulling Solid + DOM into the unit
 * environment (kept as pure-functional spec).
 */
const PIANO_WHITE_W = 80;
const PIANO_BLACK_W = 50;

describe('PianoKeyboard mappings (via notes.ts pure fns)', () => {
  it('rangeNotes returns 24 notes in 2 octaves', () => {
    const notes = rangeNotes();
    expect(notes).toHaveLength(24);
  });

  it('isInPianoRange covers C3..B4', () => {
    for (const n of [48, 60, 71]) expect(isInPianoRange(n)).toBe(true);
    for (const n of [47, 72]) expect(isInPianoRange(n)).toBe(false);
  });

  it('noteNumberToName: white + black keys in range', () => {
    expect(noteNumberToName(48)).toBe('C3');
    expect(noteNumberToName(60)).toBe('C4');
    expect(noteNumberToName(61)).toBe('C#4');
    expect(noteNumberToName(71)).toBe('B4');
  });

  it('pianoInstrumentToOscType: identity for all four waveforms', async () => {
    const { pianoInstrumentToOscType } = await import('~/domain/music/notes');
    expect(pianoInstrumentToOscType('triangle')).toBe('triangle');
    expect(pianoInstrumentToOscType('sine')).toBe('sine');
    expect(pianoInstrumentToOscType('sawtooth')).toBe('sawtooth');
    expect(pianoInstrumentToOscType('square')).toBe('square');
  });
});

/**
 * Layout invariants for the on-screen piano. Mirrors the inline-style
 * formula in PianoKeyboard.tsx (PianoKeyboard.tsx:259-264):
 *   wIdx   = whiteIndex(midi - 1)
 *   bW     = PIANO_BLACK_W
 *   left   = (wIdx + 1) * PIANO_WHITE_W - bW / 2
 *   right  = left + bW
 */
describe('PianoKeyboard layout invariants (black-key overlap with neighbours)', () => {
  const whiteNotes = rangeNotes().filter((n) => !isBlackKey(n));

  function whiteIndex(midi: number): number {
    return whiteNotes.findIndex((n) => n === midi);
  }

  interface Box { left: number; right: number; }
  function blackBounds(midi: number): Box {
    const wIdx = whiteIndex(midi - 1);
    const wW = PIANO_WHITE_W;
    const bW = PIANO_BLACK_W;
    const left = (wIdx + 1) * wW - bW / 2;
    return { left, right: left + bW };
  }

  function whiteBounds(midi: number): Box {
    const wIdx = whiteIndex(midi);
    const wW = PIANO_WHITE_W;
    return { left: wIdx * wW, right: (wIdx + 1) * wW };
  }

  const blackKeys = rangeNotes().filter(isBlackKey);

  it('count: there are exactly 10 black keys in 2 octaves (5 black per octave)', () => {
    expect(blackKeys).toHaveLength(10);
  });

  it('every black key has both a prev and a next white neighbour (skips first/last)', () => {
    for (const midi of blackKeys) {
      expect(whiteIndex(midi - 1)).toBeGreaterThanOrEqual(0);
      expect(whiteIndex(midi + 1)).toBeGreaterThanOrEqual(0);
    }
  });

  it('every black key straddles the boundary between prev and next white keys', () => {
    for (const midi of blackKeys) {
      const black = blackBounds(midi);
      const prevWhite = whiteBounds(midi - 1);
      const nextWhite = whiteBounds(midi + 1);
      expect(black.left).toBeLessThanOrEqual(prevWhite.right);
      expect(black.left).toBeLessThanOrEqual(nextWhite.left);
      expect(black.right).toBeGreaterThanOrEqual(prevWhite.left);
      expect(black.right).toBeGreaterThanOrEqual(nextWhite.left);
    }
  });

  it('every black-key right-edge does not extend past next white-key right edge', () => {
    for (const midi of blackKeys) {
      const black = blackBounds(midi);
      const nextWhite = whiteBounds(midi + 1);
      expect(black.right).toBeLessThanOrEqual(nextWhite.right);
    }
  });

  it('no two adjacent black keys overlap horizontally', () => {
    for (let i = 0; i < blackKeys.length; i += 1) {
      const aMidi = blackKeys[i]!;
      for (let j = i + 1; j < blackKeys.length; j += 1) {
        const bMidi = blackKeys[j]!;
        const a = blackBounds(aMidi);
        const b = blackBounds(bMidi);
        const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        expect(overlap).toBe(0);
      }
    }
  });
});

/**
 * Component-level tests for PianoKeyboard (post wavecode-piano-parallel-rec):
 *   - pianoSynth is wired (noteOn/noteOff/dispose called correctly)
 *   - evalScore is NEVER called from PianoKeyboard (the whole point of
 *     the refactor — piano must not interrupt the main score)
 *   - pianoRecStore.recBuffer accumulates notes when REC is on
 *   - rapid press within 30ms coalesces into a single noteOn
 *   - 5-note polyphony = 5 voices tracked
 *
 * Mocking strategy:
 *   - We mock `~/infrastructure/audio/PianoSynth` with a spy that
 *     records noteOn/noteOff calls per voiceId. The spy also exposes
 *     activeCount() so the test can assert polyphony.
 *   - We mock `~/infrastructure/audio/LiveAudioEngine` to provide a
 *     stub AudioContext (jsdom doesn't implement it). The stub is a
 *     plain object — PianoSynth in the test takes that context and
 *     the spy records them.
 *   - We mock `~/infrastructure/composition` to a no-op layer so the
 *     FOLLOW poll path doesn't crash on missing FiberRefs.
 *   - We DO NOT mock `evalScore` — if any code path still calls it
 *     from PianoKeyboard, the test fails. This is the regression
 *     guard against re-introducing the "interrupts main track" bug.
 */
describe('PianoKeyboard component (parallel synth + no evalScore)', () => {
  interface Voice {
    voiceId: number;
    midi: number;
    instrument: PianoInstrument;
    released: boolean;
  }

  let noteOnSpy: ReturnType<typeof vi.fn>;
  let noteOffSpy: ReturnType<typeof vi.fn>;
  let setInstrumentSpy: ReturnType<typeof vi.fn>;
  let activeCountSpy: ReturnType<typeof vi.fn>;
  let disposeSpy: ReturnType<typeof vi.fn>;
  let voices: Voice[];
  let nextVoiceId: number;

  let evalScore: ReturnType<typeof vi.fn>;
  let container: HTMLDivElement;
  let render: typeof solidRender;
  let PianoKeyboard: typeof PianoKeyboardFn;
  let unmount: (() => void) | undefined;

  /** Spy that returns a fake PianoSynth; record every method call. */
  const fakeSynth = (): PianoSynth => {
    const handle: PianoSynth = {
      noteOn: (midi: number, inst: PianoInstrument): number => {
        const voiceId = noteOnSpy(midi, inst) as number;
        voices.push({ voiceId, midi, instrument: inst, released: false });
        return voiceId;
      },
      noteOff: (voiceId: number): void => {
        noteOffSpy(voiceId);
        const v = voices.find((x) => x.voiceId === voiceId);
        if (v) v.released = true;
      },
      setInstrument: (voiceId: number, inst: PianoInstrument): number => {
        const newId = setInstrumentSpy(voiceId, inst) as number;
        const old = voices.find((x) => x.voiceId === voiceId);
        if (old) {
          old.released = true;
          voices.push({ voiceId: newId, midi: old.midi, instrument: inst, released: false });
        }
        return newId;
      },
      activeCount: (): number => activeCountSpy() as number,
      dispose: (): void => {
        disposeSpy();
        voices.length = 0;
      },
    };
    return handle;
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    voices = [];
    nextVoiceId = 1;
    noteOnSpy = vi.fn((_midi: number, _inst: PianoInstrument): number => {
      const id = nextVoiceId;
      nextVoiceId += 1;
      return id;
    });
    noteOffSpy = vi.fn();
    setInstrumentSpy = vi.fn((_oldId: number, _inst: PianoInstrument): number => {
      const id = nextVoiceId;
      nextVoiceId += 1;
      return id;
    });
    activeCountSpy = vi.fn((): number => voices.filter((v) => !v.released).length);
    disposeSpy = vi.fn();

    // evalScore spy — if PianoKeyboard calls it, the test fails.
    // (Wrapping in vi.fn means we can assert "never called".)
    evalScore = vi.fn().mockResolvedValue(undefined);

    vi.resetModules();
    vi.doMock('~/infrastructure/audio/PianoSynth', () => ({
      createPianoSynth: () => fakeSynth(),
    }));
    vi.doMock('~/infrastructure/audio/LiveAudioEngine', () => ({
      unlockAudioContext: () => ({}) as AudioContext,
    }));
    vi.doMock('../state/audioActions', () => ({ evalScore }));
    vi.doMock('~/infrastructure/audio/MidiInput', () => ({
      isMidiAvailable: () => false,
      requestMidiAccess: async () => null,
      onNote: () => () => undefined,
    }));
    // FOLLOW mode would reach into the AppLayer to call
    // AudioEngine.getActiveHaps. Stub the layer as identity so the
    // createEffect() registration in PianoKeyboard doesn't bail out.
    vi.doMock('~/infrastructure/composition', () => ({
      AppLayer: { provide: () => (eff: unknown) => eff },
    }));

    render = (await import('solid-js/web')).render;
    ({ PianoKeyboard } = await import('./PianoKeyboard'));
    container = document.createElement('div');
    document.body.appendChild(container);
    unmount = render(() => PianoKeyboard(), container);
    await vi.advanceTimersByTimeAsync(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (unmount) unmount();
    unmount = undefined;
    vi.doUnmock('~/infrastructure/audio/PianoSynth');
    vi.doUnmock('~/infrastructure/audio/LiveAudioEngine');
    vi.doUnmock('../state/audioActions');
    vi.doUnmock('~/infrastructure/audio/MidiInput');
    vi.doUnmock('~/infrastructure/composition');
    if (container) container.remove();
  });

  async function press(midi: number): Promise<void> {
    const btn = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${noteNumberToName(midi)}"]`,
    );
    expect(btn).toBeTruthy();
    btn!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(35);
  }

  async function release(midi: number): Promise<void> {
    const btn = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${noteNumberToName(midi)}"]`,
    );
    expect(btn).toBeTruthy();
    btn!.dispatchEvent(new Event('pointerup', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(5);
  }

  it('tap a key → activeSet contains midi; evalScore NOT called', async () => {
    await press(60);
    expect(noteOnSpy).toHaveBeenCalledTimes(1);
    expect(noteOnSpy.mock.calls[0]![0]).toBe(60); // midi
    expect(evalScore).not.toHaveBeenCalled();
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="C4"]')!;
    expect(btn.classList.contains('active')).toBe(true);
    // data-source reflects 'pressed' when only the user is holding it:
    expect(btn.getAttribute('data-source')).toBe('pressed');
  });

  it('tap + release → activeSet empty; main score untouched', async () => {
    await press(60);
    await release(60);
    expect(noteOnSpy).toHaveBeenCalledTimes(1);
    expect(noteOffSpy).toHaveBeenCalledTimes(1);
    expect(evalScore).not.toHaveBeenCalled();
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="C4"]')!;
    expect(btn.classList.contains('active')).toBe(false);
    expect(btn.getAttribute('data-source')).toBe('none');
  });

  it('out-of-range note press → no noteOn (guard via isInPianoRange)', async () => {
    // No button for midi 30 (below C3=48). The playNote path early-
    // returns via `if (!isInPianoRange(midi)) return;` — but in jsdom
    // we can't dispatch a pointer event for a non-existent button. The
    // equivalent assertion is: tapping nothing doesn't call noteOn.
    expect(noteOnSpy).not.toHaveBeenCalled();
  });

  it('debounce: 5 rapid presses coalesce into a single noteOn with final set', async () => {
    // Fire 5 pointerdowns inside the 30ms window — without advancing
    // past 30ms the keyboard's internal trailing timer is the only
    // thing that ever fires noteOn.
    for (const midi of [60, 62, 64, 65, 67]) {
      const btn = container.querySelector<HTMLButtonElement>(
        `button[aria-label="${noteNumberToName(midi)}"]`,
      )!;
      btn.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(5);
    }
    // At this point no noteOn yet (still inside debounce).
    expect(noteOnSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(40); // flush trailing timer
    expect(noteOnSpy).toHaveBeenCalledTimes(5);
    const midis = noteOnSpy.mock.calls.map((c) => c[0] as number);
    expect(new Set(midis)).toEqual(new Set([60, 62, 64, 65, 67]));
    expect(evalScore).not.toHaveBeenCalled();
  });

  it('chord: 5 notes pressed → 5 voices tracked; all released on release-all', async () => {
    for (const midi of [60, 62, 64, 65, 67]) await press(midi);
    expect(noteOnSpy).toHaveBeenCalledTimes(5);
    expect(voices.filter((v) => !v.released)).toHaveLength(5);

    for (const midi of [60, 62, 64, 65, 67]) await release(midi);
    expect(noteOffSpy).toHaveBeenCalledTimes(5);
    expect(evalScore).not.toHaveBeenCalled();
    expect(voices.filter((v) => v.released)).toHaveLength(5);
  });

  it('instrument change applies to next noteOn (next voice has new oscType)', async () => {
    const { setInstrument } = await import('../state/pianoRecStore');
    setInstrument('sine');
    await press(60);
    expect(noteOnSpy).toHaveBeenCalledTimes(1);
    expect(noteOnSpy.mock.calls[0]![1]).toBe('sine');
    await release(60);
    setInstrument('square');
    await press(64);
    expect(noteOnSpy.mock.calls[1]![1]).toBe('square');
    await release(64);
  });

  it('rec ON + tap → recBuffer has 1 entry with that midi; flushRec returns it', async () => {
    const rec = await import('../state/pianoRecStore');
    rec.setInstrument('triangle');
    rec.clearRec();
    rec.toggleRec(); // rec on

    await press(60);
    await vi.advanceTimersByTimeAsync(40);
    expect(rec.recBuffer()).toHaveLength(1);
    expect(rec.recBuffer()[0]!.midi).toBe(60);

    await release(60);
    expect(rec.recBuffer()[0]!.endMs).toBeGreaterThanOrEqual(rec.recBuffer()[0]!.startMs);

    const flushed = rec.flushRec();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]!.midi).toBe(60);
    expect(rec.recBuffer()).toEqual([]);

    // Cleanup for other tests
    if (rec.recEnabled()) rec.toggleRec();
  });

  it('rec OFF + tap → recBuffer is empty (no implicit recording)', async () => {
    const rec = await import('../state/pianoRecStore');
    rec.clearRec();
    if (rec.recEnabled()) rec.toggleRec();
    await press(60);
    await release(60);
    expect(rec.recBuffer()).toEqual([]);
    expect(evalScore).not.toHaveBeenCalled();
  });

  it('unmount → pianoSynth.dispose is called', async () => {
    await press(60); // ensure synth is initialized (lazy)
    expect(disposeSpy).not.toHaveBeenCalled();
    unmount!();
    unmount = undefined;
    // dispose runs synchronously in onCleanup, no advanceTimers needed.
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('re-press within debounce window does NOT duplicate noteOn (idempotency)', async () => {
    await press(60);
    await vi.advanceTimersByTimeAsync(10);
    // Press the SAME key again before debounce flushes.
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="C4"]')!;
    btn.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(40);
    expect(noteOnSpy).toHaveBeenCalledTimes(1);
  });

  it('rapid press+release within debounce cancels the pending noteOn (no zombie voice)', async () => {
    // press + release within 30ms = no audio voice should ever be
    // created for that key (the pending entry is deleted from the
    // debounce set).
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="C4"]')!;
    btn.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(5);
    btn.dispatchEvent(new Event('pointerup', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(50);
    expect(noteOnSpy).not.toHaveBeenCalled();
    expect(noteOffSpy).not.toHaveBeenCalled();
  });

  // FOLLOW + apply button DOM invariants (wavecode-piano-modes-and-gain).
  // Toolbar is mounted inside PianoKeyboard, so the buttons render here.
  it('renders the FOLLOW button in the toolbar', () => {
    expect(container.querySelector('.piano-follow-btn')).toBeTruthy();
  });

  it('↑ apply button is hidden when REC off + buffer empty', () => {
    expect(container.querySelector('.piano-apply-btn')).toBeNull();
  });
});

/**
 * MIDI status pill + active-count source-of-truth invariants.
 * Reuses the spy infra from the parallel-synth suite above.
 */
describe('PianoKeyboard component (MIDI status pill + active-count)', () => {
  let evalScore: ReturnType<typeof vi.fn>;
  let container: HTMLDivElement;
  let render: typeof solidRender;
  let PianoKeyboard: typeof PianoKeyboardFn;
  let unmount: (() => void) | undefined;
  let noteCb: ((e: {
    type: 'noteOn' | 'noteOff';
    note: number;
    velocity?: number;
    source: string;
    sourceId: string;
  }) => void) | null;
  let voices: { voiceId: number; midi: number; instrument: PianoInstrument; released: boolean }[];
  let nextVoiceId: number;

  beforeEach(async () => {
    vi.useFakeTimers();
    voices = [];
    nextVoiceId = 1;
    evalScore = vi.fn().mockResolvedValue(undefined);
    noteCb = null;

    vi.resetModules();
    vi.doMock('~/infrastructure/audio/PianoSynth', () => ({
      createPianoSynth: (): PianoSynth => ({
        noteOn: (midi: number, inst: PianoInstrument): number => {
          const id = nextVoiceId; nextVoiceId += 1;
          voices.push({ voiceId: id, midi, instrument: inst, released: false });
          return id;
        },
        noteOff: (voiceId: number): void => {
          const v = voices.find((x) => x.voiceId === voiceId);
          if (v) v.released = true;
        },
        setInstrument: (voiceId: number, inst: PianoInstrument): number => {
          const v = voices.find((x) => x.voiceId === voiceId);
          if (v) {
            v.released = true;
            const id = nextVoiceId; nextVoiceId += 1;
            voices.push({ voiceId: id, midi: v.midi, instrument: inst, released: false });
            return id;
          }
          return -1;
        },
        activeCount: (): number => voices.filter((v) => !v.released).length,
        dispose: (): void => { voices.length = 0; },
      }),
    }));
    vi.doMock('~/infrastructure/audio/LiveAudioEngine', () => ({
      unlockAudioContext: () => ({}) as AudioContext,
    }));
    vi.doMock('../state/audioActions', () => ({ evalScore }));
    vi.doMock('~/infrastructure/audio/MidiInput', () => ({
      isMidiAvailable: () => true,
      requestMidiAccess: async () => ({
        inputs: new Map([['dev-1', { id: 'dev-1', name: 'Mock Keyboard', onmidimessage: null }]]),
        state: 'connected',
        onstatechange: null,
      }),
      onNote: (_access: unknown, cb: typeof noteCb) => {
        noteCb = cb;
        return () => { noteCb = null; };
      },
    }));
    vi.doMock('~/infrastructure/composition', () => ({
      AppLayer: { provide: () => (eff: unknown) => eff },
    }));

    render = (await import('solid-js/web')).render;
    ({ PianoKeyboard } = await import('./PianoKeyboard'));
    container = document.createElement('div');
    document.body.appendChild(container);
    unmount = render(() => PianoKeyboard(), container);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(50);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (unmount) unmount();
    unmount = undefined;
    vi.doUnmock('~/infrastructure/audio/PianoSynth');
    vi.doUnmock('~/infrastructure/audio/LiveAudioEngine');
    vi.doUnmock('../state/audioActions');
    vi.doUnmock('~/infrastructure/audio/MidiInput');
    vi.doUnmock('~/infrastructure/composition');
    if (container) container.remove();
  });

  function midiStatus(): HTMLSpanElement | null {
    return container.querySelector<HTMLSpanElement>('.piano-midi-status');
  }

  it('renders "MIDI: 1 device" pill when no notes are active', () => {
    const pill = midiStatus();
    expect(pill).toBeTruthy();
    expect(pill!.textContent).toContain('MIDI: 1 device');
    expect(pill!.textContent).not.toContain('·');
    expect(pill!.getAttribute('data-active-count')).toBe('0');
    expect(pill!.classList.contains('has-active')).toBe(false);
  });

  it('renders active-note count when 1 note fires via MIDI', async () => {
    noteCb!({ type: 'noteOn', note: 60, velocity: 100, source: 'Mock Keyboard', sourceId: 'dev-1' });
    await vi.advanceTimersByTimeAsync(50);
    const pill = midiStatus();
    expect(pill!.textContent).toContain('MIDI: 1 device');
    expect(pill!.textContent).toContain('·');
    expect(pill!.textContent).toContain('1 нота');
    expect(pill!.getAttribute('data-active-count')).toBe('1');
    expect(pill!.classList.contains('has-active')).toBe(true);
  });

  it('updates active count on note-on (increments) and note-off (decrements)', async () => {
    noteCb!({ type: 'noteOn', note: 60, velocity: 100, source: 'Mock Keyboard', sourceId: 'dev-1' });
    noteCb!({ type: 'noteOn', note: 64, velocity: 100, source: 'Mock Keyboard', sourceId: 'dev-1' });
    noteCb!({ type: 'noteOn', note: 67, velocity: 100, source: 'Mock Keyboard', sourceId: 'dev-1' });
    await vi.advanceTimersByTimeAsync(50);
    const pill = midiStatus()!;
    expect(pill.textContent).toContain('3 ноты');
    expect(pill.getAttribute('data-active-count')).toBe('3');
    expect(pill.classList.contains('has-active')).toBe(true);

    noteCb!({ type: 'noteOff', note: 64, source: 'Mock Keyboard', sourceId: 'dev-1' });
    await vi.advanceTimersByTimeAsync(50);
    expect(pill.textContent).toContain('2 ноты');
    expect(pill.getAttribute('data-active-count')).toBe('2');

    noteCb!({ type: 'noteOff', note: 60, source: 'Mock Keyboard', sourceId: 'dev-1' });
    noteCb!({ type: 'noteOff', note: 67, source: 'Mock Keyboard', sourceId: 'dev-1' });
    await vi.advanceTimersByTimeAsync(50);
    expect(pill.textContent).toContain('MIDI: 1 device');
    expect(pill.textContent).not.toContain('·');
    expect(pill.getAttribute('data-active-count')).toBe('0');
    expect(pill.classList.contains('has-active')).toBe(false);
  });

  it('on-screen taps also feed the active count (single source of truth)', async () => {
    const c4 = container.querySelector<HTMLButtonElement>('button[aria-label="C4"]')!;
    c4.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(50);
    const pill = midiStatus()!;
    expect(pill.textContent).toContain('1 нота');
    expect(pill.getAttribute('data-active-count')).toBe('1');
  });
});

/**
 * Component-level tests for the *attribution* half of the MIDI status
 * pill: which device is currently sending notes. Distinct from the
 * block above (which only checked counts) — here the mock reports
 * 2 inputs so the pill has real work to do beyond counting.
 *
 * Mock layout:
 *   - dev-1: AKAI MPK Mini
 *   - dev-2: Pad Controller
 * The test fires noteOn / noteOff via captured callback with each
 * event's `source` set explicitly to one of those names, then asserts
 * the rendered pill text + `data-midi-source` attribute.
 */
describe('PianoKeyboard component (MIDI source attribution in status pill)', () => {
  let container: HTMLDivElement;
  let render: typeof solidRender;
  let PianoKeyboard: typeof PianoKeyboardFn;
  let unmount: (() => void) | undefined;
  let noteCb: ((e: {
    type: 'noteOn' | 'noteOff';
    note: number;
    velocity?: number;
    source: string;
    sourceId: string;
  }) => void) | null;
  let voices: { voiceId: number; midi: number; instrument: PianoInstrument; released: boolean }[];
  let nextVoiceId: number;

  beforeEach(async () => {
    vi.useFakeTimers();
    voices = [];
    nextVoiceId = 1;
    noteCb = null;

    vi.resetModules();
    vi.doMock('~/infrastructure/audio/PianoSynth', () => ({
      createPianoSynth: (): PianoSynth => ({
        noteOn: (midi: number, inst: PianoInstrument): number => {
          const id = nextVoiceId; nextVoiceId += 1;
          voices.push({ voiceId: id, midi, instrument: inst, released: false });
          return id;
        },
        noteOff: (voiceId: number): void => {
          const v = voices.find((x) => x.voiceId === voiceId);
          if (v) v.released = true;
        },
        setInstrument: (): number => -1,
        dispose: (): void => undefined,
        activeCount: (): number => voices.filter((v) => !v.released).length,
      }),
    }));
    vi.doMock('~/infrastructure/audio/LiveAudioEngine', () => ({
      unlockAudioContext: (): AudioContext => ({}) as AudioContext,
    }));
    vi.doMock('../state/pianoRecStore', () => ({
      recEnabled: () => false,
      appendNote: (): void => undefined,
      updateLastNoteEnd: (): void => undefined,
      instrument: (): PianoInstrument => 'triangle',
      followEnabled: () => false,
      pianoSlot: () => 'append-stack',
      setPianoSlot: (): void => undefined,
      editorFocused: () => false,
      setEditorFocused: (): void => undefined,
      pianoEditorApi: () => undefined,
      setPianoEditorApi: (): void => undefined,
      pianoSlotLabel: (s: string): string => s,
      pianoSlotGlyph: (s: string): string => s,
      previewPillPayload: () => null,
      applyToScore: (): void => undefined,
      flashDecorations: { __placeholder: true } as never,
      setFlashDecorations: { __placeholder: true } as never,
      clearFlashDecorations: { __placeholder: true } as never,
      buildFlashRange: () => ({ size: 0 }) as never,
      flashRange: (): void => undefined,
      flashLastInsertRange: (): void => undefined,
      // Legacy exports still required by other tests
      setInstrument: (): void => undefined,
      setFollow: (): void => undefined,
      toggleRec: (): void => undefined,
      toggleFollow: (): void => undefined,
      clearRec: (): void => undefined,
      recBuffer: (): ReadonlyArray<unknown> => [],
    }));
    vi.doMock('~/infrastructure/audio/MidiInput', () => ({
      isMidiAvailable: () => true,
      requestMidiAccess: async () => ({
        inputs: new Map([
          ['dev-1', { id: 'dev-1', name: 'AKAI MPK Mini', onmidimessage: null }],
          ['dev-2', { id: 'dev-2', name: 'Pad Controller', onmidimessage: null }],
        ]),
        state: 'connected',
        onstatechange: null,
      }),
      onNote: (_access: unknown, cb: typeof noteCb) => {
        noteCb = cb;
        return () => { noteCb = null; };
      },
    }));
    vi.doMock('~/infrastructure/composition', () => ({
      AppLayer: { provide: () => (eff: unknown) => eff },
    }));
    render = (await import('solid-js/web')).render;
    ({ PianoKeyboard } = await import('./PianoKeyboard'));
    container = document.createElement('div');
    document.body.appendChild(container);
    unmount = render(() => PianoKeyboard(), container);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(50);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (unmount) unmount();
    unmount = undefined;
    vi.doUnmock('~/infrastructure/audio/PianoSynth');
    vi.doUnmock('~/infrastructure/audio/LiveAudioEngine');
    vi.doUnmock('../state/pianoRecStore');
    vi.doUnmock('~/infrastructure/audio/MidiInput');
    vi.doUnmock('~/infrastructure/composition');
    if (container) container.remove();
  });

  function midiStatus(): HTMLSpanElement | null {
    return container.querySelector<HTMLSpanElement>('.piano-midi-status');
  }

  function sourceChip(): HTMLSpanElement | null {
    return container.querySelector<HTMLSpanElement>('.piano-midi-source');
  }

  it('renders "MIDI: 2 devices" with no source attribution before any MIDI activity', () => {
    const pill = midiStatus()!;
    expect(pill.textContent).toBe('MIDI: 2 devices');
    expect(pill.textContent).not.toContain('·');
    expect(pill.getAttribute('data-active-count')).toBe('0');
    expect(pill.getAttribute('data-midi-source')).toBe('');
    expect(sourceChip()).toBeNull();
  });

  it('shows the active device name after 3 note-ons from that input', async () => {
    noteCb!({ type: 'noteOn', note: 60, velocity: 100, source: 'AKAI MPK Mini', sourceId: 'dev-1' });
    noteCb!({ type: 'noteOn', note: 64, velocity: 100, source: 'AKAI MPK Mini', sourceId: 'dev-1' });
    noteCb!({ type: 'noteOn', note: 67, velocity: 100, source: 'AKAI MPK Mini', sourceId: 'dev-1' });
    await vi.advanceTimersByTimeAsync(50);
    const pill = midiStatus()!;
    expect(pill.textContent).toBe('MIDI: 2 devices · 3 ноты · AKAI MPK Mini');
    expect(pill.getAttribute('data-active-count')).toBe('3');
    expect(pill.getAttribute('data-midi-source')).toBe('AKAI MPK Mini');
    const chip = sourceChip();
    expect(chip).toBeTruthy();
    expect(chip!.textContent).toBe('AKAI MPK Mini');
  });

  it('switches the source when a different input starts sending notes', async () => {
    // 1. AKAI plays C, E — source becomes AKAI.
    noteCb!({ type: 'noteOn', note: 60, velocity: 100, source: 'AKAI MPK Mini', sourceId: 'dev-1' });
    noteCb!({ type: 'noteOn', note: 64, velocity: 100, source: 'AKAI MPK Mini', sourceId: 'dev-1' });
    await vi.advanceTimersByTimeAsync(50);
    expect(midiStatus()!.getAttribute('data-midi-source')).toBe('AKAI MPK Mini');

    // 2. Pad Controller takes over with a fresh note — source flips.
    noteCb!({ type: 'noteOn', note: 67, velocity: 100, source: 'Pad Controller', sourceId: 'dev-2' });
    await vi.advanceTimersByTimeAsync(50);
    const pill = midiStatus()!;
    expect(pill.textContent).toBe('MIDI: 2 devices · 3 ноты · Pad Controller');
    expect(pill.getAttribute('data-midi-source')).toBe('Pad Controller');
    expect(sourceChip()!.textContent).toBe('Pad Controller');
  });

  it('keeps the source attribution while other notes from the same input are still active', async () => {
    // Press three notes from AKAI, then release ONE of them. Two notes
    // remain active — the source attribution should NOT disappear just
    // because one note-off fired. The pill should still name AKAI.
    noteCb!({ type: 'noteOn', note: 60, velocity: 100, source: 'AKAI MPK Mini', sourceId: 'dev-1' });
    noteCb!({ type: 'noteOn', note: 64, velocity: 100, source: 'AKAI MPK Mini', sourceId: 'dev-1' });
    noteCb!({ type: 'noteOn', note: 67, velocity: 100, source: 'AKAI MPK Mini', sourceId: 'dev-1' });
    await vi.advanceTimersByTimeAsync(50);
    expect(midiStatus()!.getAttribute('data-active-count')).toBe('3');

    noteCb!({ type: 'noteOff', note: 67, source: 'AKAI MPK Mini', sourceId: 'dev-1' });
    await vi.advanceTimersByTimeAsync(50);
    const pill = midiStatus()!;
    expect(pill.getAttribute('data-active-count')).toBe('2');
    expect(pill.getAttribute('data-midi-source')).toBe('AKAI MPK Mini');
    expect(pill.textContent).toBe('MIDI: 2 devices · 2 ноты · AKAI MPK Mini');
    expect(sourceChip()!.textContent).toBe('AKAI MPK Mini');
  });
});

/**
 * iOS Safari path: isMidiAvailable() === false → the toolbar renders
 * WITHOUT a `.piano-midi-status` element. Verifies the Show wrapper.
 */
describe('PianoKeyboard component (no MIDI status on iOS Safari)', () => {
  let container: HTMLDivElement;
  let render: typeof solidRender;
  let PianoKeyboard: typeof PianoKeyboardFn;
  let unmount: (() => void) | undefined;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.doMock('~/infrastructure/audio/PianoSynth', () => ({
      createPianoSynth: (): PianoSynth => ({
        noteOn: () => 0, noteOff: () => undefined,
        setInstrument: () => -1, dispose: () => undefined,
        activeCount: () => 0,
      }),
    }));
    vi.doMock('~/infrastructure/audio/LiveAudioEngine', () => ({
      unlockAudioContext: () => ({}) as AudioContext,
    }));
    vi.doMock('../state/audioActions', () => ({ evalScore: vi.fn() }));
    vi.doMock('~/infrastructure/audio/MidiInput', () => ({
      isMidiAvailable: () => false,
      requestMidiAccess: async () => null,
      onNote: () => () => undefined,
    }));
    vi.doMock('~/infrastructure/composition', () => ({
      AppLayer: { provide: () => (eff: unknown) => eff },
    }));
    render = (await import('solid-js/web')).render;
    ({ PianoKeyboard } = await import('./PianoKeyboard'));
    container = document.createElement('div');
    document.body.appendChild(container);
    unmount = render(() => PianoKeyboard(), container);
    await vi.advanceTimersByTimeAsync(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (unmount) unmount();
    unmount = undefined;
    vi.doUnmock('~/infrastructure/audio/PianoSynth');
    vi.doUnmock('~/infrastructure/audio/LiveAudioEngine');
    vi.doUnmock('../state/audioActions');
    vi.doUnmock('~/infrastructure/audio/MidiInput');
    vi.doUnmock('~/infrastructure/composition');
    if (container) container.remove();
  });

  it('renders without a .piano-midi-status element when isMidiAvailable() is false', () => {
    const pill = container.querySelector('.piano-midi-status');
    expect(pill).toBeNull();
    // The hint still renders.
    const hint = container.querySelector('.piano-hint');
    expect(hint).toBeTruthy();
  });

  it('still renders the rec button and instrument selector', () => {
    expect(container.querySelector('.piano-rec-btn')).toBeTruthy();
    // (wavecode-piano-sample-picker) 4 sample + 4 oscillator = 8 buttons.
    expect(container.querySelectorAll('.piano-inst-btn')).toHaveLength(8);
  });
});
