import { createSignal, For, Show } from 'solid-js';
import { Effect } from 'effect';
import { dispatch } from '../state/appStore';
import { AppLayer } from '~/infrastructure/composition';
import { AudioEngine } from '~/domain/services';
import { applyEdit } from '~/application/useCases/llmEdit';

/**
 * Минимальный AI REPL.
 *
 *   ┌──────────────────────────────────────────┐
 *   │ [textarea: инструкция на русском]       │
 *   │ [✦ Применить]  [Очистить]   [статус]    │
 *   │ ────────────────────────────────────────  │
 *   │ Log (последние N записей):              │
 *   │  14:32:01 "сделай быстрее"  → OK playing│
 *   │  14:31:45 "добавь бас"       → Err: ...  │
 *   └──────────────────────────────────────────┘
 *
 * Действие: LLM правит score → заменяет в store → авто-eval → играет.
 */

type LogEntry = {
  readonly id: number;
  readonly ts: number;
  readonly instruction: string;
  readonly status: 'busy' | 'ok' | 'err';
  readonly message: string;
  readonly audioStatus: 'playing' | 'stopped' | 'error';
};

const MAX_LOG = 8;
let nextLogId = 1;

export function ReplPanel() {
  const [instruction, setInstruction] = createSignal('');
  const [log, setLog] = createSignal<LogEntry[]>([]);
  const [busy, setBusy] = createSignal(false);

  const appendLog = (entry: Omit<LogEntry, 'id'>): void => {
    const e: LogEntry = { id: nextLogId++, ...entry };
    setLog((prev) => [e, ...prev].slice(0, MAX_LOG));
  };

  const submit = async () => {
    const text = instruction().trim();
    if (!text || busy()) return;
    setBusy(true);
    const ts = Date.now();
    appendLog({ ts, instruction: text, status: 'busy', message: 'Отправляю в ИИ…', audioStatus: 'stopped' });

    try {
      const newScore = await Effect.runPromise(
        Effect.gen(function* () {
          const result = yield* applyEdit(/* placeholder */ '', text);
          return result;
        }).pipe(Effect.provide(AppLayer)),
      );

      // Replace score in store
      dispatch({ type: 'replaceScore', text: newScore });

      // Auto-eval the new score
      let audioStatus: 'playing' | 'stopped' | 'error' = 'playing';
      let audioMessage = '';
      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const audio = yield* AudioEngine;
            yield* audio.eval(newScore);
          }).pipe(Effect.provide(AppLayer)),
        );
        dispatch({ type: 'audioStatusChange', status: 'playing' });
      } catch (audioErr) {
        audioStatus = 'error';
        audioMessage = audioErr instanceof Error ? audioErr.message : String(audioErr);
        dispatch({
          type: 'audioStatusChange',
          status: 'error',
          error: audioMessage,
        });
      }

      // Update log entry with result
      setLog((prev) =>
        prev.map((e) =>
          e.id === (nextLogId - 1)
            ? { ...e, status: 'ok', message: newScore.slice(0, 200), audioStatus }
            : e,
        ),
      );

      setInstruction('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendLog({ ts, instruction: text, status: 'err', message: msg, audioStatus: 'stopped' });
    } finally {
      setBusy(false);
    }
  };

  const fmtTime = (ts: number): string => {
    const d = new Date(ts);
    return d.toTimeString().slice(0, 8);
  };

  return (
    <div class="repl-panel-inner">
      <textarea
        aria-label="Инструкция для ИИ"
        data-repl-textarea
        placeholder='Инструкция ИИ на русском: "сделай быстрее", "добавь бас", "техно-бит"…'
        value={instruction()}
        onInput={(e) => setInstruction(e.currentTarget.value)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter') && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={2}
        style={textareaStyle}
      />
      <div style={{ display: 'flex', gap: '8px', 'margin-top': '8px', 'align-items': 'center' }}>
        <button type="button" onClick={submit} disabled={busy()}>
          {busy() ? '⏳ Думаю…' : '✦ Применить'}
        </button>
        <button type="button" disabled={busy()} onClick={() => setInstruction('')}>
          Очистить
        </button>
        <Show when={busy() || log().length > 0}>
          <span style={{
            color: busy() ? 'var(--warn)' : 'var(--fg-dim)',
            'font-size': '11px',
            'margin-left': 'auto',
          }}>
            {busy() ? '⏳ LLM думает…' : `${log().length} записей`}
          </span>
        </Show>
      </div>
      <Show when={log().length > 0}>
        <ol class="repl-log">
          <For each={log()}>
            {(entry) => (
              <li class={`repl-log-row status-${entry.status}`}>
                <span class="repl-log-time">{fmtTime(entry.ts)}</span>
                <span class="repl-log-icon">
                  {entry.status === 'ok' ? '✓' : entry.status === 'err' ? '✗' : '⏳'}
                </span>
                <span class="repl-log-instruction">"{entry.instruction.slice(0, 60)}"</span>
                <Show when={entry.status === 'ok'}>
                  <span class={`repl-log-audio status-${entry.audioStatus}`}>
                    ♪ {entry.audioStatus === 'playing' ? 'играет' : entry.audioStatus}
                  </span>
                </Show>
                <Show when={entry.status === 'err'}>
                  <span class="repl-log-error">{entry.message.slice(0, 200)}</span>
                </Show>
              </li>
            )}
          </For>
        </ol>
      </Show>
    </div>
  );
}

const textareaStyle = {
  width: '100%',
  background: 'var(--bg-elev)',
  color: 'var(--fg)',
  border: '1px solid var(--border)',
  'border-radius': '4px',
  padding: '6px 10px',
  'font-size': '13px',
  'font-family': 'inherit',
  resize: 'vertical' as const,
  'box-sizing': 'border-box' as const,
  'min-height': '48px',
  'max-height': '120px',
};