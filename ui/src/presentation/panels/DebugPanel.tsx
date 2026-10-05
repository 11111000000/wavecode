/**
 * DebugPanel — overlay для отладки на мобильном (где нет DevTools).
 *
 * Показывает:
 *   - Последние console.log/warn/error/info сообщения
 *   - window.onerror / unhandledrejection (uncaught errors)
 *   - AudioContext state (suspended/running/closed)
 *   - Cyclist state (если доступен)
 *   - Oscillator count (через AudioContext)
 *
 * Включается через toggle (Ctrl+Shift+D для показа/скрытия).
 */

import { createSignal, onMount, onCleanup, For, Show } from 'solid-js';

type LogLevel = 'log' | 'info' | 'warn' | 'error';
type LogEntry = {
  readonly id: number;
  readonly level: LogLevel;
  readonly text: string;
  readonly ts: number;
};

type DebugState = {
  logs: LogEntry[];
  errors: { readonly message: string; readonly source?: string; readonly line?: number }[];
  audioContextState: AudioContextState | 'none';
  audioContextSampleRate: number | null;
  oscillatorCount: number;
  cyclistStarted: boolean | null;
  lastUpdate: number;
};

const MAX_LOGS = 100;
const MAX_ERRORS = 20;

const [debugState, setDebugState] = createSignal<DebugState>({
  logs: [],
  errors: [],
  audioContextState: 'none',
  audioContextSampleRate: null,
  oscillatorCount: 0,
  cyclistStarted: null,
  lastUpdate: Date.now(),
});

let nextId = 1;

const appendLog = (level: LogLevel, args: unknown[]): void => {
  const text = args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
  const id = nextId++;
  const entry: LogEntry = { id, level, text, ts: Date.now() };
  setDebugState((s) => ({
    ...s,
    logs: [...s.logs, entry].slice(-MAX_LOGS),
    lastUpdate: entry.ts,
  }));
};

const appendError = (err: { message: string; source?: string; line?: number }): void => {
  setDebugState((s) => ({
    ...s,
    errors: [...s.errors, err].slice(-MAX_ERRORS),
    lastUpdate: Date.now(),
  }));
};

export const debugState_ = debugState; // for other components to read

export const DebugPanel = () => {
  const [open, setOpen] = createSignal(false);

  onMount(() => {
    // Patch console
    const origLog = console.log;
    const origInfo = console.info;
    const origWarn = console.warn;
    const origError = console.error;
    const autoOpen = () => setOpen(true);
    console.log = (...a: unknown[]) => { appendLog('log', a); origLog.apply(console, a); };
    console.info = (...a: unknown[]) => { appendLog('info', a); origInfo.apply(console, a); };
    console.warn = (...a: unknown[]) => { appendLog('warn', a); origWarn.apply(console, a); };
    console.error = (...a: unknown[]) => {
      appendLog('error', a);
      autoOpen();
      origError.apply(console, a);
    };

    // Catch uncaught errors — auto-open overlay
    const onError = (e: ErrorEvent) => {
      appendError({
        message: e.message || String(e.error),
        source: e.filename,
        line: e.lineno,
      });
      autoOpen();
    };
    const onUnhandled = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const message = reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : String(reason);
      appendError({ message });
      autoOpen();
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandled);

    // Toggle shortcut: Ctrl+Shift+D
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);

    onCleanup(() => {
      console.log = origLog;
      console.info = origInfo;
      console.warn = origWarn;
      console.error = origError;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandled);
      window.removeEventListener('keydown', onKey);
    });
  });

  // Periodic poll of audio context state.
  onMount(() => {
    const id = window.setInterval(() => {
      // Find any AudioContext (we may have one in LiveAudioEngine).
      // We stash a reference on globalThis.__ac on creation. Fallback: scan.
      const ac = (globalThis as { __ac?: AudioContext }).__ac
        ?? (globalThis as { audioContext?: AudioContext }).audioContext;

      // Strudel internals — scan globals for AudioContext.
      const scanned = (() => {
        // We can't easily find it; rely on __ac stash or skip.
        return null as AudioContext | null;
      })();

      const targetAc = ac ?? scanned;
      let state: AudioContextState | 'none' = 'none';
      let sr: number | null = null;
      let oscCount = 0;
      if (targetAc) {
        state = targetAc.state;
        sr = targetAc.sampleRate;
        // Count oscillator-like nodes (not super reliable, but indicative).
        try {
          oscCount = (targetAc as unknown as { _activeSources?: number })._activeSources ?? 0;
        } catch {
          oscCount = 0;
        }
      }

      setDebugState((s) => ({
        ...s,
        audioContextState: state,
        audioContextSampleRate: sr,
        oscillatorCount: oscCount,
        lastUpdate: Date.now(),
      }));
    }, 1000);

    onCleanup(() => window.clearInterval(id));
  });

  return (
    <Show when={open()}>
      <div class="debug-overlay">
        <header class="debug-header">
          <span class="debug-title">🐛 Отладка</span>
          <span class="debug-meta">
            AudioContext: <strong>{debugState().audioContextState}</strong>
            {' · '}: <strong>{debugState().audioContextSampleRate ?? '?'}</strong>
            {' · '}osc: <strong>{debugState().oscillatorCount}</strong>
          </span>
          <button
            type="button"
            class="debug-copy"
            onClick={() => {
              const text = debugState()
                .logs.map((l) => `[${l.level}] ${new Date(l.ts).toISOString()} ${l.text}`)
                .concat(debugState().errors.map((e) => `[ERR] ${e.message}`))
                .join('\n');
              void navigator.clipboard?.writeText(text);
            }}
          >
            Скопировать
          </button>
          <button type="button" onClick={() => setOpen(false)}>×</button>
        </header>

        <Show when={debugState().errors.length > 0}>
          <details class="debug-errors" open>
            <summary>Ошибки ({debugState().errors.length})</summary>
            <ul>
              <For each={debugState().errors}>
                {(e) => (
                  <li class="debug-error">
                    <strong>{e.message}</strong>
                    <Show when={e.source}>
                      <span class="debug-source">
                        {' '}@ {e.source}:{e.line}
                      </span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </details>
        </Show>

        <details class="debug-logs" open>
          <summary>Журналы ({debugState().logs.length})</summary>
          <ol class="debug-log-list">
            <For each={debugState().logs.slice().reverse()}>
              {(l) => (
                <li class={`debug-log debug-log-${l.level}`}>
                  <span class="debug-log-meta">[{l.level}]</span> {l.text}
                </li>
              )}
            </For>
          </ol>
        </details>
      </div>
    </Show>
  );
};

// Stash AudioContext when created (so DebugPanel can find it).
export const debugStashAudioContext = (ac: AudioContext): void => {
  (globalThis as unknown as { __ac: AudioContext }).__ac = ac;
};
