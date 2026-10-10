import {
  Show, onMount, createEffect, createSignal, For, onCleanup, type JSX,
} from 'solid-js';
import { Effect } from 'effect';
import { HelloPanel } from './presentation/panels/HelloPanel';
import { ScorePanel } from './presentation/panels/ScorePanel';
import { AIEditPanel } from './presentation/panels/AIEditPanel';
import { DebugPanel } from './presentation/panels/DebugPanel';
import { TransportPanel } from './presentation/components/TransportPanel';
import { installTransportAudioSync } from './presentation/state/useTransportAudioSync';
import {
  uiState, toggleAI, toggleStatus, installKeyboardShortcuts,
  getMobileMode, setMobileMode,
  type MobileMode,
  openSheet, closeSheet, openKindSheet, closeKindSheet, setTab, getActiveTab,
} from './presentation/state/uiState';
import { appStore, dispatch } from './presentation/state/appStore';
import { installTypingTracker } from './presentation/state/editorTypingTracker';
import { evalScore, stopAudio, beep } from './presentation/state/audioActions';
import { ShareButton } from './presentation/components/ShareButton';
import { shareState, setPendingShare, markIdbHasScore, startLoadingShared, finishLoadingShared } from './presentation/state/shareState';
import { decodeSnippet } from '~/domain/urlCodec';
import { AppLayer } from '~/infrastructure/composition';
import { Repo } from '~/domain/services';
import { ensureAudioLoaded, getAudioContextState } from '~/infrastructure/audio/LiveAudioEngine';
import {
  allPresets, getPreset, saveCustomPreset, deleteCustomPreset, resetAllBrowserData,
} from './presentation/state/presetsStore';
import {
  StepIcon, PianoIcon,
  SaveIcon, TrashIcon, ResetIcon, NewIcon, PhoneIcon,
  UndoIcon, RedoIcon, BrandLogo,
} from './presentation/icons';
import { TabBar } from './presentation/components/TabBar';
import { FAB } from './presentation/components/FAB';
import { BottomSheet } from './presentation/components/BottomSheet';
import { MixerPanel } from './presentation/components/MixerPanel';
import { StepGrid } from './presentation/components/StepGrid';
import { PianoKeyboard } from './presentation/components/PianoKeyboard';

function CollapsibleHeader(props: {
  title: string;
  open: boolean;
  onToggle: () => void;
  hint: string;
  ariaLabel: string;
}): JSX.Element {
  return (
    <header class="panel-header" onClick={() => props.onToggle()}>
      <span class="collapse-toggle" aria-expanded={props.open} aria-label={props.ariaLabel}>
        <span class="caret">{props.open ? '▾' : '▸'}</span>
        <h2>{props.title}</h2>
        <span class="panel-hint">{props.hint}</span>
      </span>
    </header>
  );
}

