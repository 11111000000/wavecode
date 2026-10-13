import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { SheetTabs } from './SheetTabs';

/**
 * SheetTabs renders 5 tabs (Mixer / AI / Status / Step / Piano) that
 * delegate to uiState.setTab. Visibility is the parent's
 * responsibility (the BottomSheet shows/hides via data-snap); here
 * we just verify the click delegation.
 */
const importUiState = async () => await import('../state/uiState');

beforeEach(async () => {
  localStorage.clear();
  const s = await importUiState();
  // Reset to score tab baseline so each test starts clean.
  s.setTab('score');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SheetTabs — render', () => {
  it('renders 5 tabs (Mixer, AI, Status, Step, Piano)', async () => {
    const { container } = render(() => <SheetTabs />);
    const tabs = container.querySelectorAll<HTMLButtonElement>('.wc-sheet__tab');
    expect(tabs).toHaveLength(5);
    const labels = Array.from(tabs).map((t) => t.textContent?.trim());
    expect(labels.some((l) => l?.includes('Mixer'))).toBe(true);
    expect(labels.some((l) => l?.includes('AI'))).toBe(true);
    expect(labels.some((l) => l?.includes('Status'))).toBe(true);
    expect(labels.some((l) => l?.includes('Step'))).toBe(true);
    expect(labels.some((l) => l?.includes('Piano'))).toBe(true);
  });

  it('does NOT include a Score tab (Score is primary nav, closes sheet)', () => {
    const { container } = render(() => <SheetTabs />);
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('.wc-sheet__tab'));
    expect(tabs.some((t) => t.textContent?.trim().includes('Score'))).toBe(false);
  });

  it('renders role="tablist" on the container for a11y', () => {
    const { container } = render(() => <SheetTabs />);
    expect(container.querySelector('[role="tablist"]')).toBeTruthy();
  });
});

describe('SheetTabs — click delegation', () => {
  it('clicking the Mixer tab calls setTab("mixer")', async () => {
    const s = await importUiState();
    const setTabSpy = vi.spyOn(s, 'setTab');
    const { container } = render(() => <SheetTabs />);
    const mixerBtn = container.querySelector<HTMLButtonElement>(
      '.wc-sheet__tab[data-tab="mixer"]',
    )!;
    fireEvent.click(mixerBtn);
    expect(setTabSpy).toHaveBeenCalledWith('mixer');
  });

  it('clicking the AI tab calls setTab("chat")', async () => {
    const s = await importUiState();
    const setTabSpy = vi.spyOn(s, 'setTab');
    const { container } = render(() => <SheetTabs />);
    const aiBtn = container.querySelector<HTMLButtonElement>(
      '.wc-sheet__tab[data-tab="chat"]',
    )!;
    fireEvent.click(aiBtn);
    expect(setTabSpy).toHaveBeenCalledWith('chat');
  });

  it('clicking all 5 tabs in sequence opens each one', async () => {
    const s = await importUiState();
    const setTabSpy = vi.spyOn(s, 'setTab');
    const { container } = render(() => <SheetTabs />);
    const tabs = container.querySelectorAll<HTMLButtonElement>('.wc-sheet__tab');
    expect(tabs).toHaveLength(5);
    for (const t of tabs) {
      fireEvent.click(t);
    }
    expect(setTabSpy).toHaveBeenCalledTimes(5);
    expect(setTabSpy).toHaveBeenNthCalledWith(1, 'mixer');
    expect(setTabSpy).toHaveBeenNthCalledWith(2, 'chat');
    expect(setTabSpy).toHaveBeenNthCalledWith(3, 'status');
    expect(setTabSpy).toHaveBeenNthCalledWith(4, 'step');
    expect(setTabSpy).toHaveBeenNthCalledWith(5, 'piano');
  });
});

describe('SheetTabs — active state', () => {
  it('marks the currently active tab with data-active="true"', async () => {
    const s = await importUiState();
    s.setTab('mixer');
    const { container } = render(() => <SheetTabs />);
    const mixerBtn = container.querySelector<HTMLButtonElement>(
      '.wc-sheet__tab[data-tab="mixer"]',
    )!;
    expect(mixerBtn.getAttribute('data-active')).toBe('true');
    const aiBtn = container.querySelector<HTMLButtonElement>(
      '.wc-sheet__tab[data-tab="chat"]',
    )!;
    expect(aiBtn.getAttribute('data-active')).toBe('false');
  });

  it('reflects setTab changes — clicking AI makes AI active and Mixer inactive', async () => {
    const s = await importUiState();
    s.setTab('mixer');
    const { container } = render(() => <SheetTabs />);
    const mixerBtn = container.querySelector<HTMLButtonElement>(
      '.wc-sheet__tab[data-tab="mixer"]',
    )!;
    expect(mixerBtn.getAttribute('data-active')).toBe('true');
    fireEvent.click(
      container.querySelector<HTMLButtonElement>('.wc-sheet__tab[data-tab="chat"]')!,
    );
    // Solid reactivity — re-query DOM after click.
    const mixerAfter = container.querySelector<HTMLButtonElement>(
      '.wc-sheet__tab[data-tab="mixer"]',
    )!;
    const aiAfter = container.querySelector<HTMLButtonElement>(
      '.wc-sheet__tab[data-tab="chat"]',
    )!;
    expect(aiAfter.getAttribute('data-active')).toBe('true');
    expect(mixerAfter.getAttribute('data-active')).toBe('false');
  });
});