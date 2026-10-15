import { createSignal, Show, For, createEffect, onCleanup, createMemo } from 'solid-js';
import { Effect } from 'effect';
import { dispatch, appStore, setAppStore } from '../state/appStore';
import { AppLayer } from '~/infrastructure/composition';
import { AudioEngine } from '~/domain/services';
import { unlockAudioContext } from '~/infrastructure/audio/LiveAudioEngine';
import {
  applyEdit,
  getLastRawLLMResponse,
  type ActiveTrackSnapshot,
} from '~/application/useCases/llmEdit';
import { getLLMSettings } from '../state/llmSettings';
import { LLMSettingsPopover } from '~/presentation/components/LLMSettingsPopover';
import type { Role, Track } from '~/domain/types';

const roleLabel = (role: Role): string => {
  switch (role) {
    case 'user': return 'вы';
    case 'assistant': return 'ИИ';
    case 'system': return 'система';
  }
};

type FailedRequest = { readonly text: string };

const findActive = (): Track | undefined =>
  appStore.tracks.find((t) => t.id === appStore.activeTrackId);

const snapshotOf = (track: Track | undefined): ActiveTrackSnapshot | undefined =>
  track
    ? {
        id: track.id,
        score: track.score,
        messages: track.messages.map((m) => ({ role: m.role, content: m.content })),
      }
    : undefined;

