/**
 * Toast — ОДИН мимолётный тост.
 *
 * wavecode-zen-ui-phases-6-7 (фаза 6, «Тишина»): раньше это был стек
 * popover-уведомлений в правом-верхнем углу, где одновременно могло
 * лежать четыре плашки. Сейчас тост максимум один (новый вытесняет
 * старый), а всё, что требует внимания, ушло в регион ошибок
 * (см. ErrorRegion.tsx).
 *
 * Семантика:
 *   - 'info' / 'warn'  — мимолётное сообщение, само исчезает;
 *   - 'error' / 'critical' / 'fatal' — НЕ приходят сюда: их показывает
 *     регион ошибок внизу холста, у него есть «Повторить».
 *
 * Severity icon: для color-blind accessibility severity кодируется
 * двумя независимыми сигналами — цветом (border-left + background
 * tint) И иконкой слева. Иконка рендерится как SVG с currentColor в
 * видимом квадрате 20×20 (стиль `.toast-icon`), наследует цвет от
 * родителя (severity-tokens).
 *
 * Счётчик сэмплов раньше тоже приходил сюда («Сэмплы загружены»).
 * Теперь он живёт в строке статуса верхней панели — в одном месте
 * с индикатором офлайна (см. StatusStrip.tsx).
 */

import { type JSX, Show, onCleanup, onMount, createMemo } from 'solid-js';
import { consoleStore, type Toast, type ToastSeverity } from './consoleStore';
import {
  CloseIcon,
  InfoIcon,
  WarnIcon,
} from '../icons';

const SEVERITY_TOKEN: Readonly<Record<ToastSeverity, string>> = {
  info: 'info',
  warn: 'warn',
  error: 'err',
  critical: 'critical',
  fatal: 'fatal',
};

const SEVERITY_ICON_JSX: Readonly<
  Record<'info' | 'warn', (size: number) => JSX.Element>
> = {
  info: (size) => <InfoIcon size={size} />,
  warn: (size) => <WarnIcon size={size} />,
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

  onMount(() => {
    if (props.toast.ttlMs > 0) {
      timer = setTimeout(() => {
        consoleStore.dismissToast(props.toast.id);
      }, props.toast.ttlMs);
    }
  });

  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer);
  });

  const tone = (): 'info' | 'warn' => (
    props.toast.severity === 'warn' ? 'warn' : 'info'
  );

  return (
    <div
      class={`toast-item toast-${severityToTone(props.toast.severity)}`}
      role="status"
      data-severity={props.toast.severity}
      data-testid="toast-item"
    >
      <span class="toast-icon" aria-hidden="true">
        {SEVERITY_ICON_JSX[tone()](TOAST_ICON_SIZE)}
      </span>
      <Show when={props.toast.ttlMs === 0}>
        <span class="toast-pin" aria-label="Не исчезает" title="Не исчезает" />
      </Show>
      <span class="toast-body">
        <span class="toast-title">{props.toast.title}</span>
        <Show when={props.toast.body}>
          <span class="toast-message">{props.toast.body}</span>
        </Show>
      </span>
      <button
        type="button"
        class="toast-close"
        aria-label="Закрыть уведомление"
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
  // Стор помнит до четырёх мимолётных тостов (история нужна
  // админке), но в интерфейсе виден только самый свежий: стек
  // тостов — это шум.
  const latest = createMemo(() => {
    const list = consoleStore.toasts();
    return list[list.length - 1];
  });
  return (
    <div class="toast-stack" role="region" aria-label="Уведомления">
      <Show when={latest()}>
        {(t) => <ToastItem toast={t()} />}
      </Show>
    </div>
  );
}
