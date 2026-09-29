import { Show, For } from 'solid-js';
import { Effect } from 'effect';
import { appStore, dispatch } from '../state/appStore';
import { AppLayer } from '~/infrastructure/composition';
import { AudioEngine } from '~/domain/services';
import { CodeMirrorEditor } from '../components/CodeMirrorEditor';

export function ScorePanel() {
  const evalScore = async () => {
    dispatch({ type: 'audioStatusChange', status: 'playing' });
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const audio = yield* AudioEngine;
          yield* audio.eval(appStore.score);
        }).pipe(Effect.provide(AppLayer)),
      );
    } catch (err) {
      dispatch({
        type: 'audioStatusChange',
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const stopAudio = async () => {
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const audio = yield* AudioEngine;
          yield* audio.stop();
        }).pipe(Effect.provide(AppLayer)),
      );
      dispatch({ type: 'audioStatusChange', status: 'stopped' });
    } catch (err) {
      dispatch({
        type: 'audioStatusChange',
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div class="score-panel-inner">
      <CodeMirrorEditor
        value={appStore.score}
        onChange={(v) => dispatch({ type: 'replaceScore', text: v })}
      />

      <div class="score-controls">
        <button type="button" onClick={() => void evalScore()}>▶ Eval (play)</button>
        <button type="button" onClick={() => void stopAudio()}>■ Stop</button>
      </div>

      <Show when={appStore.messages.length > 0}>
        <h3 class="messages-heading">Messages ({appStore.messages.length})</h3>
        <ul class="messages-list">
          <For each={appStore.messages}>
            {(m) => <li class={`message-item message-${m.role}`}><strong>{m.role}:</strong> {m.content}</li>}
          </For>
        </ul>
      </Show>
    </div>
  );
}
