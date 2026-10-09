import { Show, createSignal, onCleanup } from 'solid-js';
import { appStore, dispatch } from '../state/appStore';
import { getDebug } from '~/infrastructure/audio/LiveAudioEngine';
import { CodeMirrorEditor, type CodeMirrorEditorApi } from '../components/CodeMirrorEditor';
import { MidiIOButtons } from '../components/MidiIOButtons';
import { MixerPanel } from '../components/MixerPanel';
import { MiniNotationToolbar } from '../components/MiniNotationToolbar';

/**
 * Score panel — ТОЛЬКО редактор + debug-info.
 * Кнопки Eval/Stop/Test живут в header (App.tsx) чтобы быть всегда видны.
 * История диалога (messages) переехала в AIEditPanel.
 *
 * MiniNotationToolbar живёт В DOM под MidiIOButtons; CSS mobile-only
 * (см. `.mini-toolbar` / `@media (max-width: 720px)`).
 */
export function ScorePanel() {
  const [debug, setDebug] = createSignal(getDebug());
  let editorApi: CodeMirrorEditorApi | undefined;

  const pollId = window.setInterval(() => setDebug(getDebug()), 500);
  onCleanup(() => window.clearInterval(pollId));

  return (
    <div class="score-panel-inner">
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
