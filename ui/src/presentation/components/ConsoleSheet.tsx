/**
 * ConsoleSheet — bottom-sheet UI для просмотра логов и ошибок.
 *
 * Source of truth: модуль `infrastructure/log/logger`. Logger is installed
 * at boot (see `main.tsx`), so by the time this component evaluates the
 * ring buffer is already capturing every console.* call site-wide.
 *
 * Подписка:
 *   - logger.setSink(cb) вызывается один раз на module-load. Sink bump-ит
 *     сигнал `sinkTick` → реактивно перечитываем `getBuffer()` через
 *     createMemo. setSink может быть вызван ДО install (safe — просто
 *     сохраняет колбэк); install потом его подхватит.
 *   - Polling fallback не нужен — sink даёт immediate update.
 *
 * UI:
 *   - Mobile: bottom-sheet на 60vh / 90vh (через inline translateY).
 *   - Desktop ≥1024px: right-side drawer 480px (через .console-sheet).
 *   - Tabs: Errors | All logs | By source.
 *   - Footer: Copy as text | Clear | counts.
 */

import {
  type JSX, createSignal, onMount, For, Show, createMemo,
} from 'solid-js';
import { consoleStore } from './consoleStore';
import { CloseIcon } from '../icons';
import { installConsoleGlobals } from './consoleGlobals';
import { logger, type LogEntry } from '~/infrastructure/log';

const [sinkTick, sinkTickSet] = createSignal(0);

logger.setSink(() => {
  sinkTickSet((n) => n + 1);
});

const safeReadBuffer = (): readonly LogEntry[] => {
  try {
    return logger.getBuffer();
  } catch {
    return [];
  }
};

const readBuffer = createMemo<readonly LogEntry[]>(() => {
  sinkTick();
  return safeReadBuffer();
});

const formatTime = (ts: number): string => {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
};

const formatLine = (e: LogEntry): string =>
  `[${e.level.padEnd(5)}] ${formatTime(e.ts)} [${e.source}] ${e.text}`;

const copyToClipboard = async (text: string): Promise<void> => {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    }
  } catch {
    /* clipboard unavailable in some test envs — silently no-op */
  }
};

const handleClear = (): void => {
  try { logger.clear(); } catch { /* safety net for test mocks */ }
  sinkTickSet((n) => n + 1);
  consoleStore.clearToasts();
};

