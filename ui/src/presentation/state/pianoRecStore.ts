import { createSignal } from 'solid-js';
import type { PianoInstrument } from '~/domain/music/notes';

/**
 * pianoRecStore — presentation-layer signals for the piano's record
 * mode + instrument selector.
 *
 * Two concerns:
 *   1. **Rec buffer** — when the user toggles REC on and plays the
 *      piano, each note-on/off pair pushes a `RecNote` entry onto
 *      `recBuffer` (midi + startMs + endMs). The buffer is flushed
 *      when REC is toggled off — `flushRec()` returns the array AND
 *      clears it (idempotent), so the caller can dispatch a
 *      `replaceScore(stack(existingScore, snippet))` action without
 *      leaking notes into the next recording session.
 *
 *   2. **Instrument** — which OscillatorType the next `noteOn` should
 *      use. Held in a separate signal so the keyboard can read the
 *      current value at noteOn time without re-rendering on every
 *      press.
 *
 * Lives in presentation/state/ because:
 *   - Both signals are UI-state (Solid signals, not Solid stores —
 *     the buffer is intentionally an immutable ReadonlyArray so
 *     `appendNote` / `flushRec` produce new arrays rather than
 *     mutating in place, which keeps Solid happy with referential
 *     equality).
 *   - presentation may NOT import @strudel/* or audio infrastructure
 *     — and it doesn't need to; it just holds raw MIDI numbers.
 */

export type RecNote = {
  readonly midi: number;
  readonly startMs: number;
  readonly endMs: number;
};

export const [recEnabled, setRecEnabled] = createSignal(false);
export const [recBuffer, setRecBuffer] = createSignal<ReadonlyArray<RecNote>>([]);
export const [instrument, setInstrumentSignal] = createSignal<PianoInstrument>('triangle');

export const toggleRec = (): void => {
  setRecEnabled((v) => !v);
};

export const setInstrument = (i: PianoInstrument): void => {
  setInstrumentSignal(i);
};

/**
 * Append a not-yet-finished note to the buffer.
 *
 * The keyboard calls this on note-on with `endMs === startMs` (a
 * "press without release" marker); when note-off fires, it calls
 * `updateLastNoteEnd(nextMs)` to fix the end timestamp. This split
 * keeps the public API minimal while supporting tap-and-hold correctly.
 */
export const appendNote = (midi: number, startMs: number, endMs: number): void => {
  setRecBuffer((b) => [...b, { midi, startMs, endMs }]);
};

/** Replace the endMs of the most recent buffer entry. No-op if empty. */
export const updateLastNoteEnd = (endMs: number): void => {
  setRecBuffer((b) => {
    if (b.length === 0) return b;
    const idx = b.length - 1;
    const last = b[idx]!;
    const next = b.slice();
    next[idx] = { ...last, endMs };
    return next;
  });
};

/** Return the last `n` notes from the buffer (most-recent first or
 *  in order, see impl) without mutating it. */
export const recentNotes = (n: number): ReadonlyArray<RecNote> => {
  const buf = recBuffer();
  if (n <= 0 || buf.length === 0) return [];
  return buf.slice(Math.max(0, buf.length - n));
};

/** Return the buffer and clear it. Used when REC is toggled off — the
 *  caller can then convert to a Strudel snippet and dispatch a
 *  replaceScore. */
export const flushRec = (): ReadonlyArray<RecNote> => {
  const buf = recBuffer();
  setRecBuffer([]);
  return buf;
};

/** Reset the buffer without returning it. Used by tests + cleanup paths. */
export const clearRec = (): void => {
  setRecBuffer([]);
};