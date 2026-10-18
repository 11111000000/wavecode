/**
 * consoleStore — сигнал-стор для UI-консоли wavecode.
 *
 * Три независимых сигнала:
 *   - toasts()      — массив текущих popovers (FIFO, capped at MAX_TOASTS).
 *   - consoleOpen() — открыт ли bottom-sheet с логами.
 *   - unreadErrors()— счётчик ошибок, накопленных с момента последнего
 *                     `markAllRead` (используется для красной пульсации
 *                     кнопки ConsoleButton).
 *
 * ВАЖНО: информационные 'info' / 'warn' тосты НЕ увеличивают
 * `unreadErrors`. Только `severity ∈ {'error', 'critical', 'fatal'}` —
 * иначе пользователь не сможет фильтровать шум.
 *
 * 'fatal' добавлен в Phase-2 как часть console UX polish
 * (see decisions/wavecode-logger-enhancements.yaml):
 * - LogLevel-union расширен в `infrastructure/log/logger.ts`.
 * - Treat 'fatal' as equal-to 'critical' here: sticky TTL, increments
 *   unreadErrors, clickable to open the sheet. `pushToast({ severity: 'fatal' })`
 *   уже валиден по типу.
 *
 * setConsoleOpen(true) побочно вызывает markAllRead — удобно для UI,
 * которому достаточно одного вызова при открытии sheet'а.
 */

import { nanoid } from 'nanoid';
import { createSignal } from 'solid-js';

export type ToastSeverity = 'info' | 'warn' | 'error' | 'critical' | 'fatal';

export type Toast = {
  readonly id: string;
  readonly severity: ToastSeverity;
  readonly title: string;
  readonly body?: string;
  readonly source?: string;
  readonly createdAt: number;
  readonly ttlMs: number;
};

export type ToastInput =
  Omit<Toast, 'id' | 'createdAt' | 'ttlMs'> & { ttlMs?: number };

const MAX_TOASTS = 4;

const TOAST_DEFAULT_TTL: Readonly<Record<ToastSeverity, number>> = {
  info: 4000,
  warn: 6000,
  error: 8000,
  critical: 0,
  fatal: 0,
};

const [toasts, setToasts] = createSignal<readonly Toast[]>([]);
const [consoleOpen, setConsoleOpenSignal] = createSignal(false);
const [unreadErrors, setUnreadErrors] = createSignal(0);

const isErrorSeverity = (s: ToastSeverity): boolean =>
  s === 'error' || s === 'critical' || s === 'fatal';

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
      createdAt: Date.now(),
      ttlMs,
    };
    setToasts((prev) => capToasts([...prev, toast]));
    if (isErrorSeverity(severity)) {
      setUnreadErrors((n) => n + 1);
    }
    return toast.id;
  },

  dismissToast(id: string): void {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  },

  clearToasts(): void {
    setToasts([]);
  },

  markAllRead(): void {
    setUnreadErrors(0);
  },

  reset(): void {
    setToasts([]);
    setConsoleOpenSignal(false);
    setUnreadErrors(0);
  },
} as const;

export const toastError = (opts: {
  title: string;
  body?: string;
  source?: string;
}): string =>
  consoleStore.pushToast({
    severity: 'error',
    title: opts.title,
    ...(opts.body !== undefined ? { body: opts.body } : {}),
    ...(opts.source !== undefined ? { source: opts.source } : {}),
  });
