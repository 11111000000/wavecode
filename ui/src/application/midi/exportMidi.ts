/**
 * exportMidi: snippet → MIDI bytes (Uint8Array).
 *
 * Pipeline:
 *   snippet (string)
 *     → AudioEngine.compileAndQuery(snippet, cycles)
 *     → NoteEvent[] (через LiveAudioEngine.compileAndQuery — domain не знает про @strudel/*)
 *     → hapsToSequence(events, opts)
 *     → writeSmi(seq)
 *     → Uint8Array
 *
 * `s()`-паттерны в snippet скипаются на этапе `extractFromHap`:
 * `getFrequency()` возвращает undefined (нет pitch), функция fallback не
 * срабатывает → событие не попадает в массив. Оператор получает warning
 * «N сэмпловых слоёв пропущены».
 *
 * Layer в `application/`, может использовать domain и интерфейсы
 * Effect-сервисов. `@strudel/*` — НЕ импортируется (lint rule).
 */

import { Effect } from 'effect';
import { AudioEngine } from '~/domain/services';
import { hapsToSequence } from '~/domain/midi/encoder';
import { writeSmi } from '~/domain/midi/codec';
import type { MIDIExportOptions, MIDIExportResult } from '~/domain/midi/types';

export const exportMidi = (
  snippet: string,
  opts: MIDIExportOptions,
): Effect.Effect<MIDIExportResult, never, AudioEngine> =>
  Effect.gen(function* () {
    const engine = yield* AudioEngine;
    const cycles = Math.max(1, Math.min(32, opts.cycles | 0));
    const exit = yield* Effect.exit(engine.compileAndQuery(snippet, cycles));
    if (exit._tag === 'Failure') {
      const msg = exit.cause._tag === 'Fail'
        ? String((exit.cause as { error?: unknown }).error ?? 'unknown')
        : 'compileAndQuery failed';
      return { ok: false, error: msg } satisfies MIDIExportResult;
    }
    const events = exit.value;
    const { seq, warnings: encWarnings } = hapsToSequence(events, opts);
    const warnings: string[] = [...encWarnings];
    if (events.length === 0) {
      warnings.push('нет note-событий (snippet содержит только s()-сэмплы или пустой)');
    }
    const bytes = writeSmi(seq);
    return { ok: true, bytes, warnings } satisfies MIDIExportResult;
  });