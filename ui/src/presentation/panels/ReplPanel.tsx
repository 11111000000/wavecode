import { createSignal, Show } from 'solid-js';
import { Effect } from 'effect';
import { dispatch } from '../state/appStore';
import { AppLayer } from '~/infrastructure/composition';
import { AudioEngine } from '~/domain/services';

/**
 * Mini-REPL: textarea для одноразовых Strudel-выражений.
 * Code отправляется в AudioEngine.eval (создаёт Pattern, добавляет в Cyclist).
 * Вывод ошибок отображается в Status панели.
 */
export function ReplPanel() {
  const [text, setText] = createSignal('note("c4").s("sine")');
  const [history, setHistory] = createSignal<string[]>([]);
  const [busy, setBusy] = createSignal(false);

  const submit = async () => {
    const snippet = text().trim();
    if (!snippet) return;
    setBusy(true);
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const audio = yield* AudioEngine;
          yield* audio.eval(snippet);
        }).pipe(Effect.provide(AppLayer)),
      );
      dispatch({ type: 'audioStatusChange', status: 'playing' });
      setHistory([snippet, ...history()].slice(0, 10));
    } catch (err) {
      dispatch({
        type: 'audioStatusChange',
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const audio = yield* AudioEngine;
        yield* audio.stop();
      }).pipe(Effect.provide(AppLayer)),
    );
    dispatch({ type: 'audioStatusChange', status: 'stopped' });
  };

  return (
    <div class="repl-panel-inner">
      <textarea
        aria-label="Strudel expression"
        data-repl-textarea
        placeholder='s("bd sd hh") или n("0 ~ 2 ~ 4").s("sawtooth")'
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter') && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={2}
        style={textareaStyle}
      />
      <details style={{ 'margin-top': '8px' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--fg-dim)', 'font-size': '11px' }}>
          Test audio (direct Web Audio API — bypasses Strudel)
        </summary>
        <button
          type="button"
          style={{ 'margin-top': '4px', 'font-size': '11px' }}
          onClick={() => {
            // Direct OscillatorNode test — if this fails on mobile, audio is broken at browser level
            const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            if (!Ctor) return;
            const ac = new Ctor();
            if (ac.state === 'suspended') ac.resume();
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            gain.gain.value = 0.3;
            osc.frequency.value = 440;
            osc.type = 'sine';
            osc.connect(gain).connect(ac.destination);
            osc.start();
            setTimeout(() => { osc.stop(); ac.close(); }, 1500);
            // eslint-disable-next-line no-console
            console.info('[wavecode audio] direct test tone started');
          }}
        >
          ▶ Play 440Hz test tone (1.5s)
        </button>
      </details>
      <div style={{ display: 'flex', gap: '8px', 'margin-top': '8px' }}>
        <button type="button" onClick={submit} disabled={busy()}>
          ▶ Eval (Ctrl+↵)
        </button>
        <button type="button" onClick={stop}>■ Stop</button>
        <button type="button" onClick={() => setText('hush()')}>hush</button>
      </div>
      <Show when={history().length > 0}>
        <details style={{ 'margin-top': '12px' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--fg-dim)', 'font-size': '12px' }}>
            История ({history().length})
          </summary>
          <ul style={{ 'list-style': 'none', padding: 0, margin: '8px 0 0 0' }}>
            {history().map((h, i) => (
              <li>
                <button
                  type="button"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--fg-dim)',
                    cursor: 'pointer',
                    'font-family': "'SF Mono', Menlo, monospace",
                    'font-size': '12px',
                    padding: '2px 0',
                    'text-align': 'left',
                  }}
                  onClick={() => setText(h)}
                >
                  {i + 1}. {h}
                </button>
              </li>
            ))}
          </ul>
        </details>
      </Show>
    </div>
  );
}

const textareaStyle = {
  width: '100%',
  background: 'var(--bg-elev)',
  color: 'var(--fg)',
  border: '1px solid var(--border)',
  'border-radius': '4px',
  padding: '6px 10px',
  'font-size': '13px',
  'font-family': "'SF Mono', Menlo, monospace",
  resize: 'vertical' as const,
  'box-sizing': 'border-box' as const,
  'min-height': '48px',
  'max-height': '120px',
};