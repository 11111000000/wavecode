/**
 * consoleGlobals — глобальные перехватчики ошибок, маршрутизирующие их
 * в consoleStore. Заменяет patch в DebugPanel.tsx, но без console.log
 * monkey-patching (за это отвечает logger из infrastructure/log — see
 * decisions/wavecode-log-pipeline.yaml).
 *
 * Подписываемся на:
 *   - 'error'              → window.onerror  (uncaught exceptions)
 *   - 'unhandledrejection' → Promise.reject без catch
 *   - 'keydown'            → toggle console via Cmd/Ctrl+` (backtick).
 *
 * Важно: ставим фильтр дублей по `fingerprint = title|body`. Один и тот
 * же TypeError может засыпать тост-стек сотнями копий; фильтруем через
 * TTL-window 1с.
 *
 * Hotkey (Phase-2 polish):
 *   DevTools-style: Cmd+` (Mac) / Ctrl+` (Win/Linux). Matches
 *   `consoleHotkey.matchesHotkey` semantics (metaKey||ctrlKey OR'd,
 *   no shift, no alt). Suppressed when focus is inside INPUT /
 *   TEXTAREA / contenteditable so the hotkey doesn't interfere with
 *   typing in the CodeMirror editor or any input field.
 */

import { consoleStore } from './consoleStore';
import { matchesHotkey } from './consoleHotkey';

const TOGGLE_HOTKEY = { key: '`', shift: false, alt: false } as const;

type GlobalsState = {
  installed: boolean;
  lastErrorAt: number;
  lastFingerprint: string;
  keydownListener: ((e: KeyboardEvent) => void) | null;
};

const state: GlobalsState = {
  installed: false,
  lastErrorAt: 0,
  lastFingerprint: '',
  keydownListener: null,
};

const DEDUPE_WINDOW_MS = 1000;

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  return false;
};

const onKeyDown = (e: KeyboardEvent): void => {
  if (isEditableTarget(e.target)) return;
  if (!matchesHotkey(e, TOGGLE_HOTKEY)) return;
  e.preventDefault();
  consoleStore.setConsoleOpen(!consoleStore.consoleOpen());
};

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

  window.addEventListener('keydown', onKeyDown);
  state.keydownListener = onKeyDown;
};

/**
 * Uninstall helper (used by hot-reload / tests). Safe to call when
 * not installed. Removes ONLY the keydown listener; the error /
 * unhandledrejection listeners are intentionally left in place
 * (they are page-lifetime via install-once semantics).
 */
export const uninstallConsoleGlobals = (): void => {
  if (!state.installed) return;
  if (typeof window === 'undefined') return;
  if (state.keydownListener !== null) {
    window.removeEventListener('keydown', state.keydownListener);
    state.keydownListener = null;
  }
};
