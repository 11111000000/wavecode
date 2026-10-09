import { Show, createSignal, onCleanup } from 'solid-js';
import { appStore, dispatch } from '../state/appStore';
import { getDebug } from '~/infrastructure/audio/LiveAudioEngine';
import { CodeMirrorEditor, type CodeMirrorEditorApi } from '../components/CodeMirrorEditor';
import { MidiIOButtons } from '../components/MidiIOButtons';
import { MixerPanel } from '../components/MixerPanel';
import { MiniNotationToolbar } from '../components/MiniNotationToolbar';
import { StepGrid } from '../components/StepGrid';

/**
 * Score panel — ТОЛЬКО редактор + debug-info.
 * Кнопки Eval/Stop/Test живут в header (App.tsx) чтобы быть всегда видны.
 * История диалога (messages) переехала в AIEditPanel.
 *
 * MiniNotationToolbar живёт В DOM под MidiIOButtons; CSS mobile-only
 * (см. `.mini-toolbar` / `@media (max-width: 720px)`).
 * StepGrid показывается поверх editor когда showStepGrid=true (App.tsx).
 */
export function ScorePanel() {
  const [debug, setDebug] = createSignal(getDebug());
  const [showStepGrid, setShowStepGrid] = createSignal(false);
  let editorApi: CodeMirrorEditorApi | undefined;

  const pollId = window.setInterval(() => setDebug(getDebug()), 500);
  onCleanup(() => window.clearInterval(pollId));

  // Listen for App-level "🎹 Step" toggle events (CustomEvent from App).
  if (typeof window !== 'undefined') {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ open: boolean }>).detail;
      setShowStepGrid(detail.open);
    };
    window.addEventListener('wavecode:step-grid', handler as EventListener);
    onCleanup(() => window.removeEventListener('wavecode:step-grid', handler as EventListener));
  }

  return (
    <div class="score-panel-inner">
      <Show when={showStepGrid()}>
        <StepGrid />
      </Show>

      <CodeMirrorEditor
        value={appStore.score}
        onChange={(v) => dispatch({ type: 'replaceScore', text: v })}
        onReady={(api) => {
          editorApi = api;
        }}
      />

      <div class="score-debug">
        <span>триггеры: <strong>{debug().triggers}</strong></span>
        <span>cps: <strong>{debug().cps}</strong></span>
        <Show when={debug().replErr}>
          <span class="debug-err">repl: {debug().replErr}</span>
        </Show>
        <Show when={debug().lastEvalErr}>
          <span class="debug-err">eval: {debug().lastEvalErr}</span>
        </Show>
        <Show when={debug().superdoughErr}>
          <span class="debug-err">super: {debug().superdoughErr}</span>
        </Show>
      </div>

      <MidiIOButtons />
      <MixerPanel />
      <MiniNotationToolbar editor={editorApi} />
    </div>
  );
}
