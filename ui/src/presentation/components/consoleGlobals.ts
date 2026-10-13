/**
 * consoleGlobals — глобальные перехватчики ошибок, маршрутизирующие их
 * в consoleStore. Заменяет patch в DebugPanel.tsx, но без console.log
 * monkey-patching (за это отвечает logger из Subagent 1).
 *
 * Подписываемся на:
 *   - 'error'            → window.onerror  (uncaught exceptions)
 *   - 'unhandledrejection' → Promise.reject без catch
 *
 * Важно: ставим фильтр дублей по `fingerprint = title|body`. Один и тот
 * же TypeError может засыпать тост-стек сотнями копий; фильтруем через
 * TTL-window 1с.
 */

import { consoleStore } from './consoleStore';

type GlobalsState = {
  installed: boolean;
  lastErrorAt: number;
  lastFingerprint: string;
};

const state: GlobalsState = {
  installed: false,
  lastErrorAt: 0,
  lastFingerprint: '',
};

const DEDUPE_WINDOW_MS = 1000;

const fingerprint = (a: string, b: string): string => `${a}|${b}`;

const formatErrorEvent = (e: ErrorEvent): { title: string; body: string } => {
  const message = e.message || String(e.error ?? 'unknown');
  let body = '';
  if (e.filename) body += `@ ${e.filename}`;
  if (typeof e.lineno === 'number') body += `:${e.lineno}`;
  if (!body && e.error instanceof Error) body = e.error.stack ?? '';
  return { title: 'JS error', body: `${message}${body ? '\n' + body : ''}` };
};

const formatRejection = (
  e: PromiseRejectionEvent,
): { title: string; body: string } => {
  const r = e.reason;
  if (r instanceof Error) {
    return { title: 'Unhandled rejection', body: `${r.message}\n${r.stack ?? ''}` };
  }
  return { title: 'Unhandled rejection', body: String(r) };
};

const pushIfFresh = (title: string, body: string): void => {
  const fp = fingerprint(title, body);
  const now = Date.now();
  if (fp === state.lastFingerprint && now - state.lastErrorAt < DEDUPE_WINDOW_MS) {
    return;
  }
  state.lastFingerprint = fp;
  state.lastErrorAt = now;
  consoleStore.pushToast({
    severity: 'error',
    title,
    body,
    source: 'window',
  });
};

export const installConsoleGlobals = (): void => {
  if (state.installed) return;
  if (typeof window === 'undefined') return;
  state.installed = true;

  window.addEventListener('error', (e: ErrorEvent) => {
    const { title, body } = formatErrorEvent(e);
    pushIfFresh(title, body);
  });

  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const { title, body } = formatRejection(e);
    pushIfFresh(title, body);
  });
};
