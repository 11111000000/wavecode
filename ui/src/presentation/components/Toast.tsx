/**
 * Toast — стек popover-уведомлений в правом-верхнем углу (desktop)
 * или full-width strip сверху (mobile).
 *
 * Один компонент «глобальный» — навешивается один раз в App.tsx; читает
 * состояние напрямую из consoleStore. Никаких props.
 *
 * Семантика:
 *   - 'info' / 'warn'             — silent auto-dismiss (Toast всё равно
 *                                    показывает, но без цветовой агрессии).
 *   - 'error' / 'critical'        — кликабельный, открывает ConsoleSheet,
 *                                    severity цвет, на 'critical' — sticky.
 *
 * Sample-load progress hook: подписывается на
 * `wavecode:sample-progress` и при `status: 'loaded'` пушит
 * однократный info-toast «Сэмплы загружены (N/N)». На status='error'
 * пушит warn-toast «Не удалось загрузить все сэмплы». 'loading' события
 * игнорируются — прогресс показывает SampleProgressBadge в TabBar.
 */

import { type JSX, For, Show, onCleanup, onMount, createMemo } from 'solid-js';
import { consoleStore, type Toast, type ToastSeverity } from './consoleStore';
import { CloseIcon, PinIcon } from '../icons';
import {
  SAMPLE_PROGRESS_EVENT,
  type SampleProgressEvent,
} from '../../infrastructure/audio/sampleProgressEvent';

const SEVERITY_TOKEN: Readonly<Record<ToastSeverity, string>> = {
  info: 'info',
  warn: 'warn',
  error: 'err',
  critical: 'critical',
};

const SEVERITY_ICON: Readonly<Record<ToastSeverity, string>> = {
  info: 'ℹ',
  warn: '⚠',
  error: '✕',
  critical: '!',
};

function severityToTone(s: ToastSeverity): string {
  return SEVERITY_TOKEN[s];
}

type ToastItemProps = {
  toast: Toast;
};

function ToastItem(props: ToastItemProps): JSX.Element {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const isSticky = (): boolean => props.toast.ttlMs === 0;
  const isError = (): boolean =>
    props.toast.severity === 'error' || props.toast.severity === 'critical';

  onMount(() => {
    if (!isSticky() && props.toast.ttlMs > 0) {
      timer = setTimeout(() => {
        consoleStore.dismissToast(props.toast.id);
      }, props.toast.ttlMs);
    }
  });

  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer);
  });

  const onClick = (): void => {
    if (!isError()) return;
    consoleStore.dismissToast(props.toast.id);
    consoleStore.setConsoleOpen(true);
  };

  return (
    <div
      class={`toast-item toast-${severityToTone(props.toast.severity)} ${isError() ? 'toast-clickable' : ''}`}
      role={isError() ? 'button' : 'status'}
      tabindex={isError() ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e: KeyboardEvent) => {
        if (isError() && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <span class="toast-icon" aria-hidden="true">
        {SEVERITY_ICON[props.toast.severity]}
      </span>
      <span class="toast-body">
        <span class="toast-title">{props.toast.title}</span>
        <Show when={props.toast.body}>
          <span class="toast-message">{props.toast.body}</span>
        </Show>
        <Show when={props.toast.source}>
          <span class="toast-source">[{(props.toast.source as string)}]</span>
        </Show>
      </span>
      <Show when={isSticky()}>
        <span class="toast-pin" aria-label="sticky">
          <PinIcon size={12} />
        </span>
      </Show>
      <button
        type="button"
        class="toast-close"
        aria-label="Dismiss notification"
        onClick={(e: MouseEvent) => {
          e.stopPropagation();
          consoleStore.dismissToast(props.toast.id);
        }}
      >
        <CloseIcon size={12} />
      </button>
    </div>
  );
}

export function Toast(): JSX.Element {
  const items = createMemo(() => consoleStore.toasts());
  onMount(() => {
    const onProgress = (e: Event): void => {
      const detail = (e as CustomEvent<SampleProgressEvent>).detail;
      if (!detail) return;
      if (detail.status === 'loaded' && detail.total > 0) {
        consoleStore.pushToast({
          severity: 'info',
          title: 'Сэмплы загружены',
          body: `${detail.loaded}/${detail.total} готовы к воспроизведению`,
          source: 'samples',
        });
      } else if (detail.status === 'error' && detail.total > 0) {
        consoleStore.pushToast({
          severity: 'warn',
          title: 'Сэмплы загружены частично',
          body: `${detail.loaded}/${detail.total} — некоторые банки пропущены`,
          source: 'samples',
        });
      }
      // 'loading' / 'idle' — no toast; progress lives in SampleProgressBadge.
    };
    window.addEventListener(SAMPLE_PROGRESS_EVENT, onProgress as EventListener);
    onCleanup(() => window.removeEventListener(SAMPLE_PROGRESS_EVENT, onProgress as EventListener));
  });
  return (
    <div class="toast-stack" role="region" aria-label="Notifications">
      <For each={items()}>{(t) => <ToastItem toast={t} />}</For>
    </div>
  );
}
