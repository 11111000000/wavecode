import { Show, createMemo, type JSX } from 'solid-js';
import { consoleStore, type ToastSeverity } from './consoleStore';
import { CloseIcon, ErrorIcon, CriticalIcon } from '../icons';

/**
 * ErrorRegion — ЕДИНСТВЕННЫЙ регион ошибок приложения.
 *
 * wavecode-zen-ui-phases-6-7 (фаза 6, «Тишина»): раньше ошибка
 * показывалась сразу в трёх местах — ссылкой «⚠» на `/admin` в
 * верхней панели, плашкой тоста поверх неё и строкой «ошибка аудио»
 * в листе «Состояние». Теперь у ошибки одно место: полоса внизу
 * холста, от которой нельзя не заметить, но которая не перекрывает
 * редактор.
 *
 * Что здесь есть:
 *   - заголовок и текст последней ошибки;
 *   - «Повторить» — действие, которое сама ошибка предложила
 *     (см. `ToastAction` в consoleStore). Если действия нет — кнопки
 *     нет, а не «Повторить», которая ничего не повторяет;
 *   - «Подробнее» — открыть консоль с логами;
 *   - «×» — закрыть ошибку.
 *
 * Регион показывает ПОСЛЕДНЮЮ ошибку. Полная история — в консоли.
 */

const SEVERITY_ICON: Readonly<
  Record<ToastSeverity, (size: number) => JSX.Element>
> = {
  info: (size) => <ErrorIcon size={size} />,
  warn: (size) => <ErrorIcon size={size} />,
  error: (size) => <ErrorIcon size={size} />,
  critical: (size) => <CriticalIcon size={size} />,
  fatal: (size) => <CriticalIcon size={size} />,
};

export function ErrorRegion(): JSX.Element {
  const latest = createMemo(() => consoleStore.errors()[0]);
  const older = createMemo(() => Math.max(0, consoleStore.errors().length - 1));

  const onRetry = (): void => {
    const err = latest();
    if (!err) return;
    const action = err.action;
    consoleStore.dismissError(err.id);
    if (action) action.run();
  };

  return (
    <Show when={latest()}>
      {(err) => (
        <div
          class="wc-error-region"
          role="alert"
          data-testid="error-region"
          data-severity={err().severity}
        >
          <span class="wc-error-region__icon" aria-hidden="true">
            {SEVERITY_ICON[err().severity](16)}
          </span>
          <span class="wc-error-region__body">
            <span class="wc-error-region__title">{err().title}</span>
            <Show when={err().body}>
              <span class="wc-error-region__text">{err().body}</span>
            </Show>
          </span>
          <Show when={older() > 0}>
            <span class="wc-error-region__more">ещё {older()}</span>
          </Show>
          <Show when={err().action}>
            <button
              type="button"
              class="wc-error-region__btn"
              data-testid="error-retry"
              onClick={onRetry}
            >
              {err().action!.label}
            </button>
          </Show>
          <button
            type="button"
            class="wc-error-region__btn wc-error-region__btn--ghost"
            data-testid="error-details"
            onClick={() => consoleStore.setConsoleOpen(true)}
          >
            Подробнее
          </button>
          <button
            type="button"
            class="wc-error-region__close"
            data-testid="error-dismiss"
            aria-label="Закрыть ошибку"
            onClick={() => consoleStore.dismissError(err().id)}
          >
            <CloseIcon size={12} />
          </button>
        </div>
      )}
    </Show>
  );
}
