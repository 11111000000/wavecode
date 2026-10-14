import { createSignal, Show, For, createEffect, onCleanup } from 'solid-js';
import { Effect } from 'effect';
import { dispatch, appStore } from '../state/appStore';
import { detectLanguage } from '~/domain/languageMode';
import { AppLayer } from '~/infrastructure/composition';
import { AudioEngine } from '~/domain/services';
import { unlockAudioContext } from '~/infrastructure/audio/LiveAudioEngine';
import { applyEdit, getLastRawLLMResponse, type DialogTurn } from '~/application/useCases/llmEdit';
import { getLLMSettings } from '../state/llmSettings';
import { LLMSettingsPopover } from '~/presentation/components/LLMSettingsPopover';
import type { Role } from '~/domain/types';

/**
 * AI-редактор: пользователь пишет инструкцию на русском → LLM правит score → авто-eval.
 *
 * Layout: мессенджер-стиль.
 *   ┌──────────────────────────────┐
 *   │  история сообщений (скролл)  │
 *   ├──────────────────────────────┤
 *   │  статус (+ retry если err)   │
 *   ├──────────────────────────────┤
 *   │  textarea + Применить        │
 *   │  + селекты модели/think      │
 *   └──────────────────────────────┘
 * При новом сообщении auto-scroll в конец.
 */

const roleLabel = (role: Role): string => {
  switch (role) {
    case 'user': return 'вы';
    case 'assistant': return 'ИИ';
    case 'system': return 'система';
  }
};

type FailedRequest = { readonly text: string };

export function AIEditPanel() {
  const [instruction, setInstruction] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<{ kind: 'idle' | 'ok' | 'err'; msg: string }>({ kind: 'idle', msg: '' });
  const [settings] = createSignal(getLLMSettings());
  // Последний запрос, упавший с ошибкой. Нужен для кнопки «Попробовать
  // исправить» — повторяет ровно тот же текст + текущие настройки модели/
  // thinking. Очищается при успехе (новом или повторном).
  const [lastFailed, setLastFailed] = createSignal<FailedRequest | null>(null);

  let messagesRef: HTMLDivElement | undefined;

  const submit = async (overrideText?: string): Promise<void> => {
    const text = (overrideText ?? instruction()).trim();
    if (!text) {
      setStatus({ kind: 'err', msg: 'Введи инструкцию' });
      return;
    }
    unlockAudioContext();
    setBusy(true);
    setStatus({ kind: 'idle', msg: 'Отправляю в ИИ…' });

    const hist = appStore.messages.slice(-10).map((m): DialogTurn => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));
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
            {
              model: currentSettings.model,
              thinking: currentSettings.thinking,
              mode: detectLanguage(appStore.score),
            },
          );
        }).pipe(Effect.provide(AppLayer)),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[AIEditPanel] LLM error:', msg, err);
      setStatus({ kind: 'err', msg: `LLM ошибка: ${msg}` });
      setLastFailed({ text });
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
      setLastFailed({ text });
      setBusy(false);
      return;
    }

    dispatch({ type: 'replaceScore', text: newScore });
    dispatch({ type: 'assistantMessage', text: newScore });
    dispatch({ type: 'userMessage', text });
    if (overrideText === undefined) {
      // Retry: текст уже в textarea как instruction, не перезаписываем.
      setInstruction('');
    }

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const audio = yield* AudioEngine;
          yield* audio.eval(newScore, detectLanguage(newScore));
        }).pipe(Effect.provide(AppLayer)),
      );
      dispatch({ type: 'audioStatusChange', status: 'playing' });
      setStatus({ kind: 'ok', msg: 'Применено и играет ✓' });
      setLastFailed(null);
    } catch (audioErr) {
      const msg = audioErr instanceof Error ? audioErr.message : String(audioErr);
      console.error('[AIEditPanel] audio eval error:', msg);
      dispatch({ type: 'audioStatusChange', status: 'error', error: msg });
      setStatus({ kind: 'err', msg: `ИИ ответил, но ошибка аудио: ${msg}` });
      setLastFailed({ text });
    } finally {
      setBusy(false);
    }
  };

  const onRetry = (): void => {
    const f = lastFailed();
    if (!f) return;
    void submit(f.text);
  };

  

  createEffect(() => {
    // Следим за длиной истории: при изменении auto-scroll в конец.
    void appStore.messages.length;
    if (messagesRef) {
      messagesRef.scrollTop = messagesRef.scrollHeight;
    }
  });

  onCleanup(() => {
    // nothing to clean — effect self-disposes on unmount
  });

  return (
    <div class="ai-edit-panel-inner">
      <div class="ai-messages" ref={messagesRef}>
        <Show
          when={appStore.messages.length > 0}
          fallback={
            <div class="ai-messages-empty">
              Здесь будет диалог с ИИ. Напиши инструкцию внизу — например:
              «сделай быстрее в два раза», «добавь басов», «сделай техно-бит».
            </div>
          }
        >
          <For each={appStore.messages}>
            {(m) => (
              <div class={`ai-message ai-message-${m.role}`}>
                <div class="ai-message-meta">{roleLabel(m.role)}</div>
                <div class="ai-message-body">{m.content}</div>
              </div>
            )}
          </For>
        </Show>
      </div>

      <Show when={status().msg}>
        <div class="ai-status-row">
          <div class={`ai-status ai-status-${status().kind}`}>{status().msg}</div>
          <Show when={status().kind === 'err' && lastFailed()}>
            <button
              type="button"
              class="ai-retry-btn"
              onClick={onRetry}
              disabled={busy()}
              title="Отправить тот же запрос ещё раз"
            >
              ↻ Попробовать исправить
            </button>
          </Show>
        </div>
      </Show>

      <div class="ai-footer">
        <textarea
          aria-label="Инструкция для ИИ"
          data-ai-textarea
          placeholder='Что сделать? Например: «сделай быстрее в два раза»'
          value={instruction()}
          onInput={(e) => setInstruction(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const isTouchDevice =
              typeof window !== 'undefined' &&
              (('ontouchstart' in window) || (navigator.maxTouchPoints ?? 0) > 0);
            // Mobile: Enter submits, Shift+Enter inserts newline (soft keyboards
            // have no easy modifier-Enter path).
            // Desktop: Ctrl/Cmd+Enter submits, plain Enter inserts newline.
            if (isTouchDevice) {
              if (e.shiftKey) return;
              if (e.isComposing) return;
              e.preventDefault();
              void submit();
            } else if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={2}
          class="ai-textarea"
          disabled={busy()}
        />
        <div class="ai-controls-row1">
          <LLMSettingsPopover />
          <button
            type="button"
            class="ai-apply-btn"
            onClick={() => void submit()}
            disabled={busy()}
          >
            {busy() ? '⏳ Применяю…' : '✦ Применить'}
          </button>
        </div>
      </div>
    </div>
  );
}