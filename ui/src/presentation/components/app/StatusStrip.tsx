import { Show, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import {
  SAMPLE_PROGRESS_EVENT,
  type SampleProgressEvent,
} from '~/infrastructure/audio/sampleProgressEvent';
import { netStatus } from '~/presentation/state/netStatus';
import { appStore } from '~/presentation/state/appStore';
import {
  AUDIO_STATUS_LABEL,
  CTX_STATE_LABEL,
  labelFor,
} from '~/presentation/state/labels';

/**
 * StatusStrip — ЕДИНОЕ место, где живёт состояние приложения.
 *
 * wavecode-zen-ui-phases-6-7 (фаза 6, «Тишина»): раньше эти данные
 * были размазаны по трём местам — бейдж в нижнем рельсе, плашка
 * «♪ samples» в верхней панели и «⚠» на `/admin`. Теперь всё в
 * одной строке:
 *
 *   [▶ играет] [12/143] [офлайн]
 *
 * Правила:
 *   - состояние аудио видно всегда (это ответ на «звучит ли?»);
 *   - счётчик сэмплов — только пока грузятся (после загрузки он
 *     исчезает, чтобы не занимать место);
 *   - «офлайн» — только когда сеть действительно пропала.
 *
 * Про состояние AudioContext: строка показывает `audio.status`
 * («играет» / «ошибка» / «остановлен»), а НЕ состояние контекста.
 * Контекст остаётся `running` и после нажатия «Стоп» — по нему нельзя
 * понять, звучит ли музыка. Состояние контекста уходит в подсказку,
 * где оно и belongs: «Звук: остановлен (контекст: работает)».
 */

export type StatusStripProps = {
  ctxState: () => string;
};

type Tone = 'running' | 'idle' | 'err';

type AudioView = { tone: Tone; glyph: string; label: string };

const audioView = (): AudioView => {
  const status = appStore.audio.status;
  if (status === 'playing') {
    return { tone: 'running', glyph: '▶', label: labelFor(AUDIO_STATUS_LABEL, status) };
  }
  if (status === 'error') {
    return { tone: 'err', glyph: '⚠', label: labelFor(AUDIO_STATUS_LABEL, status) };
  }
  return { tone: 'idle', glyph: '●', label: labelFor(AUDIO_STATUS_LABEL, status) };
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
        data-tone={audioView().tone}
        data-testid="status-audio"
        title={`Звук: ${audioView().label} (контекст: ${ctxLabel()})`}
      >
        <span class="wc-led" data-tone={audioView().tone}>
          {audioView().glyph} {audioView().label}
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
