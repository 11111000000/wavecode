import { createSignal, Show } from 'solid-js';
import { Effect } from 'effect';
import { dispatch, appStore } from '../state/appStore';
import { AppLayer } from '~/infrastructure/composition';
import { AudioEngine } from '~/domain/services';
import { applyEdit, type DialogTurn } from '~/application/useCases/llmEdit';

/**
 * AI-редактор: пользователь пишет инструкцию на русском → LLM правит score → авто-eval.
 *
 * Workflow:
 *   1. User вводит запрос (например: "сделай быстрее и громче")
 *   2. applyEdit(currentScore, instruction, history) вызывает LLMClient
 *      С историей диалога — LLM помнит контекст (например "это Creep",
 *      "уже есть бас", и т.д.)
 *   3. LLM возвращает новый score (только JS-код)
 *   4. Заменяем score через dispatch({ type: 'replaceScore', text: ... })
 *   5. Автоматически вызываем AudioEngine.eval для воспроизведения
 *   6. Добавляем user/assistant turns в историю
 */

export function AIEditPanel() {
  const [instruction, setInstruction] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<{ kind: 'idle' | 'ok' | 'err'; msg: string }>({ kind: 'idle', msg: '' });
  const [history, setHistory] = createSignal<DialogTurn[]>([]);

  const submit = async () => {
    const text = instruction().trim();
    if (!text) return;
    setBusy(true);
    setStatus({ kind: 'idle', msg: 'Отправляю в ИИ…' });

    // Build history — last 10 turns
    const hist = history().slice(-10);
    const currentInstruction = text;

    try {
      const newScore = await Effect.runPromise(
        Effect.gen(function* () {
          const result = yield* applyEdit(
            appStore.score,
            currentInstruction,
            hist,
            {
              status: appStore.audio.status,
              ...(appStore.audio.lastError ? { lastError: appStore.audio.lastError } : {}),
            },
          );
          return result;
        }).pipe(Effect.provide(AppLayer)),
      );

      // Replace score in store
      dispatch({ type: 'replaceScore', text: newScore });

      // Update history: add user + assistant turn
      setHistory([
        ...hist,
        { role: 'user', content: currentInstruction },
        { role: 'assistant', content: newScore },
      ]);

      dispatch({ type: 'agentStatusChange', status: 'idle' });

      // Auto-eval the new score
      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const audio = yield* AudioEngine;
            yield* audio.eval(newScore);
          }).pipe(Effect.provide(AppLayer)),
        );
        dispatch({ type: 'audioStatusChange', status: 'playing' });
        setStatus({ kind: 'ok', msg: 'Применено и играет ✓' });
      } catch (audioErr) {
        dispatch({
          type: 'audioStatusChange',
          status: 'error',
          error: audioErr instanceof Error ? audioErr.message : String(audioErr),
        });
        setStatus({ kind: 'err', msg: 'ИИ ответил, но ошибка аудио: ' + (audioErr instanceof Error ? audioErr.message : String(audioErr)) });
      }

      setInstruction('');
    } catch (err) {
      setStatus({ kind: 'err', msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="ai-edit-panel-inner">
      <textarea
        aria-label="Инструкция для ИИ"
        placeholder='Например: "сделай быстрее в два раза", "сделай техно-бит", "добавь басов"'
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
          {busy() ? '⏳ Применяю…' : '✦ Применить правку ИИ'}
        </button>
        <button
          type="button"
          disabled={busy()}
          onClick={() => setInstruction('')}
        >
          Очистить
        </button>
        <Show when={status().msg}>
          <span style={{
            color: status().kind === 'err' ? 'var(--err)' :
                   status().kind === 'ok' ? 'var(--ok)' : 'var(--fg-dim)',
            'font-size': '11px',
            'margin-left': 'auto',
          }}>
            {status().msg}
          </span>
        </Show>
      </div>
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