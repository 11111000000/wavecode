/**
 * importMidi: MIDI bytes → Strudel snippet (с валидацией).
 *
 * Pipeline:
 *   bytes (Uint8Array)
 *     → parseSmi(bytes)              [MIDISequence]
 *     → midiToScore(seq, opts, drumMap)  [MIDIImportResult]
 *     → validate (compileAndQuery, без playback)
 *
 * Если compileAndQuery fails — возвращаем ok=true с warning,
 * не блокируем импорт: юзер может захотеть увидеть результат
 * чтобы понять почему.
 */

import { Effect } from 'effect';
import { AudioEngine } from '~/domain/services';
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
): Effect.Effect<MIDIImportResult, never, AudioEngine> =>
  Effect.gen(function* () {
    let seq;
    try {
      seq = parseSmi(bytes);
    } catch (e) {
      return {
        ok: false,
        error: `не удалось распарсить MIDI: ${e instanceof Error ? e.message : String(e)}`,
      } satisfies MIDIImportResult;
    }

    const result = midiToScore(seq, opts, gmDrumMap);
    if (!result.ok) return result;

    const engine = yield* AudioEngine;
    const validateExit = yield* Effect.exit(engine.compileAndQuery(result.score, 1));
    if (validateExit._tag === 'Failure') {
      const msg = validateExit.cause._tag === 'Fail'
        ? String((validateExit.cause as { error?: unknown }).error ?? 'unknown')
        : 'validate failed';
      return {
        ok: true,
        score: result.score,
        warnings: [...result.warnings, `сниппет не компилируется: ${msg}`],
      } satisfies MIDIImportResult;
    }

    return result;
  });