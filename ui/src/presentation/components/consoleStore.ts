/**
 * consoleStore — сигнал-стор для уведомлений и ошибок wavecode.
 *
 * wavecode-zen-ui-phases-6-7 (фаза 6, «Тишина»): уведомления
 * разведены по двум каналам.
 *
 *   - toasts()  — мимолётные сообщения (severity 'info' / 'warn').
 *                 В интерфейсе виден ОДИН — самый свежий: стек
 *                 тостов это шум, а не информация. Стор хранит до
 *                 четырёх (как раньше) — админка показывает историю.
 *   - errors()  — ошибки (severity 'error' / 'critical' / 'fatal').
 *                 Живут до явного закрытия, показываются ОДНИМ
 *                 регионом внизу холста (см. ErrorRegion.tsx).
 *
 * ВАЖНО: информационные 'info' / 'warn' тосты НЕ увеличивают
 * `unreadErrors`. Только `severity ∈ {'error', 'critical', 'fatal'}` —
 * иначе пользователь не сможет фильтровать шум.
 *
 * 'fatal' добавлен в Phase-2 как часть console UX polish
 * (see decisions/wavecode-logger-enhancements.yaml):
 * - LogLevel-union расширен в `infrastructure/log/logger.ts`.
 * - Treat 'fatal' as equal-to 'critical' here: sticky TTL, increments
 *   unreadErrors. `pushToast({ severity: 'fatal' })` уже валиден по типу.
 *
 * setConsoleOpen(true) побочно вызывает markAllRead — удобно для UI,
 * которому достаточно одного вызова при открытии sheet'а.
 *
 * ДЕЙСТВИЕ «ПОВТОРИТЬ»: у ошибки может быть поле `action` — подпись и
 * функция. Регион ошибок рисует из неё кнопку. Это единственный
 * честный способ предложить повтор: ошибка сама знает, что именно
 * сломалось (см. audioActions.ts — перезапуск оценки партитуры).
 */

import { nanoid } from 'nanoid';
import { createSignal } from 'solid-js';

export type ToastSeverity = 'info' | 'warn' | 'error' | 'critical' | 'fatal';

/** Действие, которое регион ошибок превращает в кнопку «Повторить». */
export type ToastAction = {
  readonly label: string;
  readonly run: () => void;
};

export type Toast = {
  readonly id: string;
  readonly severity: ToastSeverity;
  readonly title: string;
  readonly body?: string;
  readonly source?: string;
  readonly createdAt: number;
  readonly ttlMs: number;
  readonly action?: ToastAction;
};

export type ToastInput =
  Omit<Toast, 'id' | 'createdAt' | 'ttlMs'> & { ttlMs?: number };

/**
 * Сколько мимолётных тостов помнит стор. В интерфейсе виден один,
 * но админка показывает историю целиком — четыре достаточно.
 */
const MAX_TOASTS = 4;

/**
 * Ошибок в регионе не сорок: держим пять последних, показываем
 * самый свежий. Полная история — в консоли (ConsoleSheet) и в
 * журнале логгера.
 */
const MAX_ERRORS = 5;

const TOAST_DEFAULT_TTL: Readonly<Record<ToastSeverity, number>> = {
  info: 4000,
  warn: 6000,
  // Ошибка в регионе не исчезает сама — её закрывают руками.
  error: 0,
  critical: 0,
  fatal: 0,
};

const [toasts, setToasts] = createSignal<readonly Toast[]>([]);
const [errors, setErrors] = createSignal<readonly Toast[]>([]);
const [consoleOpen, setConsoleOpenSignal] = createSignal(false);
const [unreadErrors, setUnreadErrors] = createSignal(0);

const isErrorSeverity = (s: ToastSeverity): boolean =>
  s === 'error' || s === 'critical' || s === 'fatal';

/**
 * Обрезка очереди тостов: сначала уходят «липкие» (ttlMs === 0),
 * и только если таких нет — самые старые. Липкий тост не должен
 * вытесняться обычным: он тоже важен, просто живёт дольше.
 */
const capToasts = (next: readonly Toast[]): readonly Toast[] => {
  if (next.length <= MAX_TOASTS) return next;

  const dropFirstNonSticky = (
    arr: readonly Toast[],
  ): readonly Toast[] | null => {
    const idx = arr.findIndex((t) => t.ttlMs !== 0);
    return idx === -1 ? null : [...arr.slice(0, idx), ...arr.slice(idx + 1)];
  };

  let cur: readonly Toast[] = next;
  while (cur.length > MAX_TOASTS) {
    const dropped = dropFirstNonSticky(cur);
    if (dropped === null) {
      cur = cur.slice(cur.length - MAX_TOASTS);
      break;
    }
    cur = dropped;
  }
  return cur;
};

const setConsoleOpen = (open: boolean): void => {
  setConsoleOpenSignal(open);
  if (open) setUnreadErrors(0);
};

export const consoleStore = {
  toasts,
  errors,
  consoleOpen,
  setConsoleOpen,
  unreadErrors,

  pushToast(input: ToastInput): string {
    const severity = input.severity;
    const ttlMs = input.ttlMs ?? TOAST_DEFAULT_TTL[severity];
    const toast: Toast = {
      id: nanoid(8),
      severity,
      title: input.title,
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.action !== undefined ? { action: input.action } : {}),
      createdAt: Date.now(),
      ttlMs,
    };
    if (isErrorSeverity(severity)) {
      // Новые ошибки сверху: регион показывает самую свежую.
      // Повтор той же ошибки (тот же источник и тот же текст) НЕ
      // добавляется вторым элементом — он заменяет предыдущий,
      // сохраняя id. Иначе регион «дёргался» бы на каждой неудачной
      // оценке партитуры и зря перечитывал бы сообщение скринридером.
      setErrors((prev) => {
        const head = prev[0];
        if (
          head !== undefined &&
          head.source === toast.source &&
          head.title === toast.title &&
          head.body === toast.body
        ) {
          return [{ ...toast, id: head.id }, ...prev.slice(1)];
        }
        return [toast, ...prev].slice(0, MAX_ERRORS);
      });
      setUnreadErrors((n) => n + 1);
    } else {
      setToasts((prev) => capToasts([...prev, toast]));
    }
    return toast.id;
  },

  /** Закрыть сообщение по id — из того канала, где оно лежит. */
  dismissToast(id: string): void {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    setErrors((prev) => prev.filter((t) => t.id !== id));
  },

  /** Закрыть конкретную ошибку (регион ошибок). */
  dismissError(id: string): void {
    setErrors((prev) => prev.filter((t) => t.id !== id));
  },

  clearToasts(): void {
    setToasts([]);
  },

  clearErrors(): void {
    setErrors([]);
  },

  markAllRead(): void {
    setUnreadErrors(0);
  },

  reset(): void {
    setToasts([]);
    setErrors([]);
    setConsoleOpenSignal(false);
    setUnreadErrors(0);
  },
} as const;

export const toastError = (opts: {
  title: string;
  body?: string;
  source?: string;
  action?: ToastAction;
}): string =>
  consoleStore.pushToast({
    severity: 'error',
    title: opts.title,
    ...(opts.body !== undefined ? { body: opts.body } : {}),
    ...(opts.source !== undefined ? { source: opts.source } : {}),
    ...(opts.action !== undefined ? { action: opts.action } : {}),
  });
