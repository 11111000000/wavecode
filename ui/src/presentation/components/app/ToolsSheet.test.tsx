import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { ToolsSheet } from './ToolsSheet';
import { getRailTools, resetPinnedTools } from '../../state/pinnedTools';

/**
 * wavecode-pinned-tools — лист «Инструменты» как место закрепления.
 *
 * Три претензии владельца проверяются здесь напрямую:
 *
 *   1. «Какое-то дублирование» — в покое лист показывает только то,
 *      чего в рельсе нет. Базовые пункты рельса в листе не повторяются.
 *   2. «Много чего не хватает» — поиск в листе по-прежнему находит всё,
 *      включая базовые инструменты: закрепление не должно ломать
 *      достижимость.
 *   3. «Нажать галочку, чтобы появился в меню внизу» — булавка на
 *      карточке действительно переносит инструмент в рельс.
 *
 * BottomSheet и PresetPicker здесь заглушены: проверяется содержимое
 * листа, а не механика перетаскивания и список композиций.
 */

vi.mock('../BottomSheet', () => ({
  BottomSheet: (props: { title: string; subtitle?: string; children: unknown }) => (
    <div class="sheet-stub" data-title={props.title} data-subtitle={props.subtitle}>
      {props.children as never}
    </div>
  ),
}));

vi.mock('./PresetPicker', () => ({
  PresetPicker: () => <div class="preset-picker-stub" />,
}));

const cards = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('.wc-tool-card'));

const cardLabels = (container: HTMLElement): string[] =>
  cards(container).map((c) => c.querySelector('.wc-tool-card__label')?.textContent ?? '');

const pinOf = (container: HTMLElement, label: string): HTMLButtonElement => {
  const pin = Array.from(
    container.querySelectorAll<HTMLButtonElement>('.wc-tool-card__pin'),
  ).find((p) => p.getAttribute('aria-label')?.includes(label));
  if (!pin) throw new Error(`булавка «${label}» не найдена`);
  return pin;
};

describe('ToolsSheet', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPinnedTools();
  });

  afterEach(() => {
    cleanup();
  });

  it('в покое показывает только то, чего в рельсе нет', () => {
    const { container } = render(() => <ToolsSheet />);

    // Шесть инструментов второго уровня.
    expect(cardLabels(container)).toEqual([
      'Ввод', 'Пианино', 'Микшер', 'Визуализация', 'Экспорт', 'Консоль',
    ]);

    // Базовых пунктов рельса в листе нет — это и было дублированием.
    for (const base of ['Нотная', 'Шаги', 'ИИ']) {
      expect(cardLabels(container)).not.toContain(base);
    }
  });

  it('подпись листа обещает закрепление, а не «всё, что не в рельсе»', () => {
    const { container } = render(() => <ToolsSheet />);
    const stub = container.querySelector('.sheet-stub');
    expect(stub?.getAttribute('data-subtitle')).toBe('что закрепить в рельсе');
  });

  it('поиск находит и базовый инструмент, но с заблокированной булавкой', () => {
    const { container } = render(() => <ToolsSheet />);
    const input = container.querySelector<HTMLInputElement>('.wc-tools-sheet__search input');
    if (!input) throw new Error('поле поиска не найдено');

    fireEvent.input(input, { target: { value: 'нотная' } });

    expect(cardLabels(container)).toEqual(['Нотная']);
    const pin = pinOf(container, 'Нотная');
    expect(pin.getAttribute('aria-disabled')).toBe('true');
    expect(pin.getAttribute('aria-label')).toContain('уже в рельсе');
  });

  it('булавка на карточке переносит инструмент в рельс', () => {
    const { container } = render(() => <ToolsSheet />);

    expect(getRailTools().map((t) => t.id)).toEqual(['score', 'step', 'ai']);

    fireEvent.click(pinOf(container, 'Микшер'));

    expect(getRailTools().map((t) => t.id)).toEqual(['score', 'step', 'ai', 'mixer']);
    expect(pinOf(container, 'Микшер').getAttribute('aria-pressed')).toBe('true');
  });

  it('повторное нажатие снимает инструмент из рельса', () => {
    const { container } = render(() => <ToolsSheet />);

    fireEvent.click(pinOf(container, 'Микшер'));
    fireEvent.click(pinOf(container, 'Микшер'));

    expect(getRailTools().map((t) => t.id)).toEqual(['score', 'step', 'ai']);
    expect(pinOf(container, 'Микшер').getAttribute('aria-pressed')).toBe('false');
  });

  it('«Ввод» не закрепляется, и булавка объясняет почему', () => {
    const { container } = render(() => <ToolsSheet />);

    const pin = pinOf(container, 'Ввод');
    expect(pin.getAttribute('aria-disabled')).toBe('true');
    expect(pin.getAttribute('aria-label')).toContain('кнопкой «Ввод»');

    fireEvent.click(pin);
    expect(getRailTools().map((t) => t.id)).toEqual(['score', 'step', 'ai']);
  });

  it('заблокированная булавка не прячет причину', () => {
    const { container } = render(() => <ToolsSheet />);
    const pin = pinOf(container, 'Ввод');

    // Не `disabled`: причина должна быть доступна и с клавиатуры.
    expect(pin.hasAttribute('disabled')).toBe(false);
    expect(pin.getAttribute('title')).toContain('кнопкой «Ввод»');
  });

  it('четвёртая булавка блокируется лимитом, а не молчит', () => {
    const { container } = render(() => <ToolsSheet />);

    fireEvent.click(pinOf(container, 'Пианино'));
    fireEvent.click(pinOf(container, 'Микшер'));
    fireEvent.click(pinOf(container, 'Экспорт'));

    const fourth = pinOf(container, 'Визуализация');
    expect(fourth.getAttribute('aria-disabled')).toBe('true');
    expect(fourth.getAttribute('aria-label')).toContain('не больше 3');

    fireEvent.click(fourth);
    expect(getRailTools().map((t) => t.id)).toEqual([
      'score', 'step', 'ai', 'piano', 'mixer', 'export',
    ]);
  });
});
