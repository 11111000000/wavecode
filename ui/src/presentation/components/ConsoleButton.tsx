/**
 * ConsoleButton — fixed bottom-right FAB для открытия ConsoleSheet.
 *
 * - Always visible: position: fixed; safe-area-aware bottom;
 *   size 44×44 (touch-target / WCAG 2.5.5 AAA).
 * - При unreadErrors() > 0: красный фон + pulse-glow анимация.
 * - Бейдж со счётчиком поверх кнопки (top-right corner).
 *
 * Не имеет никаких props — читает состояние напрямую из consoleStore.
 */

import { type JSX, Show } from 'solid-js';
import { consoleStore } from './consoleStore';
import { ConsoleIcon } from '../icons';

export function ConsoleButton(): JSX.Element {
  return (
    <button
      type="button"
      class={`console-btn ${consoleStore.unreadErrors() > 0 ? 'has-errors' : ''}`}
      aria-label="Open console"
      data-testid="console-btn"
      onClick={() => consoleStore.setConsoleOpen(true)}
    >
      <ConsoleIcon size={20} />
      <Show when={consoleStore.unreadErrors() > 0}>
        <span
          class="console-btn-badge"
          data-testid="console-btn-badge"
          aria-label={`${consoleStore.unreadErrors()} unread errors`}
        >
          {consoleStore.unreadErrors() > 99 ? '99+' : consoleStore.unreadErrors()}
        </span>
      </Show>
    </button>
  );
}
