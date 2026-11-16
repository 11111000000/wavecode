import type { JSX } from 'solid-js';
import {
  getActiveTab,
  hasOpenSheet,
  setTab,
  openKindSheet,
  getKindSnap,
} from './uiState';
import { openInputSheet, isInputSheetOpen } from './inputMode';
import {
  TabScoreIcon,
  TabStepIcon,
  TabChatIcon,
  MicIcon,
  TabPianoIcon,
  TabMixerIcon,
  TabVisualizeIcon,
  ConsoleIcon,
  SaveIcon,
  MelodyIcon,
  HandsIcon,
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
  | 'visualize'
  | 'console'
  | 'export'
  | 'melody'
  | 'gesture';

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
  /**
   * Можно ли закрепить инструмент в рельсе.
   *
   * Инструмент tier 1 в рельсе уже всегда — закреплять его нельзя
   * (вторая копия была бы дублированием). У tier 2 закрепление
   * включается по умолчанию, и исключение одно: «Ввод» открывает
   * круглая кнопка, которая висит на экране постоянно, — закреплять
   * его в рельсе незачем, а две точки входа в один лист — это ровно
   * то дублирование, которое wavecode-pinned-tools убирает.
   */
  readonly pinnable?: boolean;
  /**
   * Почему закрепить нельзя — одной строкой, для подсказки.
   *
   * Отдельное поле, а не вычисление в UI: причина принадлежит
   * инструменту, и UI не должен угадывать её по тиру. Без этой
   * строки булавка была бы просто «не нажимается», а пользователь
   * не понимал бы, почему.
   */
  readonly pinNote?: string;
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
    // wavecode-unified-input-entry: «Ввод» ушёл из рельса в tier 2.
    // В рельсе рядом с «ИИ» он читался как второй способ получить
    // музыку, хотя это разные категории: ИИ — адресат (куда уходит
    // материал), Ввод — способ захвата (откуда берётся). Теперь ввод
    // открывает круглая кнопка «Ввод», а из рельса он доступен через
    // лист «Инструменты» и ⌘K.
    id: 'input',
    label: 'Ввод',
    short: 'Ввод',
    description: 'Речь, свист или ритм → партитура',
    tier: 2,
    // Открывается круглой кнопкой «Ввод», которая на экране всегда.
    // В рельсе ему место не нужно: вторая точка входа в тот же лист
    // вернула бы дублирование, которое здесь убирается.
    pinnable: false,
    pinNote: 'Открывается круглой кнопкой «Ввод» — в рельсе незачем',
    icon: MicIcon,
    keywords: ['ввод', 'речь', 'голос', 'микрофон', 'свист', 'ритм', 'voice', 'mic', 'whistle'],
    open: () => openInputSheet(),
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
    // wavecode-sound-choice-and-rhythm-feedback: «Мелодия» — сетка
    // 16×36 с режимами просмотра / наброска / правки. Компонент был
    // готов, покрыт стилями и тестами, но не смонтирован НИГДЕ:
    // возможность была написана и забыта. Теперь у неё свой лист
    // и своя карточка в листе инструментов.
    //
    // Порядок карточек — по смыслу: сначала «что получаем» (ввод,
    // пианино, микшер, мелодия, руки), потом «что делаем с этим»
    // (визуализация, экспорт) и «что случилось» (консоль).
    id: 'melody',
    label: 'Мелодия',
    short: 'Мелодия',
    description: 'Сетка высот 16×36 с правкой нот',
    tier: 2,
    icon: MelodyIcon,
    keywords: ['мелодия', 'сетка', 'высота', 'pitch', 'melody', 'grid', 'ноты'],
    open: () => openKindSheet('melody', 'full'),
  },
  {
    // wavecode-sound-choice-and-rhythm-feedback: «Руки» открывались
    // только из вкладки «Свист» листа ввода — то есть возможность
    // была спрятана в глубине другого инструмента и не была видна
    // ни в рельсе, ни в листе инструментов, ни в палитре ⌘K.
    id: 'gesture',
    label: 'Руки',
    short: 'Руки',
    description: 'Управление жестами перед камерой',
    tier: 2,
    icon: HandsIcon,
    keywords: ['руки', 'жесты', 'gesture', 'камера', 'управление'],
    open: () => openKindSheet('gesture', 'half'),
  },
  {
    // wavecode-unified-input-entry: отдельного инструмента «Микрофон»
    // (и «Свист») больше нет — свист живёт вкладкой «Свист» листа
    // ввода. Иначе одно и то же устройство называлось бы в двух
    // местах интерфейса, и пользователь не знал бы, куда нажать.
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
      return isInputSheetOpen();
    case 'piano':
      return getActiveTab() === 'piano';
    case 'mixer':
      return getActiveTab() === 'mixer';
    case 'visualize':
      return getActiveTab() === 'visualize';
    case 'export':
      return getKindSnap('export') !== 'closed';
    case 'console':
      return getKindSnap('status') !== 'closed';
    case 'melody':
      return getKindSnap('melody') !== 'closed';
    case 'gesture':
      return getKindSnap('gesture') !== 'closed';
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