export function AIEditPanel() {
  const [instruction, setInstruction] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<{ kind: 'idle' | 'ok' | 'err'; msg: string }>({ kind: 'idle', msg: '' });
  const [settings] = createSignal(getLLMSettings());
  const [lastFailed, setLastFailed] = createSignal<FailedRequest | null>(null);
  // Inline-rename UI: track id being edited + draft title.
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [renameDraft, setRenameDraft] = createSignal('');

  let messagesRef: HTMLDivElement | undefined;

  const activeTrack = createMemo<Track | undefined>(findActive);
  const activeMessages = createMemo(() => activeTrack()?.messages ?? []);
  const nonArchivedCount = createMemo(
    () => appStore.tracks.filter((t) => t.state !== 'archived').length,
  );

  const submit = async (overrideText?: string): Promise<void> => {
    const text = (overrideText ?? instruction()).trim();
    if (!text) {
      setStatus({ kind: 'err', msg: 'Введи инструкцию' });
      return;
    }
    const track = findActive();
    if (!track) {
      setStatus({ kind: 'err', msg: 'Нет активного трека' });
      return;
    }
    unlockAudioContext();
    setBusy(true);
    setStatus({ kind: 'idle', msg: 'Отправляю в ИИ…' });

    const snapshot = snapshotOf(track);
    const currentSettings = settings();

    let newScore: string;
    try {
      newScore = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* applyEdit(
            snapshot,
            text,
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
      setInstruction('');
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

  // ── Track actions ─────────────────────────────────────────────
  const onNewTrack = (): void => {
    const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    dispatch({
      type: 'createTrack',
      id,
      title: `Трек ${appStore.tracks.length + 1}`,
      state: 'draft',
    });
  };

  const onSwitchTrack = (id: string): void => {
    if (id === appStore.activeTrackId) return;
    const target = appStore.tracks.find((t) => t.id === id);
    if (!target) return;
    dispatch({ type: 'switchTrack', id });
    // Eval the new track's score (audio.stop + audio.eval
    // happened in the reducer side-effect; but switchTrack is
    // pure — we still need to drive the audio here).
    void Effect.runPromise(
      Effect.gen(function* () {
        const audio = yield* AudioEngine;
        yield* audio.stop();
        yield* audio.eval(target.score);
      }).pipe(Effect.provide(AppLayer)),
    ).then(() => {
      dispatch({ type: 'audioStatusChange', status: 'playing' });
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'audioStatusChange', status: 'error', error: msg });
    });
  };

  const onStartRename = (id: string): void => {
    const t = appStore.tracks.find((x) => x.id === id);
    if (!t) return;
    setRenamingId(id);
    setRenameDraft(t.title);
  };

  const onCommitRename = (): void => {
    const id = renamingId();
    if (!id) return;
    const title = renameDraft().trim();
    if (title) {
      dispatch({ type: 'renameTrack', id, title });
    }
    setRenamingId(null);
    setRenameDraft('');
  };

  const onCancelRename = (): void => {
    setRenamingId(null);
    setRenameDraft('');
  };

  const onClearDialog = (): void => {
    if (!window.confirm('Очистить диалог активного трека? Score останется без изменений.')) return;
    dispatch({ type: 'clearTrackDialog' });
  };

  const onDeleteTrack = (id: string): void => {
    const t = appStore.tracks.find((x) => x.id === id);
    if (!t) return;
    if (t.state !== 'archived' && nonArchivedCount() <= 1) {
      window.alert('Нельзя удалить единственный активный/черновик-трек. Сначала создайте новый или очистите диалог.');
      return;
    }
    const label = t.state === 'archived' ? 'удалить архивный трек' : 'удалить трек';
    if (!window.confirm(`${label} «${t.title}»? Это действие необратимо.`)) return;
    dispatch({ type: 'deleteTrack', id });
  };

  const onArchive = (): void => {
    if (!window.confirm('Архивировать активный трек? История диалога и score сохранятся, но трек перестанет быть активным.')) return;
    dispatch({ type: 'archiveTrack' });
  };

  const onRestore = (): void => {
    dispatch({ type: 'restoreTrack' });
  };

  createEffect(() => {
    void activeMessages().length;
    if (messagesRef) {
      messagesRef.scrollTop = messagesRef.scrollHeight;
    }
  });

  onCleanup(() => { /* effect self-disposes on unmount */ });

  return (
    <div class="ai-edit-panel-inner">
      {/* Track selector */}
      <div class="ai-track-selector" data-testid="track-selector">
        <select
          class="ai-track-select"
          aria-label="Активный трек"
          value={appStore.activeTrackId}
          onChange={(e) => onSwitchTrack(e.currentTarget.value)}
        >
          <For each={appStore.tracks}>
            {(t) => (
              <option value={t.id}>
                {t.state === 'archived' ? '⏏ ' : t.state === 'draft' ? '✎ ' : '▶ '}
                {t.title}
              </option>
            )}
          </For>
        </select>
        <button
          type="button"
          class="ai-track-btn"
          title="Создать новый трек"
          onClick={onNewTrack}
          disabled={busy()}
          data-testid="track-new"
        >＋</button>
        <Show when={renamingId() === null}>
          <button
            type="button"
            class="ai-track-btn"
            title="Переименовать активный трек"
            onClick={() => onStartRename(appStore.activeTrackId)}
            disabled={busy() || !activeTrack()}
            data-testid="track-rename"
          >✎</button>
        </Show>
        <Show when={renamingId() !== null}>
          <input
            class="ai-track-rename-input"
            value={renameDraft()}
            onInput={(e) => setRenameDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename();
              else if (e.key === 'Escape') onCancelRename();
            }}
            onBlur={onCommitRename}
            autofocus
            data-testid="track-rename-input"
          />
        </Show>
        <button
          type="button"
          class="ai-track-btn"
          title="Очистить диалог активного трека"
          onClick={onClearDialog}
          disabled={busy() || activeMessages().length === 0}
          data-testid="track-clear"
        >🗑</button>
        <Show
          when={activeTrack()?.state === 'archived'}
          fallback={
            <button
              type="button"
              class="ai-track-btn"
              title="Архивировать активный трек"
              onClick={onArchive}
              disabled={busy() || !activeTrack()}
              data-testid="track-archive"
            >⏏</button>
          }
        >
          <button
            type="button"
            class="ai-track-btn"
            title="Восстановить из архива"
            onClick={onRestore}
            disabled={busy()}
            data-testid="track-restore"
          >↩</button>
        </Show>
        <button
          type="button"
          class="ai-track-btn ai-track-btn-danger"
          title={
            activeTrack()?.state !== 'archived' && nonArchivedCount() <= 1
              ? 'Нельзя удалить единственный активный/черновик-трек'
              : 'Удалить активный трек'
          }
          onClick={() => onDeleteTrack(appStore.activeTrackId)}
          disabled={busy() || !activeTrack() || (activeTrack()?.state !== 'archived' && nonArchivedCount() <= 1)}
          data-testid="track-delete"
        >⨯</button>
      </div>

      {/* Messages */}
      <div class="ai-messages" ref={messagesRef}>
        <Show
          when={activeMessages().length > 0}
          fallback={
            <div class="ai-messages-empty">
              <Show
                when={activeTrack()}
                fallback={<span>Нет активного трека. Создайте его кнопкой «＋» выше.</span>}
              >
                Здесь будет диалог с ИИ по треку «{activeTrack()?.title}». Напиши инструкцию внизу — например: «сделай быстрее в два раза», «добавь басов», «сделай техно-бит».
              </Show>
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

      <div class="ai-footer">
        <textarea
          aria-label="Инструкция для ИИ"
          data-ai-textarea
          placeholder={activeTrack()?.state === 'archived' ? 'Трек в архиве — восстановите, чтобы отправлять инструкции' : 'Что сделать? Например: «сделай быстрее в два раза»'}
          value={instruction()}
          onInput={(e) => setInstruction(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            if (activeTrack()?.state === 'archived') return;
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
          disabled={busy() || activeTrack()?.state === 'archived'}
        />
        <div class="ai-controls-row1">
          <LLMSettingsPopover />
          <button
            type="button"
            class="ai-apply-btn"
            onClick={() => void submit()}
            disabled={busy() || activeTrack()?.state === 'archived'}
          >
            {busy() ? '⏳ Применяю…' : '✦ Применить'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Touch setAppStore export to avoid TS6133 in case future
// refactors drop the dispatch import path.
void setAppStore;
