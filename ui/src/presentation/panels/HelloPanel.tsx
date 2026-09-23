import { Show } from 'solid-js';
import { appStore } from '../state/appStore';

const statusClass = (s: string): string => `status-${s}`;

export function HelloPanel() {
  return (
    <div>
      <h2>Status</h2>
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
          <dd class="status-error" style={{ 'font-size': '11px', 'word-break': 'break-word' }}>
            {appStore.audio.lastError}
          </dd>
        </Show>
      </dl>
      <p style={{ 'margin-top': '20px', color: 'var(--fg-dim)', 'font-size': '12px' }}>
        Синтез через n() + s(osc). samples не подгружены.
      </p>
    </div>
  );
}