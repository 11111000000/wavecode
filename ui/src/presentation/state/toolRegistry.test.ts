import { describe, expect, it } from 'vitest';
import {
  TOOLS,
  TIER1_TOOLS,
  searchTools,
  getTool,
} from './toolRegistry';
import { getActiveTab, getKindSnap, openKindSheet, closeKindSheet, setTab } from './uiState';
import { closeInputDock, isInputDockOpen } from './inputMode';

/**
 * Реестр инструментов — единственный источник правды о навигации.
 *
 * wavecode-zen-minimal-ui (ревизия 2, пункт 12): пока инструмент не
 * описан здесь, его нельзя вывести в интерфейс; пока он описан — он
 * обязан открываться. Эти тесты — «заклёвочный гайд» для реестра.
 */
describe('toolRegistry', () => {
  it('держит четыре пункта рельса', () => {
    expect(TIER1_TOOLS.map((t) => t.id)).toEqual(['score', 'step', 'ai', 'input']);
  });

  it('не содержит повторяющихся id', () => {
    const ids = TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('у каждого инструмента есть подпись, описание и иконка', () => {
    for (const tool of TOOLS) {
      expect(tool.label.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.icon).toBe('function');
    }
  });

  it('открывает инструмент второго уровня в свой слой', () => {
    closeKindSheet('mixer');
    const mixer = getTool('mixer');
    expect(mixer).toBeDefined();
    mixer?.open();
    expect(getKindSnap('mixer')).not.toBe('closed');
    closeKindSheet('mixer');
  });

  it('открывает «Нотная» как единственный экран без слоя', () => {
    openKindSheet('mixer', 'half');
    getTool('score')?.open();
    expect(getActiveTab()).toBe('score');
    expect(getKindSnap('mixer')).toBe('closed');
  });

  it('открывает «Ввод» через входной док', () => {
    closeInputDock();
    getTool('input')?.open();
    expect(isInputDockOpen()).toBe(true);
    closeInputDock();
  });

  it('находит инструмент по названию и по ключевому слову', () => {
    expect(searchTools('микшер').map((t) => t.id)).toContain('mixer');
    expect(searchTools('midi').map((t) => t.id)).toContain('piano');
    expect(searchTools('wav').map((t) => t.id)).toContain('export');
    expect(searchTools('').length).toBe(TOOLS.length);
  });

  it('не находит лишнего по случайному запросу', () => {
    expect(searchTools('квантовая физика').length).toBe(0);
  });

  it('открывает «Шаги» как слой селектора', () => {
    setTab('step');
    expect(getKindSnap('step')).not.toBe('closed');
    setTab('score');
  });
});
