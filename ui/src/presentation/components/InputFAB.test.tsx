import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { InputFAB } from './InputFAB';
import { closeInputSheet, isInputSheetOpen } from '../state/inputMode';

/**
 * InputFAB — круглая кнопка ввода.
 *
 * wavecode-unified-input-entry: у кнопки ровно ОДНО значение — «открыть
 * лист ввода». Раньше она была ещё и REC-кнопкой, и тап-падом в ритме,
 * и подпись молча менялась с «Голос» на «Ритм»; теперь ни записи, ни
 * режима на кнопке нет, и потому ей не о чем врать.
 */
describe('InputFAB — круглая кнопка ввода', () => {
  beforeEach(() => {
    closeInputSheet();
  });

  afterEach(() => {
    cleanup();
    closeInputSheet();
  });

  it('рисует ровно одну плавающую кнопку', () => {
    const { container } = render(() => <InputFAB />);
    expect(container.querySelectorAll('.voice-mini-fab').length).toBe(1);
  });

  it('названа «Ввод» — и в подписи, и для accessibility', () => {
    const { container } = render(() => <InputFAB />);
    const btn = container.querySelector('.voice-mini-fab')!;
    expect(btn.getAttribute('aria-label')).toBe('Ввод');
    expect(btn.textContent).toContain('Ввод');
  });

  it('нажатие открывает лист ввода', () => {
    const { container } = render(() => <InputFAB />);
    const btn = container.querySelector<HTMLButtonElement>('.voice-mini-fab')!;
    expect(isInputSheetOpen()).toBe(false);
    fireEvent.click(btn);
    expect(isInputSheetOpen()).toBe(true);
  });

  it('не имеет состояния записи — записью занимается вкладка «Речь»', () => {
    const { container } = render(() => <InputFAB />);
    const btn = container.querySelector('.voice-mini-fab')!;
    expect(btn.getAttribute('data-rec-state')).toBeNull();
    expect(btn.getAttribute('data-mode')).toBe('input');
  });

  it('подсказывает текущую модальность ввода', () => {
    const { container } = render(() => <InputFAB />);
    const btn = container.querySelector('.voice-mini-fab')!;
    expect(btn.getAttribute('title')).toContain('Речь');
  });
});
