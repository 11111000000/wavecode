import { Show } from 'solid-js';
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

      <div style={{ display: 'flex', gap: '8px', 'margin-top': '12px' }}>
        <button type="button" onClick={evalScore}>
          ▶ Eval (play)
        </button>
        <button type="button" onClick={stopAudio}>
          ■ Stop
        </button>
      </div>

      <Show when={appStore.messages.length > 0}>
        <h3 style={{ 'margin-top': '24px' }}>Messages ({appStore.messages.length})</h3>
        <ul style={{ 'list-style': 'none', padding: 0, margin: 0 }}>
          {appStore.messages.map((m) => (
            <li
              style={{
                'border-left': `3px solid ${m.role === 'user' ? 'var(--accent)' : 'var(--ok)'}`,
                'padding-left': '12px',
                'margin-bottom': '8px',
                color: 'var(--fg-dim)',
                'font-size': '12px',
              }}
            >
              <strong style={{ color: 'var(--fg)' }}>{m.role}:</strong> {m.content}
            </li>
          ))}
        </ul>
      </Show>
    </div>
  );
}