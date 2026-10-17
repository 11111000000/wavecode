import { createSignal, Show, For, createEffect, onCleanup, createMemo, onMount } from 'solid-js';
import { Effect } from 'effect';
import { dispatch, appStore } from '../state/appStore';
import { AppLayer } from '~/infrastructure/composition';
import { AudioEngine } from '~/domain/services';
import { unlockAudioContext } from '~/infrastructure/audio/LiveAudioEngine';
import {
  applyEdit,
  applyEditWithContext,
  getLastRawLLMResponse,
  type DialogTurn,
  type FocusedContextLike,
} from '~/application/useCases/llmEdit';
import { getLLMSettings } from '../state/llmSettings';
import { LLMSettingsPopover } from '~/presentation/components/LLMSettingsPopover';
import {
  selectionRange,
  getFocusedContext,
  registerAiExplainSelectedHandler,
  type FocusedContext,
} from '../state/editorSelection';
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
 *
 * wavecode-editor-selection-ai: AIEditPanel now reads the
 * live CodeMirror selection (lifted to a module-level Solid
 * signal in `editorSelection.ts`) and lifts it to an
 * AST-structural `FocusedContext` via `getFocusedContext`. A
 * toggle «Применить к выделенному» (default OFF) routes the
 * next submit through `applyEditWithContext` instead of
 * `applyEdit` — the model then sees a `=== FOCUSED CONTEXT ===`
 * block in its user prompt and scopes its edit to that scope.
 *
 * Ctrl/Cmd+Shift+L (`aiExplainSelected` hotkey) sets the toggle
 * ON, focuses the textarea, and pre-fills a friendly
 * instruction so the user can just press Enter.
 */

const roleLabel = (role: Role): string => {
  switch (role) {
    case 'user': return 'вы';
    case 'assistant': return 'ИИ';
    case 'system': return 'система';
  }
};

type FailedRequest = { readonly text: string };

/**
 * Map a `FocusedContext` to a short Russian label for the
 * status line. Returns null when the context is null (no
 * selection).
 */
const focusedContextLabel = (ctx: FocusedContext): string | null => {
  if (ctx === null) return null;
  if (ctx.kind === 'function-call') {
    return `${ctx.name}(…)`;
  }
  if (ctx.kind === 'stack-row') {
    return ctx.name
      ? `строка ${ctx.index + 1} (${ctx.name})`
      : `строка ${ctx.index + 1}`;
  }
  // text-fallback
  return `${ctx.text.length} ${ctx.text.length === 1 ? 'символ' : 'символов'} выделено`;
};

const focusedContextToPrompt = (ctx: FocusedContext): FocusedContextLike | null => {
  if (ctx === null) return null;
  const base: FocusedContextLike = {
    kind: ctx.kind,
    text: ctx.text,
  };
  if (ctx.kind === 'function-call' || ctx.kind === 'stack-row') {
    if (ctx.name !== null && ctx.name !== undefined) {
      return { ...base, name: ctx.name };
    }
  }
  return base;
};

