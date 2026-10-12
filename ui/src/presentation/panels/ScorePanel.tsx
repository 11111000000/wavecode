import { Show, Suspense, createSignal, onCleanup } from 'solid-js';
import { appStore, dispatch } from '../state/appStore';
import { getDebug } from '~/infrastructure/audio/LiveAudioEngine';
import { CodeMirrorEditor, type CodeMirrorEditorApi } from '../components/CodeMirrorEditor';
import { MiniNotationToolbar } from '../components/MiniNotationToolbar';

/**
 * Score panel — ТОЛЬКО редактор + debug-info + mini-notation toolbar.
 *
 * Mixer / Step / Piano / MIDI I/O перенесены в BottomSheet (через табы
 * TabBar внизу), чтобы не дублировать и не конкурировать за вертикальное
 * место с редактором. App.tsx дёргает `wavecode:step-grid` / `wavecode:piano`
 * events, которые BottomSheet слушает (см. presentation/components/BottomSheet).
 *
 * <Suspense> wrapper нужен для lazy CodeMirrorEditor — пока chunk
 * подгружается (первый scoreOpen), показываем placeholder высотой
 * редактора, чтобы не схлопывался layout.
 */
export function ScorePanel() {
  const [debug, setDebug] = createSignal(getDebug());
  let editorApi: CodeMirrorEditorApi | undefined;

  const pollId = window.setInterval(() => setDebug(getDebug()), 500);
  onCleanup(() => window.clearInterval(pollId));

  return (
    <div class="score-panel-inner">
      <Show when={appStore.score.trim().length === 0}>
        <div class="score-empty-state" role="note" aria-label="Подсказки для старта">
          <p>Нажми ▶ чтобы запустить шаблон</p>
          <p>Открой Piano → tap для звука</p>
          <p>Или напиши ИИ: "сделай бит"</p>
        </div>
      </Show>
      <Suspense fallback={<div class="cm-host cm-host-fill cm-loading">загрузка редактора…</div>}>
        <CodeMirrorEditor
          value={appStore.score}
          onChange={(v) => dispatch({ type: 'replaceScore', text: v })}
          onReady={(api) => {
            editorApi = api;
          }}
        />
      </Suspense>

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

      <MiniNotationToolbar editor={() => editorApi} />
    </div>
  );
}
