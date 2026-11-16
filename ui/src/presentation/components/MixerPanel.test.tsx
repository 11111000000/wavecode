import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { MixerPanel } from './MixerPanel';
import { appStore, dispatch } from '../state/appStore';

/**
 * MixerPanel — выбор инструмента слоя.
 *
 * Почему этот тест нужен: до wavecode-sound-choice-and-rhythm-feedback
 * микшер показывал строки слоёв, но НЕ показывал, каким инструментом
 * слой играет, и не давал его изменить. Человек видел ноты в партитуре
 * и слышал всегда фортепиано — инструмент нельзя было выбрать нигде.
 *
 * Аудио в тесте не трогаем: `audioActions` замокан, проверяем
 * партитуру (единственный источник правды) и DOM.
 */

const evalScoreSpy = vi.fn();
const scheduleMixLiveSpy = vi.fn();

vi.mock('../state/audioActions', () => ({
  evalScore: (...args: unknown[]) => evalScoreSpy(...args),
  scheduleMixLive: (...args: unknown[]) => scheduleMixLiveSpy(...args),
  stopAudio: vi.fn(),
  beep: vi.fn(),
  previewPreset: vi.fn(),
  stopPreview: vi.fn(),
}));

/**
 * Партитура из двух секций: мелодический слой (треугольник) и
 * ударный (`s("drums_bd …")`). Ударный слой — не мелодический: там
 * `.s(…)` выбирает СЭМПЛ, а не инструмент.
 */
const SCORE = [
  'cat(',
  '  stack(note("c4 e4").s("triangle").gain(0.2)),',
  '  stack(s("drums_bd ~").gain(0.5))',
  ')',
].join('\n');

beforeEach(() => {
  dispatch({ type: 'replaceScore', text: SCORE });
  evalScoreSpy.mockClear();
  scheduleMixLiveSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('MixerPanel — инструмент слоя', () => {
  it('у мелодического слоя есть селектор с текущим инструментом', () => {
    const { container } = render(() => <MixerPanel />);

    const select = container.querySelector<HTMLSelectElement>(
      '.mixer-row[data-index="0"] .inst-select',
    );
    expect(select).not.toBeNull();
    expect(select?.value).toBe('triangle');
  });

  it('у ударного слоя — статичная подпись «Сэмпл», а не селектор', () => {
    const { container } = render(() => <MixerPanel />);

    // Вторая секция свёрнута — её слой не отрендерен, пока
    // человек не раскроет секцию.
    const toggle = container.querySelector<HTMLButtonElement>(
      '.mixer-section[data-section="1"] .mixer-section-toggle',
    );
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle!);

    const row = container.querySelector('.mixer-row[data-index="1"]');
    expect(row?.querySelector('.mixer-sound-static')?.textContent?.trim()).toBe('Сэмпл');
    expect(row?.querySelector('.inst-select')).toBeNull();
  });

  it('выбор инструмента переписывает .s(…) ТОЛЬКО этого слоя', () => {
    const { container } = render(() => <MixerPanel />);

    const select = container.querySelector<HTMLSelectElement>(
      '.mixer-row[data-index="0"] .inst-select',
    );
    expect(select).not.toBeNull();

    fireEvent.change(select!, { target: { value: 'sawtooth' } });

    // Партитура — единственный источник правды.
    expect(appStore.score).toContain('.s("sawtooth")');
    expect(appStore.score).not.toContain('.s("triangle")');
    // Второй слой (ударный) не тронут.
    expect(appStore.score).toContain('s("drums_bd ~")');
    // Звук переоценивается — иначе правка была бы только текстовой.
    expect(evalScoreSpy).toHaveBeenCalled();
  });

  it('первая секция раскрыта сразу — слой виден без дополнительных кликов', () => {
    const { container } = render(() => <MixerPanel />);

    // Раньше все секции были свёрнуты: человек открывал микшер и
    // видел только заголовки секций, а выбрать инструмент не мог.
    const rows = container.querySelectorAll('.mixer-row');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('число слоёв совпадает с перечислением партитуры', () => {
    const { container } = render(() => <MixerPanel />);

    const list = container.querySelector('.mixer-list');
    expect(list?.getAttribute('data-count')).toBe('2');
    expect(list?.getAttribute('data-sections')).toBe('2');
  });
});
