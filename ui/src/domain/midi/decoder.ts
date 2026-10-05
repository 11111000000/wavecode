/**
 * Pure декодер: MIDISequence → Strudel mini-notation snippet.
 *
 * Алгоритм:
 *   1. BPM берём из seq.bpm если > 0; иначе детектим из median
 *      inter-onset интервала (fallback 120).
 *   2. Канал 10 (SMF drums, 1-indexed) → s(...) через GM-drum-map
 *      (маппинг в application-слое, сюда приходит как `drums: boolean`).
 *   3. Для каждого note-track:
 *      - onset-time в cycle: 1 cycle = 1 quarter (60/bpm секунд)
 *      - quantize к grid (default 16th = 0.25 cycle)
 *      - собрать ноты в массив по cycle-индексам, разделяя ~ для gaps
 *      - emit: note("...") для мелодии, s("[...]"...) для drums
 *   4. ≥2 трека → stack(...). 1 трек → без обёртки.
 *
 * Domain не знает про Strudel, application оборачивает результат
 * в финальный snippet.
 */

import type {
  MIDISequence,
  MIDITrack,
  MIDIImportOptions,
  MIDIImportResult,
} from './types';

const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const midiToName = (midi: number): string => {
  const m = Math.round(midi);
  const pc = PC[((m % 12) + 12) % 12];
  const octave = Math.floor(m / 12) - 1;
  return `${pc.toLowerCase()}${octave}`;
};

const FALLBACK_BPM = 120;

export const detectBpm = (seq: MIDISequence): number => {
  if (seq.bpm >= 30 && seq.bpm <= 300) return Math.round(seq.bpm);

  const onsets: number[] = [];
  for (const t of seq.tracks) {
    for (const n of t.notes) {
      onsets.push(n.timeSec);
    }
  }
  if (onsets.length < 4) return FALLBACK_BPM;

  onsets.sort((a, b) => a - b);
  const ioi: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    const a = onsets[i];
    const b = onsets[i - 1];
    if (a === undefined || b === undefined) continue;
    const d = a - b;
    if (d > 0 && d < 2) ioi.push(d);
  }
  if (ioi.length === 0) return FALLBACK_BPM;
  ioi.sort((a, b) => a - b);
  const median = ioi[Math.floor(ioi.length / 2)];
  if (median === undefined || median <= 0) return FALLBACK_BPM;
  const bpm = Math.round(60 / median);
  return bpm >= 30 && bpm <= 300 ? bpm : FALLBACK_BPM;
};

export type DrumMap = ReadonlyMap<number, string>;

const isDrums = (track: MIDITrack): boolean => track.channel === 10;

const cycleLenSec = (bpm: number): number => 60 / bpm;

const encodeDrums = (
  track: MIDITrack,
  grid: number,
  bpm: number,
  drumMap: DrumMap,
): string | null => {
  const cls = cycleLenSec(bpm);
  const cellMap = new Map<number, string[]>();

  for (const n of track.notes) {
    const cycle = n.timeSec / cls;
    const cell = Math.round(cycle / grid);
    const sample = drumMap.get(Math.round(n.midi));
    if (!sample) continue;
    let list = cellMap.get(cell);
    if (!list) {
      list = [];
      cellMap.set(cell, list);
    }
    list.push(sample);
  }

  if (cellMap.size === 0) return null;
  const cells = [...cellMap.keys()].sort((a, b) => a - b);
  const maxCell = cells[cells.length - 1] ?? 0;
  const tokens: string[] = [];
  for (let i = 0; i <= maxCell; i++) {
    const list = cellMap.get(i);
    if (!list) {
      tokens.push('~');
    } else if (list.length === 1) {
      tokens.push(list[0]!);
    } else {
      tokens.push(`[${list.join(',')}]`);
    }
  }
  return `s("${tokens.join(' ')}")`;
};

const encodeNotes = (
  track: MIDITrack,
  grid: number,
  bpm: number,
): string | null => {
  const cls = cycleLenSec(bpm);
  const cellMap = new Map<number, string[]>();

  for (const n of track.notes) {
    const cycle = n.timeSec / cls;
    const cell = Math.round(cycle / grid);
    let list = cellMap.get(cell);
    if (!list) {
      list = [];
      cellMap.set(cell, list);
    }
    list.push(midiToName(n.midi));
  }

  if (cellMap.size === 0) return null;
  const cells = [...cellMap.keys()].sort((a, b) => a - b);
  const maxCell = cells[cells.length - 1] ?? 0;
  const tokens: string[] = [];
  for (let i = 0; i <= maxCell; i++) {
    const list = cellMap.get(i);
    if (!list) {
      tokens.push('~');
    } else if (list.length === 1) {
      tokens.push(list[0]!);
    } else {
      tokens.push(`[${list.join(',')}]`);
    }
  }
  return `note("${tokens.join(' ')}")`;
};

export const midiToScore = (
  seq: MIDISequence,
  opts: MIDIImportOptions,
  drumMap: DrumMap,
): MIDIImportResult => {
  const warnings: string[] = [];
  const bpm = opts.bpm && opts.bpm >= 30 && opts.bpm <= 300
    ? Math.round(opts.bpm)
    : detectBpm(seq);
  const grid = opts.quantizeGrid ?? 0.25;

  if (opts.bpm === undefined && seq.bpm > 0) {
    if (seq.bpm < 30 || seq.bpm > 300) {
      warnings.push(`seq.bpm=${seq.bpm} вне диапазона, использую detected=${bpm}`);
    }
  }

  const lines: string[] = [];
  for (const t of seq.tracks) {
    if (opts.drumsAsSamples === false && isDrums(t)) {
      warnings.push(`канал 10 (drums) пропущен: drumsAsSamples=false`);
      continue;
    }
    let line: string | null;
    if (isDrums(t)) {
      line = encodeDrums(t, grid, bpm, drumMap);
    } else {
      line = encodeNotes(t, grid, bpm);
    }
    if (line) {
      lines.push(line);
    }
  }

  if (lines.length === 0) {
    return {
      ok: false,
      error: 'нет валидных note/drum-событий после декодирования',
    };
  }

  if (lines.length === 1) {
    return { ok: true, score: lines[0]!, warnings };
  }

  const stack = ['stack(', ...lines.map((l, i) => (i === lines.length - 1 ? `  ${l}` : `  ${l},`)), ')'].join('\n');
  return { ok: true, score: stack, warnings };
};