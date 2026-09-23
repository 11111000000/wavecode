import { createStore } from 'solid-js/store';

type UIState = {
  chatOpen: boolean;
  editorOpen: boolean;
  theme: 'dark' | 'light';
};

export const [uiStore, setUIStore] = createStore<UIState>({
  chatOpen: true,
  editorOpen: true,
  theme: 'dark',
});