import { createSignal, For, Show } from 'solid-js';
import { Effect } from 'effect';
import { appStore, dispatch } from '../state/appStore';
import { AppLayer } from '~/infrastructure/composition';
import { AudioEngine } from '~/domain/services';
import { CodeMirrorEditor } from '../components/CodeMirrorEditor';

export function ScorePanel() {
  const [draft, setDraft] = createSignal('');
  const [findText, setFindText] = createSignal('');
  const [replaceText, setReplaceText] = createSignal('');

  const submitUserMessage = () => {
    const text = draft().trim();
    if (!text) return;
    dispatch({ type: 'userMessage', text });
    dispatch({ type: 'agentStatusChange', status: 'idle' });
    setDraft('');
  };

  const applyEdit = () => {
    const oldText = findText();
    const newText = replaceText();
    if (!oldText) return;
    try {
      dispatch({ type: 'editScore', oldText, newText });
      setFindText('');
      setReplaceText('');
    } catch (err) {
      dispatch({
        type: 'agentStatusChange',
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const evalScore = async () => {
    dispatch({ type: 'audioStatusChange', status: 'playing' });
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const audio = yield* AudioEngine;
          yield* audio.eval(appStore.score);
        }).pipe(Effect.provide(AppLayer))
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
        }).pipe(Effect.provide(AppLayer))
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
      <h2>Score</h2>
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

      <h3 style={{ 'margin-top': '24px' }}>Edit (applyEdit demo)</h3>
      <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
        <input
          aria-label="oldText"
          placeholder="oldText (должен встречаться ровно один раз)"
          value={findText()}
          onInput={(e) => setFindText(e.currentTarget.value)}
          style={inputStyle}
        />
        <input
          aria-label="newText"
          placeholder="newText"
          value={replaceText()}
          onInput={(e) => setReplaceText(e.currentTarget.value)}
          style={inputStyle}
        />
        <button type="button" onClick={applyEdit}>
          Применить edit_score
        </button>
      </div>

      <h3 style={{ 'margin-top': '24px' }}>User message → agent (mock)</h3>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          aria-label="user message"
          placeholder="Скажите что-нибудь агенту…"
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitUserMessage();
          }}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button type="button" onClick={submitUserMessage}>
          Отправить
        </button>
      </div>

      <Show when={appStore.messages.length > 0}>
        <h3 style={{ 'margin-top': '24px' }}>Messages ({appStore.messages.length})</h3>
        <ul style={{ 'list-style': 'none', padding: 0, margin: 0 }}>
          <For each={appStore.messages}>
            {(m) => (
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
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

const inputStyle = {
  background: 'var(--bg-elev)',
  color: 'var(--fg)',
  border: '1px solid var(--border)',
  'border-radius': '4px',
  padding: '6px 10px',
  'font-size': '13px',
  'font-family': 'inherit',
};