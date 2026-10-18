import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@solidjs/testing-library';
import { WelcomeTour } from './WelcomeTour';
import {
  WAVECODE_ONBOARDING_KEY, markTourComplete, resetTour,
} from './tourState';

const TOUR_STEPS_COUNT = 5;

const setHashRoute = (route: string): void => {
  if (typeof window === 'undefined') return;
  if (window.location.hash !== route) {
    window.history.pushState(null, '', route);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
};

describe('WelcomeTour (decisions/wavecode-welcome-tour.yaml)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    setHashRoute('#/');
  });

  it('renders nothing when the user has already completed the tour', async () => {
    markTourComplete();
    setHashRoute('#/app');
    const { queryByTestId } = render(() => <WelcomeTour />);
    await waitFor(() => {
      expect(queryByTestId('welcome-tour')).toBeNull();
    });
  });

  it('renders step 1 (play) on first visit', async () => {
    resetTour();
    setHashRoute('#/app');
    const { queryByTestId, getByText } = render(() => <WelcomeTour />);
    await waitFor(() => {
      expect(queryByTestId('welcome-tour')).toBeTruthy();
    });
    expect(queryByTestId('welcome-tour-spotlight')).toBeTruthy();
    expect(queryByTestId('welcome-tour-tooltip')).toBeTruthy();
    expect(getByText('Нажми ▶')).toBeTruthy();
    expect(queryByTestId('welcome-tour-skip')).toBeTruthy();
    expect(queryByTestId('welcome-tour-next')).toBeTruthy();
  });

  it('«Пропустить» sets the flag and hides the overlay', async () => {
    resetTour();
    setHashRoute('#/app');
    const { queryByTestId, getByTestId } = render(() => <WelcomeTour />);
    await waitFor(() => {
      expect(queryByTestId('welcome-tour')).toBeTruthy();
    });
    fireEvent.click(getByTestId('welcome-tour-skip'));
    await waitFor(() => {
      expect(queryByTestId('welcome-tour')).toBeNull();
    });
    expect(localStorage.getItem(WAVECODE_ONBOARDING_KEY)).toBe('true');
  });

  it('«Дальше →» advances from step 1 to step 2', async () => {
    resetTour();
    setHashRoute('#/app');
    const { queryByTestId, getByTestId, getByText } = render(() => <WelcomeTour />);
    await waitFor(() => {
      expect(queryByTestId('welcome-tour')).toBeTruthy();
    });
    expect(getByText('Нажми ▶')).toBeTruthy();

    fireEvent.click(getByTestId('welcome-tour-next'));

    await waitFor(() => {
      expect(queryByTestId('welcome-tour')?.getAttribute('data-step')).toBe('edit');
    });
    expect(getByText('Поменяй что-нибудь')).toBeTruthy();
  });

  it('«Готово ✓» on the last step sets the flag and hides the overlay', async () => {
    resetTour();
    setHashRoute('#/app');
    const { queryByTestId, getByTestId, getByText } = render(() => <WelcomeTour />);
    await waitFor(() => {
      expect(queryByTestId('welcome-tour')).toBeTruthy();
    });
    for (let i = 0; i < TOUR_STEPS_COUNT - 1; i++) {
      fireEvent.click(getByTestId('welcome-tour-next'));
    }
    await waitFor(() => {
      expect(queryByTestId('welcome-tour')?.getAttribute('data-step')).toBe('done');
    });
    expect(getByText('Готово ✓')).toBeTruthy();

    fireEvent.click(getByTestId('welcome-tour-next'));
    await waitFor(() => {
      expect(queryByTestId('welcome-tour')).toBeNull();
    });
    expect(localStorage.getItem(WAVECODE_ONBOARDING_KEY)).toBe('true');
  });

  it('Escape key skips the tour', async () => {
    resetTour();
    setHashRoute('#/app');
    const { queryByTestId } = render(() => <WelcomeTour />);
    await waitFor(() => {
      expect(queryByTestId('welcome-tour')).toBeTruthy();
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(queryByTestId('welcome-tour')).toBeNull();
    });
    expect(localStorage.getItem(WAVECODE_ONBOARDING_KEY)).toBe('true');
  });

  it('does not render outside #/app', async () => {
    resetTour();
    setHashRoute('#/');
    const { queryByTestId } = render(() => <WelcomeTour />);
    await waitFor(() => {
      expect(queryByTestId('welcome-tour')).toBeNull();
    });
  });
});