export function AIEditPanel() {
  const [instruction, setInstruction] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<{ kind: 'idle' | 'ok' | 'err'; msg: string }>({ kind: 'idle', msg: '' });
  const [settings] = createSignal(getLLMSettings());
  // Последний запрос, упавший с ошибкой. Нужен для кнопки «Попробовать
  // исправить» — повторяет ровно тот же текст + текущие настройки модели/
  // thinking. Очищается при успехе (новом или повторном).
  const [lastFailed, setLastFailed] = createSignal<FailedRequest | null>(null);
  // wavecode-editor-selection-ai: «Применить к выделенному» toggle.
  // Default OFF so the previous (non-context) behaviour is the
  // user-visible default — toggling on is the explicit opt-in
  // that changes how the next prompt is shaped.
  const [applyToSelection, setApplyToSelection] = createSignal(false);

  let messagesRef: HTMLDivElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;

  /** Messages of the active preset's dialog thread. */
  const activeMessages = createMemo(
    () => appStore.dialogs[appStore.activePresetId] ?? [],
  );

  // wavecode-editor-selection-ai: reactively compute the
  // focused context from the current score text + the live
  // selection range. Re-runs on every doc change or selection
  // change.
  const focusedContext = createMemo<FocusedContext>(() =>
    getFocusedContext(appStore.score, selectionRange()),
  );

  // wavecode-editor-selection-ai: when the selection becomes
  // empty (cursor collapsed or selection cleared), force the
  // toggle off — the user can't apply to "no selection" and the
  // disabled-when-empty submit would be confusing if the toggle
  // were silently ON.
  createEffect(() => {
    const ctx = focusedContext();
    if (ctx === null && applyToSelection()) {
      setApplyToSelection(false);
    }
  });

  // wavecode-editor-selection-ai: register the Ctrl/Cmd+Shift+L
  // handler so App.tsx (frozen by Slot 1.1) does not need to be
  // touched. The handler sets the toggle ON, focuses the
  // textarea, and pre-fills a friendly instruction when the
  // selection maps to an AST node. Lazy registration: the
  // wrapper in `useKeyboardShortcuts.ts` reads this signal at
  // press-time, so the order of mount does not matter.
  onMount(() => {
    const dispose = registerAiExplainSelectedHandler((): void => {
      const ctx = focusedContext();
      // Only meaningful when there's actually a selection.
      if (ctx === null) {
        setStatus({
          kind: 'err',
          msg: 'Выдели фрагмент в score, прежде чем просить ИИ объяснить выделенное.',
        });
        return;
      }
      setApplyToSelection(true);
      // Pre-fill the textarea with a friendly default so the
      // user can just press Enter to submit. Only do this when
      // the textarea is empty — never overwrite a draft.
      if (instruction().trim() === '') {
        if (ctx.kind === 'function-call') {
          setInstruction(`Объясни и при необходимости улучши ${ctx.name}(…) — что она делает и как её можно разнообразить?`);
        } else if (ctx.kind === 'stack-row') {
          setInstruction(`Объясни строку ${ctx.index + 1} и предложи вариацию (не меняя остальной score).`);
        } else {
          setInstruction(`Объясни выделенный фрагмент и предложи, как его улучшить.`);
        }
      }
      // Focus the textarea on the next tick so Solid has
      // finished rendering the new instruction.
      window.setTimeout(() => {
        textareaRef?.focus();
      }, 0);
    });
    onCleanup(dispose);
  });

  const submit = async (overrideText?: string): Promise<void> => {
    const text = (overrideText ?? instruction()).trim();
    if (!text) {
      setStatus({ kind: 'err', msg: 'Введи инструкцию' });
      return;
    }
    // wavecode-editor-selection-ai: when the toggle is ON,
    // require a non-null focused context. The submit button is
    // disabled in this case but defend at the call boundary in
    // case someone hits Enter on a stale textarea.
    if (applyToSelection() && focusedContext() === null) {
      setStatus({ kind: 'err', msg: 'Выдели код, чтобы ИИ знал фокус' });
      return;
    }
    unlockAudioContext();
    setBusy(true);
    setStatus({ kind: 'idle', msg: 'Отправляю в ИИ…' });

    const hist = activeMessages().slice(-10).map((m): DialogTurn => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));
    const currentSettings = settings();
    const ctxForPrompt = applyToSelection() ? focusedContextToPrompt(focusedContext()) : null;

    let newScore: string;
    try {
      newScore = await Effect.runPromise(
        Effect.gen(function* () {
          if (ctxForPrompt !== null) {
            return yield* applyEditWithContext(
              appStore.score,
              text,
              hist,
              { status: appStore.audio.status, ...(appStore.audio.lastError ? { lastError: appStore.audio.lastError } : {}) },
              { model: currentSettings.model, thinking: currentSettings.thinking },
              ctxForPrompt,
            );
          }
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
      // wavecode-editor-selection-ai: clear the toggle after a
      // successful submit so the next instruction starts from a
      // clean state — the selection may have moved or the user
      // may want to apply to the WHOLE score next time.
      setApplyToSelection(false);
    }

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const audio = yield* AudioEngine;
          yield* audio.eval(newScore);
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

  // wavecode-editor-selection-ai: derive UI state from the
  // focused context. The status line shows the AST-derived
  // function/row name when matching succeeds; the submit
  // button is disabled when the toggle is ON but the selection
  // is empty.
  const focusedLabel = createMemo(() => focusedContextLabel(focusedContext()));
  const submitDisabled = createMemo(() => {
    if (busy()) return true;
    if (applyToSelection() && focusedContext() === null) return true;
    return false;
  });

  createEffect(() => {
    // Следим за длиной истории: при изменении auto-scroll в конец.
    void activeMessages().length;
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
          when={activeMessages().length > 0}
          fallback={
            <div class="ai-messages-empty">
              Здесь будет диалог с ИИ для выбранной композиции. Напиши инструкцию внизу — например:
              «сделай быстрее в два раза», «добавь басов», «сделай техно-бит».
              <br />
              <small>Подсказка: выдели фрагмент в score (например, один ряд стека) и нажми Ctrl/Cmd+Shift+L — ИИ увидит только выделенное.</small>
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

      {/* wavecode-editor-selection-ai: selection status line.
          Sits between the messages/status row and the textarea
          so the user always sees what the AI will treat as the
          "focused context" before they submit. Hides itself when
          no selection exists (no signal noise in the default
          state). */}
      <Show when={focusedLabel() !== null || applyToSelection()}>
        <div
          class="ai-focus-row"
          data-testid="ai-focus-row"
          data-state={focusedContext() === null ? 'no-selection' : 'has-selection'}
        >
          <Show
            when={focusedContext() !== null}
            fallback={
              <span class="ai-focus-empty">
                Выдели код, чтобы ИИ знал фокус
              </span>
            }
          >
            <span class="ai-focus-glyph" aria-hidden="true">📍</span>
            <span class="ai-focus-label">Focus: {focusedLabel()}</span>
            <Show when={applyToSelection()}>
              <span class="ai-focus-tag">применю к выделенному</span>
            </Show>
          </Show>
          <label class="ai-focus-toggle" title="Применить правку только к выделенному фрагменту">
            <input
              type="checkbox"
              data-testid="ai-focus-toggle"
              checked={applyToSelection()}
              disabled={focusedContext() === null}
              onChange={(e) => setApplyToSelection(e.currentTarget.checked)}
            />
            <span>к выделенному</span>
          </label>
        </div>
      </Show>

      <div class="ai-footer">
        <textarea
          ref={textareaRef}
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
            disabled={submitDisabled()}
            title={
              submitDisabled() && applyToSelection() && focusedContext() === null
                ? 'Выдели код, чтобы ИИ знал фокус'
                : 'Применить правку'
            }
          >
            {busy() ? '⏳ Применяю…' : '✦ Применить'}
          </button>
        </div>
      </div>
    </div>
  );
}