export function App(): JSX.Element {
  const [ctxState, setCtxState] = createSignal(getAudioContextState());
  const [presetId, setPresetId] = createSignal('creep');
  const [showSavePreset, setShowSavePreset] = createSignal(false);
  const [showStepGrid, setShowStepGrid] = createSignal(false);
  const [showPiano, setShowPiano] = createSignal(false);
  const [audioRunning, setAudioRunning] = createSignal(false);
  const [mobileMode, setMobileModeSignal] = createSignal<MobileMode>(getMobileMode());
  const [showMobileMenu, setShowMobileMenu] = createSignal(false);
  const [newPresetName, setNewPresetName] = createSignal('');

  const toggleStepGrid = (): void => {
    if (showStepGrid()) { setShowStepGrid(false); closeKindSheet('step'); }
    else {
      setShowPiano(false);
      closeKindSheet('piano');
      setShowStepGrid(true);
      openKindSheet('step', 'full');
    }
  };
  const togglePiano = (): void => {
    if (showPiano()) { setShowPiano(false); closeKindSheet('piano'); }
    else {
      setShowStepGrid(false);
      closeKindSheet('step');
      setShowPiano(true);
      openKindSheet('piano', 'full');
    }
  };

  const chooseMobileMode = (mode: MobileMode): void => {
    setMobileMode(mode);
    setMobileModeSignal(mode);
    setShowMobileMenu(false);
  };

  const pollId = window.setInterval(() => {
    const s = getAudioContextState();
    setCtxState(s);
    setAudioRunning(s.state === 'running');
  }, 500);
  onCleanup(() => window.clearInterval(pollId));

  onMount(() => {
    installTransportAudioSync();
    void import('./infrastructure/audio/PianoSampleLoader').then((m) =>
      m.loadPianoSamples(),
    );

    void Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* Repo;
        const saved = yield* repo.loadScore();
        if (saved) {
          dispatch({ type: 'replaceScore', text: saved });
          markIdbHasScore(true);
        } else {
          const pending = shareState.pendingEncoded();
          if (pending) {
            const text = decodeSnippet(pending);
            if (text) {
              startLoadingShared();
              dispatch({ type: 'replaceScore', text });
              finishLoadingShared();
              setPendingShare(null);
            } else {
              setPendingShare(null);
            }
          }
        }
      }).pipe(Effect.provide(AppLayer)),
    );

    let preloaded = false;
    const preload = (): void => {
      if (preloaded) return;
      preloaded = true;
      void ensureAudioLoaded();
      window.removeEventListener('pointerdown', preload, true);
      window.removeEventListener('keydown', preload, true);
    };
    window.addEventListener('pointerdown', preload, { capture: true, passive: true });
    window.addEventListener('keydown', preload, { capture: true, passive: true });
  });

  let saveTimer: number | undefined;
  createEffect(() => {
    const score = appStore.score;
    if (saveTimer !== undefined) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* Repo;
          yield* repo.saveScore(score);
        }).pipe(Effect.provide(AppLayer)),
      );
    }, 500);
  });

  let saveMessagesTimer: number | undefined;
  createEffect(() => {
    const messages = appStore.messages;
    if (saveMessagesTimer !== undefined) window.clearTimeout(saveMessagesTimer);
    saveMessagesTimer = window.setTimeout(() => {
      const plain = JSON.parse(JSON.stringify(messages));
      void Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* Repo;
          yield* repo.saveMessages(plain);
        }).pipe(Effect.provide(AppLayer)),
      );
    }, 500);
  });

  const loadPreset = (id: string): void => {
    const preset = getPreset(id);
    if (!preset) return;
    setPresetId(id);
    dispatch({ type: 'replaceScore', text: preset.score });
    void evalScore();
  };

  const onSavePreset = (): void => {
    const name = newPresetName().trim();
    if (!name) return;
    const preset = saveCustomPreset(name, appStore.score);
    setPresetId(preset.id);
    setShowSavePreset(false);
    setNewPresetName('');
  };

  const onDeletePreset = (): void => {
    const id = presetId();
    if (!id.startsWith('custom-')) return;
    deleteCustomPreset(id);
    setPresetId('creep');
    const fallback = getPreset('creep');
    if (fallback) dispatch({ type: 'replaceScore', text: fallback.score });
  };

  const onResetAll = (): void => {
    const ok = window.confirm('Сбросить ВСЕ настройки и очистить локальное хранилище?\n(localStorage + IDB score/messages)');
    if (!ok) return;
    resetAllBrowserData();
    void Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* Repo;
        yield* repo.saveScore('');
        yield* repo.saveMessages([]);
      }).pipe(Effect.provide(AppLayer)),
    ).then(() => window.location.reload());
  };

  const NEW_COMPOSITION_TEMPLATE = '// Начни новую композицию здесь\n';

  const onNewComposition = (): void => {
    const ok = window.confirm('Создать новую композицию?\nТекущая партитура и история диалога сбросятся.');
    if (!ok) return;
    void stopAudio();
    dispatch({ type: 'replaceScore', text: NEW_COMPOSITION_TEMPLATE });
    dispatch({ type: 'clearMessages' });
    setPresetId('creep');
  };

  const onRollback = (): void => {
    void stopAudio();
    dispatch({ type: 'undoScore' });
  };
  const onRedo = (): void => {
    void stopAudio();
    dispatch({ type: 'redoScore' });
  };

  const onPrimaryAction = (): void => {
    if (audioRunning()) {
      void stopAudio();
    } else {
      void evalScore();
    }
  };

  installTypingTracker(dispatch);

  onMount(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (!showMobileMenu()) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.mobile-menu-wrap')) return;
      setShowMobileMenu(false);
    };
    document.addEventListener('click', onDocClick);
    onCleanup(() => document.removeEventListener('click', onDocClick));
  });

  installKeyboardShortcuts({
    focusAI: () => {
      setTab('chat');
      window.setTimeout(() => {
        const ta = document.querySelector<HTMLTextAreaElement>('[data-ai-textarea]');
        ta?.focus();
      }, 200);
    },
    focusScore: () => {
      setTab('score');
      window.setTimeout(() => {
        const cm = document.querySelector<HTMLElement>('.cm-content');
        cm?.focus();
      }, 100);
    },
    undoScore: onRollback,
    redoScore: onRedo,
  });

  return (
    <main class="app wc-app">
      {/* ─── TopBar — brand + status + actions ─── */}
      <header class="wc-topbar">
        <BrandLogo size={22} />
        <h1 class="wc-topbar__title">wavecode</h1>
        <span class="wc-topbar__led" data-tone={audioRunning() ? 'running' : 'idle'}>
          <span class="wc-led" data-tone={audioRunning() ? 'running' : 'idle'}>
            {audioRunning() ? `▶ ${ctxState().state}` : `● ${ctxState().state}`}
          </span>
        </span>
        <div class="wc-topbar__actions">
          <button
            type="button"
            class="wc-icon-btn"
            data-tone="ghost"
            onClick={onRollback}
            disabled={appStore.history.length === 0}
            aria-label="Отменить"
            title="Отменить (Ctrl+Z)"
          >
            <UndoIcon size={18} />
          </button>
          <button
            type="button"
            class="wc-icon-btn"
            data-tone="ghost"
            onClick={onRedo}
            disabled={appStore.future.length === 0}
            aria-label="Повторить"
            title="Повторить (Ctrl+Y)"
          >
            <RedoIcon size={18} />
          </button>
          <button
            type="button"
            class="wc-icon-btn"
            data-tone="ghost"
            onClick={onNewComposition}
            aria-label="Новая"
            title="Новая композиция"
          >
            <NewIcon size={18} />
          </button>
          <button
            type="button"
            class="wc-icon-btn"
            data-tone="ghost"
            onClick={() => setShowSavePreset((v) => !v)}
            aria-label="Сохранить"
            title="Сохранить как пресет"
          >
            <SaveIcon size={18} />
          </button>
          <ShareButton />
          <div class="mobile-menu-wrap">
            <button
              type="button"
              class="wc-icon-btn"
              data-tone="ghost"
              onClick={() => setShowMobileMenu((v) => !v)}
              aria-label="Мобильный режим"
              aria-haspopup="true"
              aria-expanded={showMobileMenu()}
            >
              <PhoneIcon size={18} />
            </button>
            <Show when={showMobileMenu()}>
              <div class="mobile-menu" role="menu">
                <For each={(['auto', 'compact', 'full'] as const)}>
                  {(mode) => (
                    <button
                      type="button"
                      class={`mobile-menu-item${mobileMode() === mode ? ' is-active' : ''}`}
                      onClick={() => chooseMobileMode(mode)}
                      role="menuitemradio"
                      aria-checked={mobileMode() === mode}
                    >
                      <span class="mobile-menu-mark">{mobileMode() === mode ? '●' : '○'}</span>
                      <span>
                        {mode === 'auto' ? 'Авто' : mode === 'compact' ? 'Компактно' : 'Полно'}
                      </span>
                      <span class="mobile-menu-hint">
                        {mode === 'auto' ? 'по ширине' : mode === 'compact' ? 'только партитура' : 'все 3 панели'}
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
          <Show when={presetId().startsWith('custom-')}>
            <button
              type="button"
              class="wc-icon-btn"
              data-tone="ghost"
              onClick={onDeletePreset}
              aria-label="Удалить пресет"
            >
              <TrashIcon size={18} />
            </button>
          </Show>
          <button
            type="button"
            class="wc-icon-btn"
            data-tone="ghost"
            onClick={onResetAll}
            aria-label="Сбросить всё"
          >
            <ResetIcon size={18} />
          </button>
        </div>
      </header>

      {/* ─── Preset row (sticky strip) ─── */}
      <div class="app-preset-row" style={{"padding":"var(--space-sm) var(--space-md)","border-bottom":"1px solid var(--border)","background":"var(--surface-0)"}}>
        <select
          class="preset-select"
          value={presetId()}
          onChange={(e) => loadPreset(e.currentTarget.value)}
          title="Готовые пресеты"
        >
          <optgroup label="Встроенные">
            <For each={allPresets().filter((p) => !p.custom)}>
              {(p) => <option value={p.id}>{p.name}{p.artist ? ` · ${p.artist}` : ''}</option>}
            </For>
          </optgroup>
          <Show when={allPresets().some((p) => p.custom)}>
            <optgroup label="Мои">
              <For each={allPresets().filter((p) => p.custom)}>
                {(p) => <option value={p.id}>⭐ {p.name}</option>}
              </For>
            </optgroup>
          </Show>
        </select>
        <div style={{"flex":"1"}} />
        <button
          type="button"
          class="wc-chip"
          data-active={showStepGrid() ? 'true' : 'false'}
          onClick={toggleStepGrid}
        >
          <StepIcon size={14} />
          <span>Step</span>
        </button>
        <button
          type="button"
          class="wc-chip"
          data-active={showPiano() ? 'true' : 'false'}
          onClick={togglePiano}
        >
          <PianoIcon size={14} />
          <span>Piano</span>
        </button>
        <button type="button" class="wc-chip" onClick={() => beep(440)}>440</button>
        <button type="button" class="wc-chip" onClick={() => beep(220)}>220</button>
        <TransportPanel />
      </div>

      <Show when={showSavePreset()}>
        <div class="save-preset-bar">
          <input
            type="text"
            placeholder="Имя пресета"
            value={newPresetName()}
            onInput={(e) => setNewPresetName(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSavePreset(); }}
          />
          <button type="button" class="ctrl-btn ctrl-btn-primary" onClick={onSavePreset} disabled={!newPresetName().trim()}>OK</button>
          <button type="button" class="ctrl-btn" onClick={() => { setShowSavePreset(false); setNewPresetName(''); }}>Отмена</button>
        </div>
      </Show>

      {/* ─── Body — full-screen score, sheets overlay ─── */}
      <div class="app-body">
        <section class="score-panel">
          <Show when={uiState().scoreOpen}>
            <ScorePanel />
          </Show>
        </section>

        <Show when={uiState().aiOpen && getActiveTab() === 'score'}>
          <section class="ai-panel collapsible" data-open="true">
            <CollapsibleHeader
              title="ИИ"
              open={uiState().aiOpen}
              onToggle={toggleAI}
              hint="Ctrl+. фокус · Ctrl+↵ отправить"
              ariaLabel="Панель ИИ"
            />
            <AIEditPanel />
          </section>
        </Show>

        <Show when={uiState().statusOpen && getActiveTab() === 'score'}>
          <aside class="status-panel collapsible" data-open="true">
            <CollapsibleHeader
              title="Состояние"
              open={uiState().statusOpen}
              onToggle={toggleStatus}
              hint="Ctrl+Shift+S"
              ariaLabel="Панель состояния"
            />
            <Show when={uiState().statusOpen}>
              <HelloPanel />
            </Show>
          </aside>
        </Show>
      </div>

      {/* ─── FAB — primary Run/Stop ─── */}
      <FAB
        onClick={onPrimaryAction}
        tone={audioRunning() ? 'magenta' : 'amber'}
        variant={audioRunning() ? 'stop' : 'play'}
        ariaLabel={audioRunning() ? 'Стоп' : 'Запуск'}
      />

      {/* ─── AI bottom-sheet ─── */}
      <BottomSheet kind="ai" title="ИИ-ассистент" subtitle="live-coding chat">
        <AIEditPanel />
      </BottomSheet>

      {/* ─── Mixer bottom-sheet ─── */}
      <BottomSheet kind="mixer" title="Микшер" subtitle="M/S · gain">
        <MixerPanel />
      </BottomSheet>

      {/* ─── Step bottom-sheet ─── */}
      <Show when={showStepGrid()}>
        <BottomSheet kind="step" title="Step grid" subtitle="4×8 pads">
          <div style={{"padding":"var(--space-md) var(--space-lg)"}}>
            <StepGrid />
          </div>
        </BottomSheet>
      </Show>

      {/* ─── Piano bottom-sheet ─── */}
      <Show when={showPiano()}>
        <BottomSheet kind="piano" title="Piano" subtitle="WebMIDI auto-bind">
          <div style={{"padding":"var(--space-md) 0"}}>
            <PianoKeyboard />
          </div>
        </BottomSheet>
      </Show>

      {/* ─── Bottom TabBar (mobile-first) ─── */}
      <TabBar />

      <DebugPanel />
    </main>
  );
}
