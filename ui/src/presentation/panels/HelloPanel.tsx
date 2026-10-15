import { Show } from 'solid-js';
import { appStore } from '../state/appStore';

const statusClass = (s: string): string => `status-${s}`;

export function HelloPanel() {
  const active = (): { score: string; messages: ReadonlyArray<unknown> } | undefined => {
    const t = appStore.tracks.find((x) => x.id === appStore.activeTrackId);
    return t ? { score: t.score, messages: t.messages } : undefined;
  };
  return (
    <div>
      <dl class="status-grid">
        <dt>агент</dt>
        <dd class={statusClass(appStore.agent.status)}>{appStore.agent.status}</dd>
        <dt>аудио</dt>
        <dd class={statusClass(appStore.audio.status)}>{appStore.audio.status}</dd>
        <dt>треков</dt>
        <dd>{appStore.tracks.length}</dd>
        <dt>партитура</dt>
        <dd>{active()?.score.length ?? 0} симв.</dd>
        <dt>сообщения</dt>
        <dd>{active()?.messages.length ?? 0}</dd>
        <Show when={appStore.audio.lastError}>
          <dt>ошибка аудио</dt>
          <dd class="status-error status-error-message">{appStore.audio.lastError}</dd>
        </Show>
      </dl>
      <p class="status-footer">Strudel в браузере, синтез через Web Audio API.</p>
    </div>
  );
}
