/**
 * Pure обёртка над @tonejs/midi — парсер и писатель Standard MIDI File.
 *
 * Изолирует domain от API конкретной библиотеки. Если завтра захотим
 * midi-file или JZZ — меняется этот файл, остальное не ломается.
 *
 * Pure: никаких DOM, никакого fetch, никакого AudioContext.
 * Архитектурное правило: domain не импортирует инфраструктуру (eslint
 * no-restricted-imports проверяет это).
 *
 * Конвенция каналов:
 *   SMF + @tonejs/midi используют 1-indexed каналы (1..16).
 *   Канал 10 (по SMF-конвенции) = drums (General MIDI).
 *   Domain `MIDITrack.channel` — те же 1..16, 10 = drums.
 *   0 в domain допустим только если SMF это позволяет (мы clamp'им).
 */

import { Midi } from '@tonejs/midi';
import type { MIDINote, MIDISequence, MIDITrack } from './types';

const clampChannel = (ch: number): number => Math.max(1, Math.min(16, ch | 0));

export const parseSmi = (bytes: Uint8Array): MIDISequence => {
  const midi = new Midi(bytes);
  const tracks: MIDITrack[] = midi.tracks.map((t) => ({
    channel: clampChannel(t.channel ?? 1),
    notes: t.notes.map(
      (n): MIDINote => ({
        midi: n.midi,
        timeSec: n.time,
        durationSec: n.duration,
        velocity: n.velocity,
        ...(n.name ? { name: n.name } : {}),
      }),
    ),
  }));
  const firstBpm = midi.header.tempos[0]?.bpm ?? 120;
  const ppq = midi.header.ppq || 480;
  const lastEnd = tracks.reduce(
    (max, t) =>
      t.notes.reduce(
        (m, n) => Math.max(m, n.timeSec + n.durationSec),
        max,
      ),
    0,
  );
  return {
    bpm: firstBpm,
    ppq,
    tracks,
    durationSec: lastEnd || midi.duration,
  };
};

export const writeSmi = (seq: MIDISequence): Uint8Array => {
  const midi = new Midi();
  midi.header.setTempo(seq.bpm);
  if (seq.ppq && seq.ppq !== 480) {
    Object.defineProperty(midi.header, 'ppq', {
      get: () => seq.ppq,
      configurable: true,
    });
    midi.header.update();
  }
  for (const t of seq.tracks) {
    const track = midi.addTrack();
    track.channel = clampChannel(t.channel);
    for (const n of t.notes) {
      track.addNote({
        midi: n.midi,
        time: n.timeSec,
        duration: n.durationSec,
        velocity: n.velocity,
      });
    }
  }
  return new Uint8Array(midi.toArray());
};