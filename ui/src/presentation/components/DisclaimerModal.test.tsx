import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@solidjs/testing-library';
import { DisclaimerModal } from './DisclaimerModal';

const setHashRoute = (route: string): void => {
  if (typeof window === 'undefined') return;
  if (window.location.hash !== route) {
    window.history.pushState(null, '', route);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
};

const isDisabled = (el: Element | null): boolean =>
  (el as HTMLButtonElement | null)?.disabled ?? false;

describe('DisclaimerModal (legal disclaimer + privacy policy gate)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    setHashRoute('#/');
  });

  it('renders nothing outside #/app', async () => {
    setHashRoute('#/');
    const { queryByTestId } = render(() => <DisclaimerModal />);
    await waitFor(() => {
      expect(queryByTestId('disclaimer-overlay')).toBeNull();
    });
  });

  it('renders the overlay on #/app', async () => {
    setHashRoute('#/app');
    const { queryByTestId, getByText } = render(() => <DisclaimerModal />);
    await waitFor(() => {
      expect(queryByTestId('disclaimer-overlay')).toBeTruthy();
    });
    expect(getByText('Условия использования wavecode')).toBeTruthy();
    expect(getByText('Политика конфиденциальности')).toBeTruthy();
  });

  it('keeps «Продолжить» disabled until consent is checked', async () => {
    setHashRoute('#/app');
    const { getByTestId } = render(() => <DisclaimerModal />);
    await waitFor(() => {
      expect(getByTestId('disclaimer-overlay')).toBeTruthy();
    });
    expect(isDisabled(getByTestId('disclaimer-accept'))).toBe(true);

    fireEvent.click(getByTestId('disclaimer-consent'));
    expect(isDisabled(getByTestId('disclaimer-accept'))).toBe(false);
  });

  it('hides the overlay after consent + accept, without persisting consent', async () => {
    setHashRoute('#/app');
    const { getByTestId, queryByTestId } = render(() => <DisclaimerModal />);
    await waitFor(() => {
      expect(queryByTestId('disclaimer-overlay')).toBeTruthy();
    });

    fireEvent.click(getByTestId('disclaimer-consent'));
    fireEvent.click(getByTestId('disclaimer-accept'));

    await waitFor(() => {
      expect(queryByTestId('disclaimer-overlay')).toBeNull();
    });

    // Consent is per-session only — nothing is written to localStorage,
    // so the dialog re-appears on the next entry (fresh mount).
    expect(localStorage.length).toBe(0);
  });
});
