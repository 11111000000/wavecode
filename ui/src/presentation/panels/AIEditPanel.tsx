import { createSignal, Show, For, createEffect, onCleanup, createMemo, batch } from 'solid-js';
import { Effect } from 'effect';
import { dispatch, appStore } from '../state/appStore';
import { AppLayer } from '~/infrastructure/composition';
import { AudioEngine } from '~/domain/services';
import { unlockAudioContext } from '~/infrastructure/audio/LiveAudioEngine';
import {
  applyEditStream,
  getLastRawLLMResponse,
  type DialogTurn,
  type ApplyEditResult,
} from '~/application/useCases/llmEdit';
import { getLLMSettings } from '../state/llmSettings';
import { LLMSettingsPopover } from '~/presentation/components/LLMSettingsPopover';
import { logger } from '~/infrastructure/log';
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
 *
 * Streaming + self-heal:
 *   - During streaming, a draft `assistant` message accumulates
 *     tokens as they arrive from `onToken`. The status pill reads
 *     "ИИ думает…" → "Применяю…".
 *   - On completion, the draft is replaced by the final assistant
 *     message (cleaned score). If `wasHealed` is true, the status
 *     pill says "Готово (сам исправил)" — the user sees a hint that
 *     the LLM's first attempt was broken and the self-heal retry
 *     salvaged it.
 *   - On hard failure (LLM error or self-heal budget exhausted),
 *     the existing `lastFailed` + manual retry button stays.
 */

const roleLabel = (role: Role): string => {
  switch (role) {
    case 'user': return 'вы';
    case 'assistant': return 'ИИ';
    case 'system': return 'система';
  }
};

type FailedRequest = { readonly text: string };

type Status =
  | { kind: 'idle'; msg: string }
  | { kind: 'streaming' }
  | { kind: 'applying' }
  | { kind: 'ok'; msg: string }
  | { kind: 'err'; msg: string };

/**
 * A draft message that accumulates streaming tokens in the active
 * preset's dialog. Once the final cleaned score arrives we replace
 * this with the real assistant message in `appStore.dialogs`.
 */
type DraftAssistantMessage = {
  readonly role: 'assistant';
  readonly text: string;
};

