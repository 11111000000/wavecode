import { Show, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import {
  SAMPLE_PROGRESS_EVENT,
  type SampleProgressEvent,
} from '~/infrastructure/audio/sampleProgressEvent';
import { netStatus } from '~/presentation/state/netStatus';
import { CTX_STATE_LABEL, labelFor } from '~/presentation/state/labels';

/**
 * StatusStrip — ЕДИНОЕ место, где живёт состояние приложения.
 *
 * wavecode-zen-ui-phases-6-7 (фаза 6, «Тишина»): раньше эти данные
 * были размазаны по трём местам — бейдж в нижнем рельсе, плашка
 * «♪ samples» в верхней панели и «⚠» на `/admin`. Теперь всё в
 * одной строке:
 *
 *   [● играет] [12/143] [офлайн]
 *
 * Правила:
 *   - состояние аудио видно всегда (это ответ на «звучит ли?»);
 *   - счётчик сэмплов — только пока грузятся (после загрузки он
 *     исчезает, чтобы не занимать место);
 *   - «офлайн» — только когда сеть действительно пропала.
 *
 * Компонент ничего не знает про остальной UI: он читает событие
 * прогресса сэмплов и netStatus, а состояние аудио получает
 * пропсами от верхней панели.
 */

export type StatusStripProps = {
  audioRunning: boolean;
  ctxState: () => string;
};

export function StatusStrip(props: StatusStripProps): JSX.Element {
  const [samples, setSamples] = createSignal<SampleProgressEvent>({
    loaded: 0,
    total: 0,
    status: 'idle',
  });

  onMount(() => {
    const onUpdate = (e: Event): void => {
      const detail = (e as CustomEvent<SampleProgressEvent>).detail;
      if (!detail || typeof detail !== 'object') return;
      setSamples(detail);
    };
    window.addEventListener(SAMPLE_PROGRESS_EVENT, onUpdate as EventListener);
    const uninstall = netStatus.installNetListeners();
    onCleanup(() => {
      window.removeEventListener(
        SAMPLE_PROGRESS_EVENT,
        onUpdate as EventListener,
      );
      uninstall();
    });
  });

  const ctxLabel = (): string => labelFor(CTX_STATE_LABEL, props.ctxState());

  return (
    <div class="wc-status" data-testid="status-strip">
      <span
        class="wc-status__led"
        data-tone={props.audioRunning ? 'running' : 'idle'}
        data-testid="status-audio"
        title={props.audioRunning ? 'Звучит' : 'Звука нет'}
      >
        <span class="wc-led" data-tone={props.audioRunning ? 'running' : 'idle'}>
          {props.audioRunning ? '▶' : '●'} {ctxLabel()}
        </span>
      </span>
      <Show when={samples().status === 'loading'}>
        <span
          class="wc-status__chip"
          data-tone="muted"
          data-testid="status-samples"
          role="status"
          aria-live="polite"
          title="Загрузка сэмплов"
        >
          {samples().loaded}/{samples().total} сэмплов
        </span>
      </Show>
      <Show when={samples().status === 'error'}>
        <span
          class="wc-status__chip"
          data-tone="err"
          data-testid="status-samples-error"
          title="Сэмплы не загрузились"
        >
          сэмплы: ошибка
        </span>
      </Show>
      <Show when={!netStatus.isOnline()}>
        <span
          class="wc-status__chip"
          data-tone="warn"
          data-testid="status-offline"
          title="Нет соединения с сетью"
        >
          офлайн
        </span>
      </Show>
    </div>
  );
}
