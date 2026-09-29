import { Show } from 'solid-js';
import { appStore } from '../state/appStore';

const statusClass = (s: string): string => `status-${s}`;

export function HelloPanel() {
  return (
    <div>
      <dl class="status-grid">
        <dt>agent</dt>
        <dd class={statusClass(appStore.agent.status)}>{appStore.agent.status}</dd>
        <dt>audio</dt>
        <dd class={statusClass(appStore.audio.status)}>{appStore.audio.status}</dd>
        <dt>score</dt>
        <dd>{appStore.score.length} chars</dd>
        <dt>messages</dt>
        <dd>{appStore.messages.length}</dd>
        <Show when={appStore.audio.lastError}>
          <dt>audio error</dt>
          <dd class="status-error status-error-message">{appStore.audio.lastError}</dd>
        </Show>
      </dl>
      <p class="status-footer">Strudel в браузере, синтез через Web Audio API.</p>
    </div>
  );
}
