import type { JSX } from 'solid-js';
import {
  getActiveTab,
  hasOpenSheet,
  setTab,
  openKindSheet,
  getKindSnap,
} from './uiState';
import { openInputDock, isInputDockOpen } from './inputMode';
import {
  TabScoreIcon,
  TabStepIcon,
  TabChatIcon,
  MicIcon,
  TabPianoIcon,
  TabMixerIcon,
  TabMicIcon,
  TabVisualizeIcon,
  ConsoleIcon,
  SaveIcon,
} from '../icons';

/**
 * toolRegistry — единственный список инструментов приложения.
 *
 * wavecode-zen-minimal-ui (ревизия 2, пункт 12): из одного списка
 * строятся рельс (tier 1), лист «Инструменты» (tier 2), палитра
 * команд и e2e-проверка достижимости. Пока инструмент не описан здесь,
 * его нельзя вывести в интерфейс — и наоборот: описать здесь и забыть
 * вывести нельзя, потому что e2e-тест идёт по этому же списку.
 *
 * Tier 1 — постоянная навигация (рельс). Tier 2 — всё, что помещается
 * в один лист «Инструменты». Глубина раскрытия при этом ≤ 2.
 */
export type ToolId =
  | 'score'
  | 'step'
  | 'ai'
  | 'input'
  | 'piano'
  | 'mixer'
  | 'mic'
  | 'visualize'
  | 'console'
  | 'export';

export type ToolTier = 1 | 2;

export type ToolEntry = {
  readonly id: ToolId;
  /** Полное имя — для листа «Инструменты» и палитры команд. */
  readonly label: string;
  /** Короткая подпись — под иконкой в рельсе. */
  readonly short: string;
  /** Одно предложение о том, что делает инструмент. */
  readonly description: string;
  readonly tier: ToolTier;
  readonly icon: (p: { size?: number }) => JSX.Element;
  /** Слова для поиска в палитре команд. */
  readonly keywords: readonly string[];
  readonly open: () => void;
};

export const TOOLS: readonly ToolEntry[] = [
  {
    id: 'score',
    label: 'Нотная',
    short: 'Нотная',
    description: 'Партитура и редактор кода',
    tier: 1,
    icon: TabScoreIcon,
    keywords: ['партитура', 'код', 'редактор', 'score', 'editor'],
    open: () => setTab('score'),
  },
  {
    id: 'step',
    label: 'Шаги',
    short: 'Шаги',
    description: 'Пошаговый селектор 4×8',
    tier: 1,
    icon: TabStepIcon,
    keywords: ['селектор', 'шаги', 'grid', 'step', 'паттерн'],
    open: () => setTab('step'),
  },
  {
    id: 'ai',
    label: 'ИИ',
    short: 'ИИ',
    description: 'Ассистент: правка партитуры словами',
    tier: 1,
    icon: TabChatIcon,
    keywords: ['ии', 'ai', 'чат', 'ассистент', 'промпт'],
    open: () => setTab('chat'),
  },
  {
    id: 'input',
    label: 'Ввод',
    short: 'Ввод',
    description: 'Голос или ритм → партитура',
    tier: 1,
    icon: MicIcon,
    keywords: ['ввод', 'голос', 'микрофон', 'ритм', 'voice', 'mic'],
    open: () => openInputDock(),
  },
  {
    id: 'piano',
    label: 'Пианино',
    short: 'Пианино',
    description: 'Клавиатура и WebMIDI',
    tier: 2,
    icon: TabPianoIcon,
    keywords: ['пианино', 'клавиатура', 'midi', 'piano', 'ноты'],
    open: () => setTab('piano'),
  },
  {
    id: 'mixer',
    label: 'Микшер',
    short: 'Микшер',
    description: 'Дорожки, mute/solo и громкость',
    tier: 2,
    icon: TabMixerIcon,
    keywords: ['микшер', 'дорожки', 'громкость', 'mixer', 'gain'],
    open: () => setTab('mixer'),
  },
  {
    id: 'mic',
    label: 'Микрофон',
    short: 'Мик',
    description: 'Запись звука в Strudel',
    tier: 2,
    icon: TabMicIcon,
    keywords: ['микрофон', 'запись', 'сэмпл', 'mic', 'record'],
    open: () => setTab('mic'),
  },
  {
    id: 'visualize',
    label: 'Визуализация',
    short: 'Визуал',
    description: 'Карта цикла и спектр',
    tier: 2,
    icon: TabVisualizeIcon,
    keywords: ['визуализация', 'спектр', 'график', 'visualize', 'wave'],
    open: () => setTab('visualize'),
  },
  {
    id: 'export',
    label: 'Экспорт',
    short: 'Экспорт',
    description: 'WAV, MIDI и текст партитуры',
    tier: 2,
    icon: SaveIcon,
    keywords: ['экспорт', 'wav', 'midi', 'скачать', 'export', 'download'],
    open: () => openKindSheet('export', 'half'),
  },
  {
    id: 'console',
    label: 'Консоль',
    short: 'Консоль',
    description: 'Логи, ошибки и состояние рантайма',
    tier: 2,
    icon: ConsoleIcon,
    keywords: ['консоль', 'логи', 'ошибки', 'console', 'logs'],
    open: () => openKindSheet('status', 'half'),
  },
];

export const TIER1_TOOLS = TOOLS.filter((t) => t.tier === 1);
export const TIER2_TOOLS = TOOLS.filter((t) => t.tier === 2);

export const getTool = (id: ToolId): ToolEntry | undefined =>
  TOOLS.find((t) => t.id === id);

/** Активен ли инструмент прямо сейчас — для подсветки в рельсе. */
export const isToolActive = (id: ToolId): boolean => {
  switch (id) {
    case 'score':
      return getActiveTab() === 'score' && !hasOpenSheet();
    case 'step':
      return getActiveTab() === 'step';
    case 'ai':
      return getActiveTab() === 'chat';
    case 'input':
      return isInputDockOpen();
    case 'piano':
      return getActiveTab() === 'piano';
    case 'mixer':
      return getActiveTab() === 'mixer';
    case 'mic':
      return getActiveTab() === 'mic';
    case 'visualize':
      return getActiveTab() === 'visualize';
    case 'export':
      return getKindSnap('export') !== 'closed';
    case 'console':
      return getKindSnap('status') !== 'closed';
  }
};

/** Поиск по названию, описанию и ключевым словам — для палитры команд. */
export const searchTools = (query: string): readonly ToolEntry[] => {
  const q = query.trim().toLowerCase();
  if (!q) return TOOLS;
  return TOOLS.filter((t) => {
    const haystack = `${t.label} ${t.description} ${t.keywords.join(' ')}`.toLowerCase();
    return haystack.includes(q);
  });
};
