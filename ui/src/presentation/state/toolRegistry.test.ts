import { describe, expect, it } from 'vitest';
import {
  TOOLS,
  TIER1_TOOLS,
  TIER2_TOOLS,
  searchTools,
  getTool,
} from './toolRegistry';
import { getActiveTab, getKindSnap, openKindSheet, closeKindSheet, setTab } from './uiState';
import { closeInputSheet, isInputSheetOpen } from './inputMode';

/**
 * Реестр инструментов — единственный источник правды о навигации.
 *
 * wavecode-zen-minimal-ui (ревизия 2, пункт 12): пока инструмент не
 * описан здесь, его нельзя вывести в интерфейс; пока он описан — он
 * обязан открываться. Эти тесты — «заклёвочный гайд» для реестра.
 */
describe('toolRegistry', () => {
  it('держит три пункта рельса', () => {
    // wavecode-unified-input-entry: «Ввод» ушёл из рельса в tier 2.
    // В рельсе рядом с «ИИ» он читался как второй способ получить
    // музыку; теперь ввод открывает круглая кнопка «Ввод».
    expect(TIER1_TOOLS.map((t) => t.id)).toEqual(['score', 'step', 'ai']);
  });

  it('держит «Ввод» во втором уровне', () => {
    const input = getTool('input');
    expect(input).toBeDefined();
    expect(input?.tier).toBe(2);
  });

  it('не держит отдельного инструмента «Микрофон»', () => {
    // Свист живёт вкладкой листа ввода. Отдельный инструмент «Микрофон»
    // называл бы то же устройство во втором месте интерфейса.
    expect(TOOLS.map((t) => t.id)).not.toContain('mic');
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

  it('открывает «Ввод» листом ввода', () => {
    closeInputSheet();
    getTool('input')?.open();
    expect(isInputSheetOpen()).toBe(true);
    closeInputSheet();
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

  it('помечает «Ввод» как незакрепляемый и объясняет почему', () => {
    // wavecode-pinned-tools: «Ввод» открывает круглая кнопка, которая
    // на экране всегда. Закреплять его в рельсе незачем, а булавка без
    // объяснения просто «не нажимается».
    const input = getTool('input');
    expect(input?.pinnable).toBe(false);
    expect(input?.pinNote).toBeTruthy();
  });

  it('оставляет остальные инструменты второго уровня закрепляемыми', () => {
    for (const tool of TIER2_TOOLS) {
      if (tool.id === 'input') continue;
      expect(tool.pinnable).not.toBe(false);
    }
  });
});
