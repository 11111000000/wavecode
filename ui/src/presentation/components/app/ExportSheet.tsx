import { createSignal, type JSX } from 'solid-js';
import { Effect } from 'effect';
import { BottomSheet } from '~/presentation/components/BottomSheet';
import { AudioEngine } from '~/domain/services';
import { AppLayer } from '~/infrastructure/composition';
import { appStore } from '~/presentation/state/appStore';
import { MidiIOButtons } from '~/presentation/components/MidiIOButtons';

/**
 * ExportSheet — вынос того, что было написано, но не показано.
 *
 * wavecode-zen-minimal-ui (ревизия 2, фаза 5): MIDI-импорт/экспорт
 * (`MidiIOButtons`) и WAV-рендер (`AudioEngine.renderOffline`) были
 * реализованы, но смонтированы в UI не были — README обещал
 * «tool-calling и WAV-экспорт», а пользователь не мог получить ни
 * того, ни другого. Теперь это один лист «Экспорт», а не забытая
 * кнопка внизу партитуры.
 */

type ExportStatusKind = 'idle' | 'busy' | 'ok' | 'err';

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export function ExportSheet(): JSX.Element {
  const [status, setStatus] = createSignal<ExportStatusKind>('idle');
  const [message, setMessage] = createSignal('');

  const renderWav = (): void => {
    setStatus('busy');
    setMessage('Рендер WAV…');
    void Effect.runPromise(
      Effect.gen(function* () {
        const audio = yield* AudioEngine;
        const result = yield* audio.renderOffline(
          appStore.score,
          { cycles: 4 },
          {
            onProgress: (p) => {
              const label =
                p.stage === 'compiling' ? 'Сборка…'
                : p.stage === 'rendering' ? 'Рендер…'
                : p.stage === 'encoding' ? 'Кодирование…'
                : 'Готово';
              setStatus('busy');
              setMessage(`${label} ${Math.round(p.progress * 100)}%`);
            },
          },
        );
        downloadBlob(result.blob, 'wavecode.wav');
        return result;
      }).pipe(Effect.provide(AppLayer)),
    )
      .then((result) => {
        setStatus('ok');
        setMessage(`WAV готов: ${result.durationSec.toFixed(1)} с, ${result.sampleRate} Гц`);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus('err');
        setMessage(`Не удалось отрендерить WAV: ${msg}`);
      });
  };

  return (
    <BottomSheet kind="export" title="Экспорт" subtitle="WAV, MIDI и код">
      <div class="wc-export-sheet">
        <section class="wc-export-sheet__block">
          <h3 class="wc-export-sheet__title">Аудио</h3>
          <p class="wc-export-sheet__hint">
            Офлайн-рендер текущей партитуры: 4 цикла, 44.1 кГц, стерео.
          </p>
          <button
            type="button"
            class="wc-btn wc-btn--primary"
            onClick={renderWav}
            disabled={status() === 'busy'}
          >
            {status() === 'busy' ? 'Рендер…' : 'Скачать WAV'}
          </button>
          {status() !== 'idle' && (
            <p
              class="wc-export-sheet__status"
              role="status"
              aria-live="polite"
              data-kind={status()}
            >
              {message()}
            </p>
          )}
        </section>

        <section class="wc-export-sheet__block">
          <h3 class="wc-export-sheet__title">MIDI и код</h3>
          <MidiIOButtons />
        </section>
      </div>
    </BottomSheet>
  );
}