export function ConsoleSheet(): JSX.Element {
  const [activeTab, setActiveTab] = createSignal<
    'errors' | 'all' | 'by-source'
  >('errors');
  const [snap, setSnap] = createSignal<'mid' | 'full'>('mid');

  const errorsOnly = createMemo<readonly LogEntry[]>(() =>
    readBuffer().filter((e) => e.level === 'error' || e.level === 'warn'),
  );
  const all = createMemo<readonly LogEntry[]>(() =>
    readBuffer().slice().reverse(),
  );
  const bySource = createMemo<
    readonly { source: string; entries: readonly LogEntry[] }[]
  >(() => {
    const buf = readBuffer();
    const map = new Map<string, LogEntry[]>();
    for (const e of buf) {
      const k = e.source;
      const arr = map.get(k);
      if (arr) arr.push(e);
      else map.set(k, [e]);
    }
    return Array.from(map.entries())
      .map(([source, entries]) => ({
        source,
        entries: entries.slice().reverse(),
      }))
      .sort((a, b) => a.source.localeCompare(b.source));
  });

  const totals = createMemo(() => {
    const buf = readBuffer();
    const errCount = buf.filter((e) => e.level === 'error').length;
    return {
      total: buf.length,
      errors: errCount,
    };
  });

  onMount(() => {
    installConsoleGlobals();
  });

  const onClose = (): void => consoleStore.setConsoleOpen(false);

  const onCopy = async (): Promise<void> => {
    let text = '';
    if (activeTab() === 'errors') {
      text = errorsOnly().map(formatLine).join('\n');
    } else if (activeTab() === 'all') {
      text = all().map(formatLine).join('\n');
    } else {
      text = bySource()
        .flatMap((g) => [
          `=== [${g.source}] (${g.entries.length}) ===`,
          ...g.entries.map(formatLine),
        ])
        .join('\n');
    }
    await copyToClipboard(text);
  };

  const onBackdrop = (e: MouseEvent): void => {
    if (e.target === e.currentTarget) onClose();
  };

  const renderEntry = (e: LogEntry): JSX.Element => (
    <div class={`console-entry console-entry-${e.level}`}>
      <span class="console-entry-time">{formatTime(e.ts)}</span>
      <span class={`console-entry-level console-level-${e.level}`}>
        {e.level}
      </span>
      <span class="console-entry-source">[{e.source}]</span>
      <span class="console-entry-text">{e.text}</span>
    </div>
  );

  return (
    <Show when={consoleStore.consoleOpen()}>
      <div
        class="console-sheet"
        data-snap={snap()}
        role="dialog"
        aria-label="Console"
      >
        <div
          class="console-backdrop"
          onClick={onBackdrop}
          aria-hidden="true"
        />
        <div class="console-panel">
          <header class="console-header">
            <h2 class="console-title">Console</h2>
            <nav class="console-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab() === 'errors'}
                class={`console-tab ${
                  activeTab() === 'errors' ? 'console-tab-active' : ''
                }`}
                onClick={() => setActiveTab('errors')}
              >
                Errors ({errorsOnly().length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab() === 'all'}
                class={`console-tab ${
                  activeTab() === 'all' ? 'console-tab-active' : ''
                }`}
                onClick={() => setActiveTab('all')}
              >
                All logs
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab() === 'by-source'}
                class={`console-tab ${
                  activeTab() === 'by-source' ? 'console-tab-active' : ''
                }`}
                onClick={() => setActiveTab('by-source')}
              >
                By source
              </button>
            </nav>
            <button
              type="button"
              class="console-snap-btn"
              aria-label={
                snap() === 'mid' ? 'Expand to full' : 'Collapse to mid'
              }
              onClick={() => setSnap(snap() === 'mid' ? 'full' : 'mid')}
            >
              {snap() === 'mid' ? '↑↑' : '↓↓'}
            </button>
            <button
              type="button"
              class="console-close-btn"
              aria-label="Close console"
              onClick={onClose}
            >
              <CloseIcon size={14} />
            </button>
          </header>

          <div class="console-body" data-testid="console-body">
            <Show when={activeTab() === 'errors'}>
              <For
                each={errorsOnly().slice(-50)}
                fallback={
                  <div
                    class="console-empty"
                    data-testid="console-empty"
                  >
                    No errors.
                  </div>
                }
              >
                {(e) => renderEntry(e)}
              </For>
            </Show>

            <Show when={activeTab() === 'all'}>
              <For
                each={all().slice(0, 200)}
                fallback={
                  <div class="console-empty">No log entries yet.</div>
                }
              >
                {(e) => renderEntry(e)}
              </For>
            </Show>

            <Show when={activeTab() === 'by-source'}>
              <For
                each={bySource()}
                fallback={
                  <div class="console-empty">No log entries yet.</div>
                }
              >
                {(group) => (
                  <details class="console-group" open>
                    <summary class="console-group-summary">
                      <span class="console-group-name">[{group.source}]</span>
                      <span class="console-group-count">
                        {group.entries.length}
                      </span>
                    </summary>
                    <div class="console-group-body">
                      <For each={group.entries}>
                        {(e) => renderEntry(e)}
                      </For>
                    </div>
                  </details>
                )}
              </For>
            </Show>
          </div>

          <footer class="console-footer">
            <span class="console-counts">
              {totals().total} entries · {totals().errors} errors
            </span>
            <button
              type="button"
              class="wc-btn"
              data-size="sm"
              data-tone="ghost"
              data-testid="console-copy-btn"
              onClick={() => void onCopy()}
            >
              Copy as text
            </button>
            <button
              type="button"
              class="wc-btn"
              data-size="sm"
              data-tone="err"
              data-testid="console-clear-btn"
              onClick={handleClear}
            >
              Clear
            </button>
          </footer>
        </div>
      </div>
    </Show>
  );
}
