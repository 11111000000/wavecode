import { createSignal, Show, For } from 'solid-js';
import { Effect } from 'effect';
import { dispatch, appStore } from '../state/appStore';
import { AppLayer } from '~/infrastructure/composition';
import { AudioEngine } from '~/domain/services';
import { unlockAudioContext } from '~/infrastructure/audio/LiveAudioEngine';
import { applyEdit, getLastRawLLMResponse, type DialogTurn } from '~/application/useCases/llmEdit';
import { getLLMSettings, setModel, setThinking } from '../state/llmSettings';

/**
 * AI-редактор: пользователь пишет инструкцию на русском → LLM правит score → авто-eval.
 */

export function AIEditPanel() {
  const [instruction, setInstruction] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<{ kind: 'idle' | 'ok' | 'err'; msg: string }>({ kind: 'idle', msg: '' });
  const [history, setHistory] = createSignal<DialogTurn[]>([]);
  const [settings, setSettings] = createSignal(getLLMSettings());

  const submit = async () => {
    const text = instruction().trim();
    if (!text) {
      setStatus({ kind: 'err', msg: 'Введи инструкцию' });
      return;
    }
    unlockAudioContext();
    setBusy(true);
    setStatus({ kind: 'idle', msg: 'Отправляю в ИИ…' });

    const hist = history().slice(-10);
    const currentSettings = settings();

    let newScore: string;
    try {
      newScore = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* applyEdit(
            appStore.score,
            text,
            hist,
            { status: appStore.audio.status, ...(appStore.audio.lastError ? { lastError: appStore.audio.lastError } : {}) },
            { model: currentSettings.model, thinking: currentSettings.thinking },
          );
        }).pipe(Effect.provide(AppLayer)),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[AIEditPanel] LLM error:', msg, err);
      setStatus({ kind: 'err', msg: `LLM ошибка: ${msg}` });
      setBusy(false);
      return;
    }

    if (!newScore || !newScore.trim()) {
      const raw = getLastRawLLMResponse();
      console.warn('[AIEditPanel] LLM returned empty after cleaning. Raw response:', JSON.stringify(raw));
      const preview = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
      setStatus({
        kind: 'err',
        msg: raw
          ? `ИИ вернул пустой ответ после очистки. Сырой: "${preview.replace(/\n/g, ' ')}"`
          : 'ИИ вернул пустой ответ (нет данных от API)',
      });
      setBusy(false);
      return;
    }

    dispatch({ type: 'replaceScore', text: newScore });
    dispatch({ type: 'assistantMessage', text: newScore });
    dispatch({ type: 'userMessage', text });
    setHistory([...hist, { role: 'user', content: text }, { role: 'assistant', content: newScore }]);
    setInstruction('');

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
      console.error('[AIEditPanel] audio eval error:', msg);
      dispatch({ type: 'audioStatusChange', status: 'error', error: msg });
      setStatus({ kind: 'err', msg: `ИИ ответил, но ошибка аудио: ${msg}` });
    } finally {
      setBusy(false);
    }
  };

  const onModelChange = (e: Event) => {
    const value = (e.currentTarget as HTMLSelectElement).value as 'smart' | 'fast';
    setModel(value);
    setSettings(getLLMSettings());
  };

  const onThinkingChange = (e: Event) => {
    const value = (e.currentTarget as HTMLSelectElement).value as 'low' | 'high' | 'off';
    setThinking(value);
    setSettings(getLLMSettings());
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
      <div class="ai-controls-row1">
        <select
          class="llm-select"
          value={settings().model}
          onChange={onModelChange}
          disabled={busy()}
          title="Модель: smart=MiniMax-M3 (код, медленнее), fast=MiniMax-M2.1 (быстрее)"
        >
          <option value="smart">smart · M3</option>
          <option value="fast">fast · M2.1</option>
        </select>
        <select
          class="llm-select"
          value={settings().thinking}
          onChange={onThinkingChange}
          disabled={busy()}
          title="Thinking: low=быстро+дешевле, high=глубже, off=отключить"
        >
          <option value="low">think · low</option>
          <option value="high">think · high</option>
          <option value="off">think · off</option>
        </select>
        <button type="button" onClick={() => void submit()} disabled={busy()}>
          {busy() ? '⏳ Применяю…' : '✦ Применить'}
        </button>
        <button type="button" disabled={busy()} onClick={() => setInstruction('')}>
          Очистить
        </button>
      </div>
      <Show when={status().msg}>
        <div class={`ai-status ai-status-${status().kind}`}>{status().msg}</div>
      </Show>

      <Show when={appStore.messages.length > 0}>
        <details class="ai-history" open={false}>
          <summary>История ({appStore.messages.length})</summary>
          <ul class="messages-list">
            <For each={appStore.messages}>
              {(m) => (
                <li class={`message-item message-${m.role}`}>
                  <strong>{m.role}:</strong> {m.content}
                </li>
              )}
            </For>
          </ul>
        </details>
      </Show>
    </div>
  );
}
