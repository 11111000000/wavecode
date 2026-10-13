import { For, type JSX } from 'solid-js';
import {
  TabMixerIcon, TabChatIcon, TabStatusIcon, StepIcon, PianoIcon,
} from '../icons';
import { setTab, getActiveTab, type TabId } from '../state/uiState';

/**
 * SheetTabs — secondary navigation between tools when a BottomSheet
 * is open on mobile. Renders inside the sheet header (after title,
 * before action buttons) and switches between Mixer / AI / Status /
 * Step / Piano without closing the sheet itself.
 *
 * Rendered unconditionally by every BottomSheet; visibility is
 * controlled by the parent sheet's snap state — when `data-snap=
 * 'closed'` the sheet has `height: 0` and `visibility: hidden`, so
 * tabs disappear automatically.
 *
 * Sheet-tabs is intentionally NOT the primary navigation. The
 * primary nav is the BottomNav (TabBar) at the bottom of the
 * viewport, with a "Score" tab that closes every sheet via
 * `setTab('score')` → `closeAllSheets()`. The two-level pattern
 * mirrors GarageBand iOS / Telegram mobile sheets.
 */

export type SheetTab = {
  readonly id: TabId;
  readonly label: string;
  readonly icon: (p: { size?: number }) => JSX.Element;
  readonly ariaLabel: string;
};

const SHEET_TABS: ReadonlyArray<SheetTab> = [
  { id: 'mixer',  label: 'Mixer',  icon: TabMixerIcon,  ariaLabel: 'Открыть микшер' },
  { id: 'chat',   label: 'AI',     icon: TabChatIcon,   ariaLabel: 'Открыть ИИ-ассистент' },
  { id: 'status', label: 'Status', icon: TabStatusIcon, ariaLabel: 'Открыть статус' },
  { id: 'step',   label: 'Step',   icon: StepIcon,      ariaLabel: 'Открыть step grid' },
  { id: 'piano',  label: 'Piano',  icon: PianoIcon,     ariaLabel: 'Открыть пианино' },
];

export const SheetTabs = (): JSX.Element => {
  return (
    <div class="wc-sheet__tabs" role="tablist" aria-label="Переключение инструментов">
      <For each={SHEET_TABS}>
        {(tab) => (
          <button
            type="button"
            class="wc-sheet__tab"
            data-active={getActiveTab() === tab.id ? 'true' : 'false'}
            data-tab={tab.id}
            role="tab"
            aria-selected={getActiveTab() === tab.id}
            aria-label={tab.ariaLabel}
            title={tab.label}
            onClick={() => setTab(tab.id)}
          >
            <tab.icon size={14} />
            <span class="wc-sheet__tab-label">{tab.label}</span>
          </button>
        )}
      </For>
    </div>
  );
};