/**
 * ConsoleSheet — bottom-sheet UI для просмотра логов и ошибок.
 *
 * Source of truth: модуль `infrastructure/log/logger` (Subagent 1).
 * Когда этот модуль отсутствует (текущая master-ветка до merge'а),
 * ConsoleSheet корректно деградирует: bottom-sheet рендерится пустым,
 * подписки нет, copy / clear no-op. После merge'а достаточно
 * перезагрузить страницу — динамический import() подхватит модуль.
 *
 * Подписка:
 *   - logger.setSink(cb) вызывается на каждый push() из console-патча.
 *     Sink bump-ит сигнал `sinkTick` → реактивно перечитываем
 *     `getBuffer()` через createMemo.
 *   - Polling fallback не нужен — sink даёт immediate update. Если
 *     logger-модуль отсутствует, sinkTick остаётся в покое,
 *     getBuffer() возвращает [].
 *
 * Boot restore (Phase 3 — Subagent 13):
 *   - На onMount, после того как динамический import() разрешился,
 *     вызываем logger.loadPersistedErrors() и, если возвращён
 *     непустой слайс, logger.prepend(persisted). Это восстанавливает
 *     последнюю сотню ERROR/FATAL-записей из IDB (последний рестарт
 *     браузера не стирает историю ошибок). Sink bump-ит сигнал →
 *     ConsoleSheet сразу отображает их.
 *   - Любая ошибка загрузки (IDB недоступен, payload corrupt) ловится
 *     и глушится через console.warn — sheet не должен крашиться из-за
 *     persistence-layer.
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

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogEntry = {
  readonly id: number;
  readonly level: LogLevel;
  readonly text: string;
  readonly source: string;
  readonly ts: number;
};

type LogModule = {
  logger: {
    getBuffer(): readonly LogEntry[];
    clear(): void;
    install(): void;
    setSink(cb: ((e: LogEntry) => void) | null): void;
    loadPersistedErrors(): Promise<readonly LogEntry[]>;
    prepend(entries: readonly LogEntry[]): void;
  };
};

type LoggerState = {
  mod: LogModule | null;
  hasLogger: boolean;
};

let loggerState: LoggerState = { mod: null, hasLogger: false };

const LOG_MODULE_PATH = '~/infrastructure/log';

const [sinkTick, sinkTickSet] = createSignal(0);

const logModulePromise: Promise<void> = (async () => {
  try {
    const mod = (await import(
      /* @vite-ignore */ LOG_MODULE_PATH
    )) as unknown as LogModule;
    loggerState = { mod, hasLogger: true };
    mod.logger.install();
    mod.logger.setSink(() => {
      sinkTickSet((n) => n + 1);
    });
    sinkTickSet((n) => n + 1);
  } catch {
    loggerState = { mod: null, hasLogger: false };
  }
})();

void logModulePromise;

const safeReadBuffer = (): readonly LogEntry[] => {
  if (!loggerState.hasLogger || loggerState.mod === null) return [];
  try {
    return loggerState.mod.logger.getBuffer();
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
  if (loggerState.hasLogger && loggerState.mod) {
    try { loggerState.mod.logger.clear(); } catch { /* */ }
  }
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
    void (async () => {
      try {
        // Wait for the module-load IIFE to finish (it may still be
        // in flight when the very first sheet mounts). Once
        // loggerState.mod is set, we can call loadPersistedErrors
        // and prepend on it.
        await logModulePromise;
        if (!loggerState.hasLogger || loggerState.mod === null) return;
        const persisted =
          await loggerState.mod.logger.loadPersistedErrors();
        if (persisted.length === 0) return;
        loggerState.mod.logger.prepend(persisted);
        sinkTickSet((n) => n + 1);
      } catch (err) {
        try {
          console.warn(
            '[ConsoleSheet] failed to load persisted errors:',
            err,
          );
        } catch {
          /* logger.warn itself may be unavailable in some envs */
        }
      }
    })();
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
        data-has-logger={loggerState.hasLogger ? 'true' : 'false'}
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

          <Show when={!loggerState.hasLogger}>
            <div class="console-empty-warning" data-testid="console-empty-warning">
              Logger module not installed — sheet is empty.
              Logs will appear once the Subagent-1 infra log lands.
            </div>
          </Show>

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
