import type { JSX } from 'solid-js';
import { Show, For } from 'solid-js';
import {
  getActiveTab, setTab, hasOpenSheet, type TabId,
} from '../state/uiState';
import {
  TabScoreIcon, TabStepIcon, TabPianoIcon, TabMixerIcon, TabChatIcon, TabStatusIcon,
} from '../icons';
import { SampleProgressBadge } from './SampleProgressBadge';

type Item = {
  id: TabId;
  label: string;
  icon: (p: { size?: number }) => JSX.Element;
  badge?: () => number;
};

const ITEMS: Item[] = [
  { id: 'score',  label: 'Score',  icon: TabScoreIcon  },
  { id: 'step',   label: 'Step',   icon: TabStepIcon   },
  { id: 'piano',  label: 'Piano',  icon: TabPianoIcon  },
  { id: 'mixer',  label: 'Mixer',  icon: TabMixerIcon  },
  { id: 'chat',   label: 'AI',     icon: TabChatIcon   },
  { id: 'status', label: 'Status', icon: TabStatusIcon },
];

/**
 * TabBar — единый bottom navigation для mobile-first layout.
 * 6 вкладок: Score, Step, Piano, Mixer, AI, Status. Каждый таб кроме
 * Score открывает соответствующий BottomSheet (см. setTab в uiState).
 * На desktop (>=1024) скрыта — панели остаются в flex-stack layout.
 *
 * До packet wavecode-bottom-bar-unified: 3 таба (score/ai/status) +
 * отдельный BottomToolstrip с 3 кнопками (step/piano/mixer) над баром.
 * На mobile-вьюпортах toolstrip был невидим (z-index/safe-bottom
 * конфликт, иконки 16px на тёмном фоне). Слито в TabBar.
 */
export function TabBar(): JSX.Element {
  return (
    <nav class="wc-tabbar" aria-label="Главная навигация">
      <div class="wc-tabbar__tabs">
        <For each={ITEMS}>
          {(item) => (
            <button
              type="button"
              class="wc-tab"
              data-active={getActiveTab() === item.id ? 'true' : 'false'}
              data-has-open-sheet={item.id === 'score' && hasOpenSheet() ? 'true' : 'false'}
              onClick={() => setTab(item.id)}
              aria-label={item.label}
              aria-pressed={getActiveTab() === item.id}
            >
              <item.icon size={20} />
              <span class="wc-tab__label">{item.label}</span>
              <Show when={item.badge && item.badge() > 0}>
                <span class="wc-tab__badge">{item.badge!()}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
      <SampleProgressBadge />
    </nav>
  );
}
