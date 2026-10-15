import { createSignal, Show, onCleanup, createMemo, For } from 'solid-js';
import { Effect } from 'effect';
import { dispatch, getActiveScore } from '../state/appStore';
import { exportMidi } from '~/application/midi/exportMidi';
import { importMidi } from '~/application/midi/importMidi';
import { AppLayer } from '~/infrastructure/composition';
import type { MIDIExportResult, MIDIImportResult } from '~/domain/midi/types';

/**
 * MidiIOButtons — пара кнопок импорта/экспорта для score.
 * Живёт внизу ScorePanel, рядом с debug-инфо.
 *
 * Поддерживает:
 *   - `.mid` / `.midi` — через application/midi/{importMidi,exportMidi}
 *   - `.strudel.txt` / `.js` / `.txt` — lossless text round-trip
 */

const MIDI_ACCEPT = '.mid,.midi';
const TEXT_ACCEPT = '.strudel.txt,.js,.txt';

const defaultTextName = (): string => {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  return `wavecode-score-${stamp}.strudel.txt`;
};

const triggerDownload = (bytes: Uint8Array, filename: string, mime: string): void => {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const triggerTextDownload = (text: string, filename: string): void => {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error('FileReader error'));
    r.readAsArrayBuffer(file);
  });

const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error('FileReader error'));
    r.readAsText(file);
  });

const fileExt = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
};

export function MidiIOButtons() {
  const [cycles, setCycles] = createSignal(4);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [warnings, setWarnings] = createSignal<ReadonlyArray<string>>([]);
  const lastUrl: { current: string | null } = { current: null };

  onCleanup(() => {
    if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
  });

  const handleImport = async (file: File): Promise<void> => {
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      const ext = fileExt(file.name);
      if (MIDI_ACCEPT.split(',').includes(ext) || ext === '.midi') {
        const buf = await readFileAsArrayBuffer(file);
        const bytes = new Uint8Array(buf);
        const result = await Effect.runPromise(
          importMidi(bytes).pipe(Effect.provide(AppLayer)),
        );
        applyImportResult(result);
      } else {
        const text = await readFileAsText(file);
        dispatch({ type: 'replaceScore', text });
      }
    } catch (e) {
      setError(`импорт: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const applyImportResult = (result: MIDIImportResult): void => {
    if (!result.ok) {
      setError(result.error);
      return;
    }
    dispatch({ type: 'replaceScore', text: result.score });
    if (result.warnings.length) setWarnings(result.warnings);
  };

  const handleExportMidi = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      const result: MIDIExportResult = await Effect.runPromise(
        exportMidi(getActiveScore(), {
          bpm: 120,
          cycles: cycles(),
        }).pipe(Effect.provide(AppLayer)),
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      triggerDownload(result.bytes, defaultTextName().replace(/\.strudel\.txt$/, '.mid'), 'audio/midi');
      if (result.warnings.length) setWarnings(result.warnings);
    } catch (e) {
      setError(`экспорт MIDI: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleExportText = (): void => {
    triggerTextDownload(getActiveScore(), defaultTextName());
  };

  const acceptAll = createMemo(() => `${MIDI_ACCEPT},${TEXT_ACCEPT}`);

  return (
    <details class="midi-io-bar">
      <summary class="midi-io-summary">📁 Файловые операции</summary>
      <div class="midi-io-row">
        <label class="midi-io-field midi-io-import">
          <span class="midi-io-label">Импорт:</span>
          <input
            type="file"
            accept={acceptAll()}
            disabled={busy()}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) void handleImport(file);
              e.currentTarget.value = '';
            }}
          />
        </label>
        <label class="midi-io-field midi-io-export-midi">
          <span class="midi-io-label">Циклов:</span>
          <input
            type="number"
            min="1"
            max="32"
            value={cycles()}
            disabled={busy()}
            onInput={(e) => setCycles(Math.max(1, Math.min(32, +e.currentTarget.value || 4)))}
          />
          <button type="button" class="midi-io-btn" disabled={busy()} onClick={handleExportMidi}>
            📤 MIDI
          </button>
        </label>
        <button type="button" class="midi-io-btn" disabled={busy()} onClick={handleExportText}>
          📤 Текст
        </button>
      </div>
      <Show when={error()}>
        <div class="midi-io-err">{error()}</div>
      </Show>
      <Show when={warnings().length}>
        <details class="midi-io-warn">
          <summary>{warnings().length} предупреждение</summary>
          <ul>
            <For each={warnings()}>{(w) => <li>{w}</li>}</For>
          </ul>
        </details>
      </Show>
    </details>
  );
}