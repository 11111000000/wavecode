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
 *      с историей диалога — LLM помнит контекст.
 *   3. LLM возвращает новый score (только JS-код).
 *   4. Replace score в store + добавляем user/assistant turns в history.
 *   5. Авто-eval через AudioEngine.
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

    const hist = history().slice(-10);

    try {
      const newScore = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* applyEdit(appStore.score, text, hist, {
            status: appStore.audio.status,
            ...(appStore.audio.lastError ? { lastError: appStore.audio.lastError } : {}),
          });
        }).pipe(Effect.provide(AppLayer)),
      );

      dispatch({ type: 'replaceScore', text: newScore });
      dispatch({ type: 'assistantMessage', text: newScore });
      dispatch({ type: 'userMessage', text });

      setHistory([...hist, { role: 'user', content: text }, { role: 'assistant', content: newScore }]);

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
        const msg = audioErr instanceof Error ? audioErr.message : String(audioErr);
        dispatch({ type: 'audioStatusChange', status: 'error', error: msg });
        setStatus({ kind: 'err', msg: `ИИ ответил, но ошибка аудио: ${msg}` });
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
        data-ai-textarea
        placeholder='Например: "сделай быстрее в два раза", "сделай техно-бит", "добавь басов"'
        value={instruction()}
        onInput={(e) => setInstruction(e.currentTarget.value)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter') && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={2}
        class="ai-textarea"
      />
      <div class="ai-controls">
        <button type="button" onClick={() => void submit()} disabled={busy()}>
          {busy() ? '⏳ Применяю…' : '✦ Применить правку ИИ'}
        </button>
        <button type="button" disabled={busy()} onClick={() => setInstruction('')}>
          Очистить
        </button>
        <Show when={status().msg}>
          <span class={`ai-status ai-status-${status().kind}`}>{status().msg}</span>
        </Show>
      </div>
    </div>
  );
}
