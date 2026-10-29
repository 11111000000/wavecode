import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@solidjs/testing-library';
import { DisclaimerGate } from './DisclaimerGate';
import {
  DISCLAIMER_VERSION,
  TERMS_OPEN_EVENT,
  TERMS_STORAGE_KEY,
  type ConsentGate,
  openTerms,
  useConsentGate,
} from '~/presentation/state/consentGate';

const setHashRoute = (route: string): void => {
  if (typeof window === 'undefined') return;
  if (window.location.hash !== route) {
    window.history.pushState(null, '', route);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
};

const isDisabled = (el: Element | null): boolean =>
  (el as HTMLButtonElement | null)?.disabled ?? false;

/**
 * The real wiring from App.tsx: the hook runs inside the render root and
 * the gate object is handed over by reference. Calling `useConsentGate()`
 * inline in the JSX prop would re-run it on every `props.gate` access,
 * because Solid compiles props to getters — each access would then get a
 * brand-new signal set that nothing else is listening to.
 */
const renderGate = () => {
  let gate!: ConsentGate;
  return render(() => {
    gate = useConsentGate();
    return <DisclaimerGate gate={gate} />;
  });
};

const accept = async (getByTestId: (id: string) => Element): Promise<void> => {
  fireEvent.click(getByTestId('disclaimer-consent'));
  // The button's `disabled` property is a reactive write — let it land
  // before clicking, otherwise the click lands on a still-disabled node.
  await waitFor(() => {
    expect(isDisabled(getByTestId('disclaimer-accept'))).toBe(false);
  });
  fireEvent.click(getByTestId('disclaimer-accept'));
};

describe('DisclaimerGate (blocking legal gate)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    setHashRoute('#/');
  });

  it('blocks the landing route until the terms are accepted', async () => {
    setHashRoute('#/');
    const { getByTestId } = renderGate();
    await waitFor(() => {
      expect(getByTestId('disclaimer-gate')).toBeTruthy();
    });
    expect(getByTestId('disclaimer-panel').getAttribute('aria-modal')).toBe('true');
    expect(getByTestId('disclaimer-panel').getAttribute('role')).toBe('dialog');
  });

  it('shows inside the editor too — the gate is not route-gated', async () => {
    setHashRoute('#/app');
    const { getByTestId } = renderGate();
    await waitFor(() => {
      expect(getByTestId('disclaimer-gate')).toBeTruthy();
    });
  });

  it('is expanded from the first frame — nothing to unfold', async () => {
    setHashRoute('#/');
    const { queryByTestId, getByTestId, getByText } = renderGate();
    await waitFor(() => {
      expect(getByTestId('disclaimer-body')).toBeTruthy();
    });
    // The «Подробнее» affordance of the old banner is gone.
    expect(queryByTestId('disclaimer-expand')).toBeNull();
    expect(getByTestId('disclaimer-body')).toBeTruthy();

    expect(getByText('1. Право пользования ПО и интерфейсом')).toBeTruthy();
    expect(getByText('2. Интеллектуальная собственность и лицензия')).toBeTruthy();
  });

  it('keeps «Принять» disabled until consent is checked', async () => {
    setHashRoute('#/');
    const { getByTestId } = renderGate();
    await waitFor(() => {
      expect(getByTestId('disclaimer-gate')).toBeTruthy();
    });

    expect(isDisabled(getByTestId('disclaimer-accept'))).toBe(true);
    fireEvent.click(getByTestId('disclaimer-consent'));
    expect(isDisabled(getByTestId('disclaimer-accept'))).toBe(false);
  });

  it('has no dismiss path while pending — no close, no Esc, no backdrop click', async () => {
    setHashRoute('#/');
    const { queryByTestId, getByTestId } = renderGate();
    await waitFor(() => {
      expect(getByTestId('disclaimer-gate')).toBeTruthy();
    });

    expect(queryByTestId('disclaimer-close')).toBeNull();
    expect(getByTestId('disclaimer-hint')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(getByTestId('disclaimer-gate'));
    fireEvent.click(getByTestId('disclaimer-panel'));

    await waitFor(() => {
      expect(getByTestId('disclaimer-gate')).toBeTruthy();
    });
  });

  it('persists the accepted version and hides on remount', async () => {
    setHashRoute('#/');
    const first = renderGate();
    await waitFor(() => {
      expect(first.getByTestId('disclaimer-gate')).toBeTruthy();
    });
    await accept(first.getByTestId);

    await waitFor(() => {
      expect(first.queryByTestId('disclaimer-gate')).toBeNull();
    });
    expect(localStorage.getItem(TERMS_STORAGE_KEY)).toBe(DISCLAIMER_VERSION);

    cleanup();
    const second = renderGate();
    await waitFor(() => {
      expect(second.queryByTestId('disclaimer-gate')).toBeNull();
    });
  });

  it('re-prompts when a stale version is stored', async () => {
    localStorage.setItem(TERMS_STORAGE_KEY, 'v0');
    setHashRoute('#/');
    const { getByTestId } = renderGate();
    await waitFor(() => {
      expect(getByTestId('disclaimer-gate')).toBeTruthy();
    });
    expect(getByTestId('disclaimer-gate').getAttribute('data-version')).toBe(
      DISCLAIMER_VERSION,
    );
  });

  it('stays up when the acceptance cannot be written (fail-visible)', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    setHashRoute('#/');
    const { getByTestId } = renderGate();
    await waitFor(() => {
      expect(getByTestId('disclaimer-gate')).toBeTruthy();
    });

    await accept(getByTestId);

    await waitFor(() => {
      expect(getByTestId('disclaimer-gate')).toBeTruthy();
    });
    expect(localStorage.getItem(TERMS_STORAGE_KEY)).toBeNull();
  });

  it('re-opens read-only from the footer event after acceptance', async () => {
    localStorage.setItem(TERMS_STORAGE_KEY, DISCLAIMER_VERSION);
    setHashRoute('#/');
    const { queryByTestId, getByTestId } = renderGate();
    await waitFor(() => {
      expect(queryByTestId('disclaimer-gate')).toBeNull();
    });

    openTerms();

    await waitFor(() => {
      expect(getByTestId('disclaimer-gate')).toBeTruthy();
    });
    expect(getByTestId('disclaimer-gate').getAttribute('data-mode')).toBe('read-only');
    // Read-only: no consent controls, expanded text, a close button.
    expect(getByTestId('disclaimer-body')).toBeTruthy();
    expect(queryByTestId('disclaimer-accept')).toBeNull();
    expect(queryByTestId('disclaimer-consent')).toBeNull();
    expect(getByTestId('disclaimer-close')).toBeTruthy();

    fireEvent.click(getByTestId('disclaimer-close'));
    await waitFor(() => {
      expect(queryByTestId('disclaimer-gate')).toBeNull();
    });
  });

  it('closes the read-only re-open on Esc but keeps a pending gate up', async () => {
    setHashRoute('#/');
    const { queryByTestId, getByTestId } = renderGate();
    await waitFor(() => {
      expect(getByTestId('disclaimer-gate')).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(getByTestId('disclaimer-gate')).toBeTruthy();

    await accept(getByTestId);
    await waitFor(() => {
      expect(queryByTestId('disclaimer-gate')).toBeNull();
    });

    openTerms();
    await waitFor(() => {
      expect(getByTestId('disclaimer-gate')).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(queryByTestId('disclaimer-gate')).toBeNull();
    });
  });

  it('exposes a stable event name for the footer trigger', () => {
    expect(TERMS_OPEN_EVENT).toBe('wavecode:open-terms');
  });
});