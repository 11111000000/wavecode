import { Show, createSignal, onCleanup } from 'solid-js';
import { appStore, dispatch } from '../state/appStore';
import { getDebug } from '~/infrastructure/audio/LiveAudioEngine';
import { CodeMirrorEditor } from '../components/CodeMirrorEditor';

/**
 * Score panel — ТОЛЬКО редактор + debug-info.
 * Кнопки Eval/Stop/Test живут в header (App.tsx) чтобы быть всегда видны.
 * История диалога (messages) переехала в AIEditPanel.
 */
export function ScorePanel() {
  const [debug, setDebug] = createSignal(getDebug());

  const pollId = window.setInterval(() => setDebug(getDebug()), 500);
  onCleanup(() => window.clearInterval(pollId));

  return (
    <div class="score-panel-inner">
      <CodeMirrorEditor
        value={appStore.score}
        onChange={(v) => dispatch({ type: 'replaceScore', text: v })}
      />

      <div class="score-debug">
        <span>triggers: <strong>{debug().triggers}</strong></span>
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
    </div>
  );
}
