import type { JSX } from 'solid-js';
import { Show, For } from 'solid-js';
import {
  getActiveTab, setTab, type TabId,
} from '../state/uiState';
import {
  TabScoreIcon, TabChatIcon, TabMixerIcon, TabStatusIcon,
} from '../icons';

type Item = {
  id: TabId;
  label: string;
  icon: (p: { size?: number }) => JSX.Element;
  badge?: () => number;
};

const ITEMS: Item[] = [
  { id: 'score',  label: 'Score',  icon: TabScoreIcon },
  { id: 'chat',   label: 'AI',     icon: TabChatIcon  },
  { id: 'mixer',  label: 'Mixer',  icon: TabMixerIcon },
  { id: 'status', label: 'Status', icon: TabStatusIcon },
];

/**
 * TabBar — bottom navigation для mobile-first layout.
 * 4 вкладки: Score, AI, Mixer, Status. На desktop (>=1024) скрыта —
 * панели остаются в flex-stack layout.
 */
export function TabBar(): JSX.Element {
  return (
    <nav class="wc-tabbar" aria-label="Главная навигация">
      <For each={ITEMS}>
        {(item) => (
          <button
            type="button"
            class="wc-tab"
            data-active={getActiveTab() === item.id ? 'true' : 'false'}
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
    </nav>
  );
}
