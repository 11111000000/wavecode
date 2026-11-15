import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { InputSheet } from './InputSheet';
import {
  closeInputSheet,
  getInputMode,
  openInputSheet,
  setInputMode,
} from '../../state/inputMode';

/**
 * InputSheet — лист ввода с тремя вкладками.
 *
 * wavecode-unified-input-entry: главный тест здесь — не «что умеет
 * каждая вкладка», а «как пользователь отличает модальности». Три
 * вкладки названы по намерению (Речь / Свист / Ритм), и активная всегда
 * помечена — поэтому вопрос «я сейчас голос записываю мелодию или
 * ритм?» снимается самим интерфейсом.
 */

// Микрофон и ритм трогают реальное железо — в тесте им достаточно
// заглушки: проверяется структура листа, а не работа захвата.
vi.mock('../MicPanel', () => ({
  MicPanel: () => <div class="mic-panel-stub" data-testid="mic-body" />,
}));
vi.mock('../RhythmCapture', () => ({
  RhythmCapture: () => <div class="rhythm-stub" data-testid="rhythm-body" />,
}));

const tabs = (container: HTMLElement): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('.input-tab'));

/**
 * Вкладка по индексу — с проверкой, что она вообще есть.
 *
 * `noUncheckedIndexedAccess` включён, а `!` в тесте читается как
 * «разработчик проверил глазами». Здесь проверка настоящая: вкладки
 * должны быть, иначе тест падает на понятном сообщении.
 */
const tabAt = (container: HTMLElement, index: number): HTMLButtonElement => {
  const tab = tabs(container)[index];
  if (!tab) throw new Error(`вкладка ${index} отсутствует`);
  return tab;
};

/** jsdom не умеет matchMedia, а BottomSheet на нём держит снап листа. */
const setMatchMedia = (matches: boolean): void => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query === '(max-width: 720px)' ? matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
};

beforeEach(() => {
  setMatchMedia(false);
  closeInputSheet();
  setInputMode('speech');
  // BottomSheet рендерит содержимое только пока лист открыт — поэтому
  // вкладки появляются после openInputSheet(), а не раньше.
  openInputSheet();
});

afterEach(() => {
  cleanup();
  closeInputSheet();
  setInputMode('speech');
});

describe('InputSheet — лист ввода', () => {
  it('показывает ровно три вкладки, названные по намерению', () => {
    const { container } = render(() => <InputSheet />);
    expect(tabs(container).map((t) => t.textContent?.trim())).toEqual([
      'Речь',
      'Свист',
      'Ритм',
    ]);
  });

  it('открытая вкладка помечена, остальные — нет', () => {
    const { container } = render(() => <InputSheet />);
    const speech = tabAt(container, 0);
    const whistle = tabAt(container, 1);
    expect(speech.getAttribute('data-active')).toBe('true');
    expect(speech.getAttribute('aria-selected')).toBe('true');
    expect(whistle.getAttribute('data-active')).toBe('false');
  });

  it('переключение вкладки меняет модальность', () => {
    const { container } = render(() => <InputSheet />);
    const whistle = tabAt(container, 1);
    const rhythm = tabAt(container, 2);
    fireEvent.click(whistle);
    expect(getInputMode()).toBe('whistle');
    expect(whistle.getAttribute('data-active')).toBe('true');
    fireEvent.click(rhythm);
    expect(getInputMode()).toBe('rhythm');
  });

  it('тело вкладки соответствует выбранной модальности', () => {
    const { container, queryByTestId } = render(() => <InputSheet />);
    expect(queryByTestId('mic-body')).toBeNull();
    fireEvent.click(tabAt(container, 1));
    expect(queryByTestId('mic-body')).toBeTruthy();
    expect(queryByTestId('rhythm-body')).toBeNull();
  });

  it('вкладки объясняют, что делает каждая', () => {
    const { container } = render(() => <InputSheet />);
    const titles = tabs(container).map((t) => t.getAttribute('title') ?? '');
    expect(titles[0]).toContain('Говорите');
    expect(titles[1]).toContain('Свистите');
    expect(titles[2]).toContain('Стучите');
  });

  it('лист открыт и содержит тело выбранной модальности', () => {
    const { container } = render(() => <InputSheet />);
    expect(container.querySelector('.wc-sheet')).toBeTruthy();
    expect(container.querySelector('.input-tabs')).toBeTruthy();
  });

  it('стрелки переключают вкладку и уводят на неё фокус', () => {
    const { container } = render(() => <InputSheet />);
    const speech = tabAt(container, 0);
    speech.focus();

    // Вправо — следующая вкладка.
    fireEvent.keyDown(speech, { key: 'ArrowRight' });
    expect(getInputMode()).toBe('whistle');
    expect(document.activeElement).toBe(tabAt(container, 1));

    // Влево — предыдущая.
    fireEvent.keyDown(tabAt(container, 1), { key: 'ArrowLeft' });
    expect(getInputMode()).toBe('speech');

    // End — последняя, Home — первая.
    fireEvent.keyDown(tabAt(container, 0), { key: 'End' });
    expect(getInputMode()).toBe('rhythm');
    fireEvent.keyDown(tabAt(container, 2), { key: 'Home' });
    expect(getInputMode()).toBe('speech');
  });

  it('вкладки достижимы с клавиатуры: бегущий tabindex не прячет их', () => {
    const { container } = render(() => <InputSheet />);
    // В фокус попадает только активная вкладка — но стрелки её
    // достают. Без этого две вкладки были бы недостижимы.
    expect(tabAt(container, 0).getAttribute('tabindex')).toBe('0');
    expect(tabAt(container, 1).getAttribute('tabindex')).toBe('-1');
  });
});
