import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@solidjs/testing-library';
import {
  DisclaimerBanner,
  DISCLAIMER_VERSION,
  TERMS_OPEN_EVENT,
  openTermsBanner,
} from './DisclaimerBanner';

const STORAGE_KEY = 'wavecodeTermsAccepted';

const setHashRoute = (route: string): void => {
  if (typeof window === 'undefined') return;
  if (window.location.hash !== route) {
    window.history.pushState(null, '', route);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
};

const isDisabled = (el: Element | null): boolean =>
  (el as HTMLButtonElement | null)?.disabled ?? false;

const accept = (getByTestId: (id: string) => Element): void => {
  fireEvent.click(getByTestId('disclaimer-expand'));
  fireEvent.click(getByTestId('disclaimer-consent'));
  fireEvent.click(getByTestId('disclaimer-accept'));
};

describe('DisclaimerBanner (floating legal banner)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    setHashRoute('#/');
  });

  it('shows on the landing route, not only inside the editor', async () => {
    setHashRoute('#/');
    const { queryByTestId } = render(() => <DisclaimerBanner />);
    await waitFor(() => {
      expect(queryByTestId('disclaimer-banner')).toBeTruthy();
    });
  });

  it('shows inside the editor too', async () => {
    setHashRoute('#/app');
    const { queryByTestId } = render(() => <DisclaimerBanner />);
    await waitFor(() => {
      expect(queryByTestId('disclaimer-banner')).toBeTruthy();
    });
  });

  it('is not a modal — no aria-modal, no blocking overlay', async () => {
    setHashRoute('#/app');
    const { getByTestId } = render(() => <DisclaimerBanner />);
    await waitFor(() => {
      expect(getByTestId('disclaimer-banner')).toBeTruthy();
    });
    const el = getByTestId('disclaimer-banner');
    expect(el.getAttribute('aria-modal')).toBeNull();
    expect(el.getAttribute('role')).toBe('region');
  });

  it('keeps the full text collapsed until «Подробнее» is pressed', async () => {
    setHashRoute('#/');
    const { queryByTestId, getByTestId, getByText } = render(() => <DisclaimerBanner />);
    await waitFor(() => {
      expect(getByTestId('disclaimer-summary')).toBeTruthy();
    });
    expect(queryByTestId('disclaimer-body')).toBeNull();

    fireEvent.click(getByTestId('disclaimer-expand'));
    await waitFor(() => {
      expect(queryByTestId('disclaimer-body')).toBeTruthy();
    });

    // The two clauses the banner exists to carry.
    expect(getByText('1. Право пользования ПО и интерфейсом')).toBeTruthy();
    expect(getByText('2. Интеллектуальная собственность и лицензия')).toBeTruthy();
  });

  it('keeps «Принять» disabled until consent is checked', async () => {
    setHashRoute('#/');
    const { getByTestId } = render(() => <DisclaimerBanner />);
    await waitFor(() => {
      expect(getByTestId('disclaimer-banner')).toBeTruthy();
    });

    fireEvent.click(getByTestId('disclaimer-expand'));
    expect(isDisabled(getByTestId('disclaimer-accept'))).toBe(true);

    fireEvent.click(getByTestId('disclaimer-consent'));
    expect(isDisabled(getByTestId('disclaimer-accept'))).toBe(false);
  });

  it('persists the accepted version and hides on remount', async () => {
    setHashRoute('#/');
    const first = render(() => <DisclaimerBanner />);
    await waitFor(() => {
      expect(first.getByTestId('disclaimer-banner')).toBeTruthy();
    });
    accept(first.getByTestId);

    await waitFor(() => {
      expect(first.queryByTestId('disclaimer-banner')).toBeNull();
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(DISCLAIMER_VERSION);

    cleanup();
    const second = render(() => <DisclaimerBanner />);
    await waitFor(() => {
      expect(second.queryByTestId('disclaimer-banner')).toBeNull();
    });
  });

  it('re-prompts when a stale version is stored', async () => {
    localStorage.setItem(STORAGE_KEY, 'v0');
    setHashRoute('#/');
    const { queryByTestId, getByTestId } = render(() => <DisclaimerBanner />);
    await waitFor(() => {
      expect(queryByTestId('disclaimer-banner')).toBeTruthy();
    });
    expect(getByTestId('disclaimer-banner').getAttribute('data-version')).toBe(
      DISCLAIMER_VERSION,
    );
  });

  it('re-opens read-only from the footer event after acceptance', async () => {
    localStorage.setItem(STORAGE_KEY, DISCLAIMER_VERSION);
    setHashRoute('#/');
    const { queryByTestId, getByTestId } = render(() => <DisclaimerBanner />);
    await waitFor(() => {
      expect(queryByTestId('disclaimer-banner')).toBeNull();
    });

    openTermsBanner();

    await waitFor(() => {
      expect(queryByTestId('disclaimer-banner')).toBeTruthy();
    });
    // Read-only: already accepted, so the accept button is gone and a
    // close button takes its place.
    expect(queryByTestId('disclaimer-accept')).toBeNull();
    expect(queryByTestId('disclaimer-consent')).toBeNull();
    expect(queryByTestId('disclaimer-close')).toBeTruthy();

    fireEvent.click(getByTestId('disclaimer-close'));
    await waitFor(() => {
      expect(queryByTestId('disclaimer-banner')).toBeNull();
    });
  });

  it('exposes a stable event name for the footer trigger', () => {
    expect(TERMS_OPEN_EVENT).toBe('wavecode:open-terms');
  });
});
