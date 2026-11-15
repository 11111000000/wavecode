import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { StatusStrip } from './StatusStrip';
import { appStore, dispatch } from '~/presentation/state/appStore';

/**
 * StatusStrip — единственное место, где живёт состояние приложения.
 *
 * wavecode-zen-ui-phases-6-7 (фаза 6, «Тишина»): строка показывает
 * честный `audio.status`, а не состояние AudioContext. Контекст
 * остаётся `running` и после «Стоп», поэтому по нему нельзя понять,
 * звучит ли музыка. Этот тест фиксирует именно эту семантику.
 */

const statusText = (container: HTMLElement): string =>
  container.querySelector('[data-testid="status-audio"]')?.textContent?.trim() ?? '';

describe('StatusStrip', () => {
  beforeEach(() => {
    dispatch({ type: 'audioStatusChange', status: 'stopped' });
  });
  afterEach(() => cleanup());

  it('показывает «остановлен», когда музыка не играет', () => {
    const { container } = render(() => <StatusStrip ctxState={() => 'running'} />);
    expect(statusText(container)).toContain('остановлен');
    expect(statusText(container)).not.toContain('играет');
  });

  it('показывает «играет», когда статус аудио — playing', () => {
    dispatch({ type: 'audioStatusChange', status: 'playing' });
    const { container } = render(() => <StatusStrip ctxState={() => 'running'} />);
    expect(statusText(container)).toContain('играет');
  });

  it('показывает «ошибка», когда статус аудио — error', () => {
    dispatch({ type: 'audioStatusChange', status: 'error' });
    const { container } = render(() => <StatusStrip ctxState={() => 'running'} />);
    expect(statusText(container)).toContain('ошибка');
  });

  it('не путает состояние контекста со звуком: контекст running + статус stopped = «остановлен»', () => {
    const { container } = render(() => <StatusStrip ctxState={() => 'running'} />);
    // Звука нет, хотя контекст «работает» — так и должно быть.
    expect(appStore.audio.status).toBe('stopped');
    expect(statusText(container)).toContain('остановлен');
    expect(statusText(container)).not.toContain('работает');
  });

  it('состояние контекста уходит в подсказку, а не в текст', () => {
    const { container } = render(() => <StatusStrip ctxState={() => 'suspended'} />);
    const title = container
      .querySelector('[data-testid="status-audio"]')
      ?.getAttribute('title');
    expect(title).toContain('остановлен');
    expect(title).toContain('приостановлен');
  });
});
