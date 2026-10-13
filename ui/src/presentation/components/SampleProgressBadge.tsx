import { type JSX, Show, createSignal, onMount, onCleanup } from 'solid-js';
import { SAMPLE_PROGRESS_EVENT, type SampleProgressEvent } from '../../infrastructure/audio/sampleProgressEvent';

/**
 * SampleProgressBadge — small inline pill in BottomBar that shows
 * "Загружено N/M семплов" + a progress bar while sample MP3s are
 * preloading.
 *
 * Driven by the `wavecode:sample-progress` CustomEvent dispatched by
 * SampleLoader.registerBank — the badge subscribes without importing
 * any infrastructure code, keeping the presentation layer pure.
 *
 * Visibility:
 *   - 'idle' / 'loaded' / 'error' → renders nothing (so the bar
 *     disappears once preloading is done — the user only sees it
 *     during the boot-time preload window).
 *   - 'loading' → renders the pill.
 *
 * Accessibility:
 *   - `role="status"` + `aria-live="polite"` so screen readers
 *     announce progress updates without interrupting.
 *   - `<progress>` is a native element with implicit semantics; we
 *     set `value`/`max` from the event detail.
 */

export type SampleProgressBadgeProps = {
  eventName?: string;
};

export function SampleProgressBadge(props: SampleProgressBadgeProps = {}): JSX.Element {
  const eventName = (): string => props.eventName ?? SAMPLE_PROGRESS_EVENT;
  const [progress, setProgress] = createSignal<SampleProgressEvent>({
    loaded: 0,
    total: 0,
    status: 'idle',
  });

  onMount(() => {
    const onUpdate = (e: Event): void => {
      const detail = (e as CustomEvent<SampleProgressEvent>).detail;
      if (!detail || typeof detail !== 'object') return;
      setProgress(detail);
    };
    window.addEventListener(eventName(), onUpdate as EventListener);
    onCleanup(() => window.removeEventListener(eventName(), onUpdate as EventListener));
  });

  return (
    <Show when={progress().status === 'loading'}>
      <div
        class="sample-progress"
        role="status"
        aria-live="polite"
        aria-label="Загрузка семплов"
        data-testid="sample-progress-badge"
      >
        <span class="sample-progress-label" data-testid="sample-progress-label">
          {progress().loaded}/{progress().total} семплов
        </span>
        <progress
          class="sample-progress-bar"
          data-testid="sample-progress-bar"
          value={progress().loaded}
          max={Math.max(1, progress().total)}
        />
      </div>
    </Show>
  );
}