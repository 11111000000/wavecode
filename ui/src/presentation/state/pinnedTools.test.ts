import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * wavecode-pinned-tools — закрепление инструментов в рельсе.
 *
 * Владелец попросил: «нажать галочку на каждом инструменте, чтобы он
 * появился в меню внизу, если человек часто пользуется». Эти тесты —
 * контракт того, что рельс остаётся предсказуемым:
 *
 *   - базовые три пункта есть всегда и всегда первыми;
 *   - закрепить можно только то, чего в рельсе ещё нет;
 *   - больше трёх закреплений рельс не влезает (мобильный ряд — 60 px);
 *   - «Ввод» не закрепляется: у него своя круглая кнопка;
 *   - выбор переживает перезагрузку страницы.
 */

const STORAGE_KEY = 'wavecode-pinned-tools-v1';

describe('pinnedTools', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('по умолчанию рельс состоит только из трёх базовых пунктов', async () => {
    const { getRailTools } = await import('./pinnedTools');
    expect(getRailTools().map((t) => t.id)).toEqual(['score', 'step', 'ai']);
  });

  it('закрепляет инструмент и возвращает его в рельс', async () => {
    const { getRailTools, isPinned, togglePinned } = await import('./pinnedTools');
    togglePinned('mixer');

    expect(isPinned('mixer')).toBe(true);
    // Базовые остаются первыми: закрепление дополняет рельс, а не
    // переставляет его.
    expect(getRailTools().map((t) => t.id)).toEqual(['score', 'step', 'ai', 'mixer']);
  });

  it('снимает закрепление тем же переключателем', async () => {
    const { getRailTools, isPinned, togglePinned } = await import('./pinnedTools');
    togglePinned('piano');
    expect(isPinned('piano')).toBe(true);

    togglePinned('piano');
    expect(isPinned('piano')).toBe(false);
    expect(getRailTools().map((t) => t.id)).toEqual(['score', 'step', 'ai']);
  });

  it('не закрепляет то, что уже в рельсе', async () => {
    const { getRailTools, isPinned, togglePinned } = await import('./pinnedTools');
    togglePinned('score');

    expect(isPinned('score')).toBe(false);
    expect(getRailTools().map((t) => t.id)).toEqual(['score', 'step', 'ai']);
  });

  it('не закрепляет «Ввод» — у него своя круглая кнопка', async () => {
    const { getRailTools, isPinned, togglePinned } = await import('./pinnedTools');
    togglePinned('input');

    expect(isPinned('input')).toBe(false);
    expect(getRailTools().map((t) => t.id)).toEqual(['score', 'step', 'ai']);
  });

  it('держит лимит: больше трёх закреплений рельс не влезает', async () => {
    const { MAX_PINNED_TOOLS, canPinMore, getRailTools, togglePinned } =
      await import('./pinnedTools');

    expect(MAX_PINNED_TOOLS).toBe(3);
    expect(canPinMore()).toBe(true);

    togglePinned('piano');
    togglePinned('mixer');
    togglePinned('export');
    expect(canPinMore()).toBe(false);

    // Четвёртый — лишний, рельс его не берёт.
    togglePinned('visualize');
    expect(getRailTools().map((t) => t.id)).toEqual([
      'score', 'step', 'ai', 'piano', 'mixer', 'export',
    ]);

    // Снять можно всегда — тогда место освобождается.
    togglePinned('piano');
    expect(canPinMore()).toBe(true);
    togglePinned('visualize');
    expect(getRailTools().map((t) => t.id)).toEqual([
      'score', 'step', 'ai', 'mixer', 'export', 'visualize',
    ]);
  });

  it('сохраняет выбор в localStorage и восстанавливает после перезагрузки', async () => {
    const { togglePinned } = await import('./pinnedTools');
    togglePinned('mixer');
    togglePinned('export');

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(['mixer', 'export']);

    // Новый «сеанс» — модуль читает хранилище заново.
    vi.resetModules();
    const { getRailTools } = await import('./pinnedTools');
    expect(getRailTools().map((t) => t.id)).toEqual([
      'score', 'step', 'ai', 'mixer', 'export',
    ]);
  });

  it('возвращает рельс к базовым по resetPinnedTools', async () => {
    const { getRailTools, resetPinnedTools, togglePinned } = await import('./pinnedTools');
    togglePinned('console');
    resetPinnedTools();

    expect(getRailTools().map((t) => t.id)).toEqual(['score', 'step', 'ai']);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
  });

  it('игнорирует битые данные в хранилище', async () => {
    localStorage.setItem(STORAGE_KEY, '{не json');
    const { getRailTools } = await import('./pinnedTools');
    expect(getRailTools().map((t) => t.id)).toEqual(['score', 'step', 'ai']);
  });

  it('выбрасывает неизвестные и повторяющиеся id', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(['mixer', 'нет-такого', 'mixer', 'score', 'input']),
    );
    const { getPinnedIds } = await import('./pinnedTools');
    expect(getPinnedIds()).toEqual(['mixer']);
  });
});
