/**
 * ConsoleButton — topbar icon button для открытия ConsoleSheet.
 *
 * - Lives in .wc-topbar__actions (inline in the chrome header, not
 *   floating). Size/visual: 44×44 wc-icon-btn, matches New/Undo/Redo.
 * - При unreadErrors() > 0: красный текст + err-soft фон + pulse-glow
 *   анимация, плюс бейдж со счётчиком в правом-верхнем углу.
 *
 * Hotkey hint (Phase-2 polish):
 *   - title attribute показывает платформо-зависимый хинт:
 *     "Console (Cmd+`)" на Mac, "Console (Ctrl+`)" на остальных.
 *   - Detection: prefer `navigator.userAgentData?.platform` (modern
 *     and standards-track); fall back to deprecated `navigator.platform`
 *     if UAData absent (Safari / older browsers). UADataData is itself
 *     a feature-detected addition (Chromium 90+) — falls back
 *     gracefully. Result is captured at module-load time: button
 *     doesn't re-detect on every render.
 *
 * Не имеет никаких props — читает состояние напрямую из consoleStore.
 */

import { type JSX, Show } from 'solid-js';
import { consoleStore } from './consoleStore';
import { ConsoleIcon } from '../icons';

const detectMacPlatform = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  // Prefer UAData (modern, standards-track; Chrome 90+).
  const uaData = (
    navigator as Navigator & {
      userAgentData?: { platform?: string };
    }
  ).userAgentData;
  if (uaData?.platform) {
    return uaData.platform.toLowerCase().includes('mac');
  }
  // Fallback: deprecated `navigator.platform`. Still works in
  // Safari / Firefox / older Chromium; matches `"MacIntel"` etc.
  if (typeof navigator.platform === 'string') {
    return navigator.platform.toLowerCase().includes('mac');
  }
  return false;
};

const IS_MAC = detectMacPlatform();
const MODIFIER_LABEL = IS_MAC ? 'Cmd' : 'Ctrl';
const CONSOLE_BUTTON_TITLE = `Console (${MODIFIER_LABEL}+\`)`;

export function ConsoleButton(): JSX.Element {
  return (
    <button
      type="button"
      class={`wc-icon-btn console-btn ${consoleStore.unreadErrors() > 0 ? 'has-errors' : ''}`}
      aria-label="Open console"
      title={CONSOLE_BUTTON_TITLE}
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
