/**
 * Pure структурный конвертер: массив извлечённых note-событий →
 * MIDISequence (1+ треков по каналам).
 *
 * Domain НЕ импортирует @strudel/* — extraction выполняется в
 * `application/midi/extractNotes.ts`, сюда приходят уже плоские
 * `NoteEvent`-ы (модули Strudel-типов остаются на application-уровне).
 */

import type {
  MIDINote,
  MIDISequence,
  MIDITrack,
  MIDIExportOptions,
} from './types';

export type NoteEvent = {
  readonly midi: number;
  readonly startCycle: number;
  readonly endCycle: number;
  readonly velocity: number;
  readonly channel: number;
};

const DEFAULT_VELOCITY = 100;
const DEFAULT_PPQ = 480;

/**
 * Конвертирует `cycles × cycleLengthSeconds` в абсолютное время в секундах.
 *
 * Конвенция: 1 cycle = 1 quarter note. Это самое простое отображение
 * Strudel → MIDI-grid. Если оператор хочет 1 cycle = 1 measure —
 * меняется в `exportMidi.ts` через `cyclesPerBeat` (выходит за пределы
 * domain, domain не знает про BPM-семантику).
 */
const cycleToSec = (cycle: number, bpm: number): number =>
  (cycle * 60) / bpm;

export const hapsToSequence = (
  events: ReadonlyArray<NoteEvent>,
  opts: MIDIExportOptions,
): { seq: MIDISequence; warnings: ReadonlyArray<string> } => {
  const warnings: string[] = [];
  const groups = new Map<number, NoteEvent[]>();

  for (const e of events) {
    if (!Number.isFinite(e.midi) || e.midi < 0 || e.midi > 127) {
      warnings.push(
        `midi=${e.midi} вне диапазона 0..127, пропущен`,
      );
      continue;
    }
    if (e.startCycle < 0 || e.endCycle <= e.startCycle) {
      warnings.push(
        `note с midi=${e.midi} на cycle=${e.startCycle} пропущен: ` +
          `невалидный интервал`,
      );
      continue;
    }
    const ch = Math.max(1, Math.min(16, e.channel | 0));
    let list = groups.get(ch);
    if (!list) {
      list = [];
      groups.set(ch, list);
    }
    list.push(e);
  }

  if (events.length === 0) {
    warnings.push('нет валидных note-событий после фильтрации');
  }

  const vel = opts.defaultVelocity ?? DEFAULT_VELOCITY;
  const tracks: MIDITrack[] = [];
  let lastEnd = 0;

  for (const [channel, evts] of groups) {
    const sorted = evts.sort((a, b) => a.startCycle - b.startCycle);
    const notes: MIDINote[] = sorted.map((e) => {
      const timeSec = cycleToSec(e.startCycle, opts.bpm);
      const durSec = cycleToSec(e.endCycle - e.startCycle, opts.bpm);
      lastEnd = Math.max(lastEnd, timeSec + durSec);
      return {
        midi: Math.round(e.midi),
        timeSec,
        durationSec: Math.max(0.01, durSec),
        velocity: Math.max(0.01, Math.min(1, (e.velocity || vel) / 127)),
      };
    });
    tracks.push({ channel, notes });
  }

  tracks.sort((a, b) => a.channel - b.channel);

  return {
    seq: {
      bpm: opts.bpm,
      ppq: opts.ppq ?? DEFAULT_PPQ,
      tracks,
      durationSec: lastEnd,
    },
    warnings,
  };
};