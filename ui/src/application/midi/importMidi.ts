/**
 * importMidi: MIDI bytes → Strudel snippet (с валидацией).
 *
 * Pipeline:
 *   bytes (Uint8Array)
 *     → parseSmi(bytes)                  [MIDISequence]
 *     → midiToScore(seq, opts, drumMap)  [MIDIImportResult]
 *     → validate (compile через transpiler, без playback)
 *
 * Если валидация fails — возвращаем ok=true с warning, не блокируем
 * импорт: юзер может захотеть увидеть результат чтобы понять почему.
 */

import { Effect } from 'effect';
import * as transpiler from '@strudel/transpiler';
import { parseSmi } from '~/domain/midi/codec';
import { midiToScore } from '~/domain/midi/decoder';
import { gmDrumMap } from './gmDrumMap';
import type {
  MIDIImportOptions,
  MIDIImportResult,
} from '~/domain/midi/types';

export const importMidi = (
  bytes: Uint8Array,
  opts: MIDIImportOptions = {},
): Effect.Effect<MIDIImportResult, never, never> =>
  Effect.sync((): MIDIImportResult => {
    let seq;
    try {
      seq = parseSmi(bytes);
    } catch (e) {
      return {
        ok: false,
        error: `не удалось распарсить MIDI: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    const result = midiToScore(seq, opts, gmDrumMap);
    if (!result.ok) return result;

    try {
      const ev = (transpiler as { evaluate?: (s: string, opts?: object) => unknown }).evaluate;
      if (ev) ev(result.score, { nanFallback: 0 });
    } catch (e) {
      return {
        ok: true,
        score: result.score,
        warnings: [
          ...result.warnings,
          `сниппет скомпилирован с ошибкой: ${e instanceof Error ? e.message : String(e)}`,
        ],
      };
    }

    return result;
  });