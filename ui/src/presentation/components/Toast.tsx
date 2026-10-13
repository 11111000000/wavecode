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
 *   - 'error' / 'critical' / 'fatal' — кликабельный, открывает ConsoleSheet,
 *                                    severity иконка + цвет, на 'critical' /
 *                                    'fatal' — sticky (TTL=0).
 *
 * Severity icon (Phase-2 polish):
 *   Для color-blind accessibility severity кодируется двумя независимыми
 *   сигналами — цветом (border-left + background tint) И иконкой слева.
 *   Иконка рендерится как SVG с currentColor в видимом квадрате 20×20
 *   (стиль `.toast-icon`), наследует цвет от родителя (severity-tokens).
 *   'fatal' реиспользует `CriticalIcon` (один и тот же визуальный
 *   канал; color-blind users уже видят sticky + clickable + icon).
 *
 *   Layout: иконка — слева от .toast-body. На десктопе иконка и
 *   заголовок/тело стоят в одной flex-row; на мобильном (узкий
 *   viewport) layout сохраняется (стек вертикальный, иконка в
 *   top-left угла).
 */

import { type JSX, For, Show, onCleanup, onMount, createMemo } from 'solid-js';
import { consoleStore, type Toast, type ToastSeverity } from './consoleStore';
import {
  CloseIcon,
  PinIcon,
  InfoIcon,
  WarnIcon,
  ErrorIcon,
  CriticalIcon,
} from '../icons';

const SEVERITY_TOKEN: Readonly<Record<ToastSeverity, string>> = {
  info: 'info',
  warn: 'warn',
  error: 'err',
  critical: 'critical',
  fatal: 'fatal',
};

const SEVERITY_ICON_JSX: Readonly<
  Record<ToastSeverity, (size: number) => JSX.Element>
> = {
  info: (size) => <InfoIcon size={size} />,
  warn: (size) => <WarnIcon size={size} />,
  error: (size) => <ErrorIcon size={size} />,
  critical: (size) => <CriticalIcon size={size} />,
  fatal: (size) => <CriticalIcon size={size} />,
};

/** Размер иконки внутри .toast-icon (квадрат 20×20, отступ 2px). */
const TOAST_ICON_SIZE = 16;

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
    props.toast.severity === 'error' ||
    props.toast.severity === 'critical' ||
    props.toast.severity === 'fatal';

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
      data-severity={props.toast.severity}
    >
      <span class="toast-icon" aria-hidden="true">
        {SEVERITY_ICON_JSX[props.toast.severity](TOAST_ICON_SIZE)}
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
  return (
    <div class="toast-stack" role="region" aria-label="Notifications">
      <For each={items()}>{(t) => <ToastItem toast={t} />}</For>
    </div>
  );
}
