import { createSignal } from 'solid-js';

import {
  DEFAULT_LANGUAGE_MODE,
  isLanguageMode,
  type LanguageMode,
} from '~/domain/languageMode';

const STORAGE_KEY = 'wavecode:languageMode';

const load = (): LanguageMode => {
  if (typeof localStorage === 'undefined') return DEFAULT_LANGUAGE_MODE;
  const raw = localStorage.getItem(STORAGE_KEY);
  return isLanguageMode(raw) ? raw : DEFAULT_LANGUAGE_MODE;
};

const save = (mode: LanguageMode): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode / quota — ignore */
  }
};

const [mode, setModeSignal] = createSignal<LanguageMode>(load());

export const languageMode = mode;

export const setLanguageMode = (next: LanguageMode): void => {
  if (!isLanguageMode(next)) return;
  if (mode() === next) return;
  setModeSignal(next);
  save(next);
};