export function AIEditPanel() {
  const [instruction, setInstruction] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<Status>({ kind: 'idle', msg: '' });
  const [settings] = createSignal(getLLMSettings());
  const [lastFailed, setLastFailed] = createSignal<FailedRequest | null>(null);
  // Live-updated by `onToken` callbacks so the user sees the LLM's
  // output appear as the model emits it. Cleared on success/failure.
  const [draftAssistant, setDraftAssistant] = createSignal<DraftAssistantMessage | null>(null);

  let messagesRef: HTMLDivElement | undefined;

  /** Messages of the active preset's dialog thread. */
  const activeMessages = createMemo(
    () => appStore.dialogs[appStore.activePresetId] ?? [],
  );

  const submit = async (overrideText?: string): Promise<void> => {
    const text = (overrideText ?? instruction()).trim();
    if (!text) {
      setStatus({ kind: 'err', msg: 'Введи инструкцию' });
      return;
    }
    unlockAudioContext();
    batch(() => {
      setBusy(true);
      setStatus({ kind: 'streaming' });
      setDraftAssistant({ role: 'assistant', text: '' });
    });

    const hist = activeMessages().slice(-10).map((m): DialogTurn => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));
    const currentSettings = settings();

    let result: ApplyEditResult;
    try {
      result = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* applyEditStream(
            appStore.score,
            text,
            hist,
            { status: appStore.audio.status, ...(appStore.audio.lastError ? { lastError: appStore.audio.lastError } : {}) },
            { model: currentSettings.model, thinking: currentSettings.thinking },
            {
              onToken: (delta) => {
                setDraftAssistant((prev) =>
                  prev ? { role: 'assistant', text: prev.text + delta } : prev,
                );
              },
            },
          );
        }).pipe(Effect.provide(AppLayer)),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.push(
        'error',
        ['[AIEditPanel] LLM error:', msg, err],
        'AIEditPanel.submit',
      );
      batch(() => {
        setStatus({ kind: 'err', msg: `LLM ошибка: ${msg}` });
        setLastFailed({ text });
        setDraftAssistant(null);
        setBusy(false);
      });
      return;
    }

    if (!result.score || !result.score.trim()) {
      const raw = getLastRawLLMResponse();
      logger.push(
        'warn',
        ['[AIEditPanel] LLM returned empty after cleaning. Raw response:', JSON.stringify(raw)],
        'AIEditPanel.submit',
      );
      const preview = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
      batch(() => {
        setStatus({
          kind: 'err',
          msg: raw
            ? `ИИ вернул пустой ответ после очистки. Сырой: "${preview.replace(/\n/g, ' ')}"`
            : 'ИИ вернул пустой ответ (нет данных от API)',
        });
        setLastFailed({ text });
        setDraftAssistant(null);
        setBusy(false);
      });
      return;
    }

    // Draft → final assistant message in the dialog thread.
    batch(() => {
      dispatch({ type: 'replaceScore', text: result.score });
      dispatch({ type: 'assistantMessage', text: result.score });
      dispatch({ type: 'userMessage', text });
      setDraftAssistant(null);
      if (overrideText === undefined) {
        // Retry: текст уже в textarea как instruction, не перезаписываем.
        setInstruction('');
      }
      setStatus({ kind: 'applying' });
    });

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const audio = yield* AudioEngine;
          yield* audio.eval(result.score);
        }).pipe(Effect.provide(AppLayer)),
      );
      dispatch({ type: 'audioStatusChange', status: 'playing' });
      batch(() => {
        setStatus({
          kind: 'ok',
          msg: result.wasHealed ? 'Готово (сам исправил) ✓' : 'Готово ✓',
        });
        setLastFailed(null);
        setBusy(false);
      });
    } catch (audioErr) {
      const msg = audioErr instanceof Error ? audioErr.message : String(audioErr);
      logger.push(
        'error',
        ['[AIEditPanel] audio eval error:', msg],
        'AIEditPanel.submit',
      );
      dispatch({ type: 'audioStatusChange', status: 'error', error: msg });
      batch(() => {
        setStatus({ kind: 'err', msg: `ИИ ответил, но ошибка аудио: ${msg}` });
        setLastFailed({ text });
        setBusy(false);
      });
    }
  };

  const onRetry = (): void => {
    const f = lastFailed();
    if (!f) return;
    void submit(f.text);
  };

  createEffect(() => {
    // Следим за длиной истории: при изменении auto-scroll в конец.
    void activeMessages().length;
    void draftAssistant()?.text.length;
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
          when={activeMessages().length > 0 || draftAssistant()}
          fallback={
            <div class="ai-messages-empty">
              Здесь будет диалог с ИИ для выбранной композиции. Напиши инструкцию внизу — например:
              «сделай быстрее в два раза», «добавь басов», «сделай техно-бит».
            </div>
          }
        >
          <For each={activeMessages()}>
            {(m) => (
              <div class={`ai-message ai-message-${m.role}`}>
                <div class="ai-message-meta">{roleLabel(m.role)}</div>
                <div class="ai-message-body">{m.content}</div>
              </div>
            )}
          </For>
          {/* Draft message: rendered while the LLM is streaming tokens
              and discarded on completion (replaced by the real
              assistantMessage dispatched to appStore). */}
          <Show when={draftAssistant()}>
            {(draft) => (
              <div class="ai-message ai-message-assistant ai-message-streaming">
                <div class="ai-message-meta">
                  ИИ<span class="ai-streaming-cursor">▍</span>
                </div>
                <div class="ai-message-body">{draft().text}</div>
              </div>
            )}
          </Show>
        </Show>
      </div>

      <Show when={status().kind !== 'idle'}>
        <div class="ai-status-row">
          <div class={`ai-status ai-status-${statusKind(status())}`}>
            {statusMessage(status())}
          </div>
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
            class="ai-clear-btn"
            title="Очистить диалог текущей композиции (другие композиции не затрагиваются)"
            onClick={() => {
              if (activeMessages().length === 0) return;
              if (window.confirm('Очистить диалог текущей композиции? История других композиций сохранится.')) {
                dispatch({ type: 'clearMessages' });
              }
            }}
            disabled={busy() || activeMessages().length === 0}
            data-testid="ai-clear-btn"
          >🗑 Очистить</button>
          <button
            type="button"
            class="ai-apply-btn"
            onClick={() => void submit()}
            disabled={busy()}
            data-ai-apply-btn
          >
            {applyButtonLabel(status(), busy())}
          </button>
        </div>
      </div>
    </div>
  );
}

const statusKind = (s: Status): 'idle' | 'ok' | 'err' | 'streaming' | 'applying' => s.kind;

const statusMessage = (s: Status): string => {
  switch (s.kind) {
    case 'idle': return s.msg;
    case 'streaming': return 'ИИ думает…';
    case 'applying': return 'Применяю…';
    case 'ok': return s.msg;
    case 'err': return s.msg;
  }
};

const applyButtonLabel = (s: Status, busy: boolean): string => {
  if (!busy) return '✦ Применить';
  if (s.kind === 'streaming') return '⏳ Думаю…';
  if (s.kind === 'applying') return '⏳ Применяю…';
  return '⏳ …';
};