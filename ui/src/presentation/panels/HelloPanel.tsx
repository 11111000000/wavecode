import { Show } from 'solid-js';
import { appStore } from '../state/appStore';
import { AGENT_STATUS_LABEL, AUDIO_STATUS_LABEL, labelFor } from '../state/labels';

const statusClass = (s: string): string => `status-${s}`;

export function HelloPanel() {
  return (
    <div>
      <dl class="status-grid">
        <dt>агент</dt>
        <dd class={statusClass(appStore.agent.status)}>
          {labelFor(AGENT_STATUS_LABEL, appStore.agent.status)}
        </dd>
        <dt>аудио</dt>
        <dd class={statusClass(appStore.audio.status)}>
          {labelFor(AUDIO_STATUS_LABEL, appStore.audio.status)}
        </dd>
        <dt>партитура</dt>
        <dd>{appStore.score.length} симв.</dd>
        <dt>сообщения</dt>
        <dd>{(appStore.dialogs[appStore.activePresetId] ?? []).length}</dd>
        <Show when={appStore.audio.lastError}>
          <dt>ошибка аудио</dt>
          <dd class="status-error status-error-message">{appStore.audio.lastError}</dd>
        </Show>
      </dl>
      <p class="status-footer">Strudel в браузере, синтез через Web Audio API.</p>
    </div>
  );
}
