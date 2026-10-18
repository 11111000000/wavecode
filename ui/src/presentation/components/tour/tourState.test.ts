import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  shouldShowTour, markTourComplete, resetTour,
  WAVECODE_ONBOARDING_KEY,
} from './tourState';

describe('tourState (decisions/wavecode-welcome-tour.yaml)', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('shouldShowTour returns true when localStorage is empty', () => {
    expect(shouldShowTour()).toBe(true);
  });

  it('shouldShowTour returns false after markTourComplete', () => {
    markTourComplete();
    expect(shouldShowTour()).toBe(false);
    expect(localStorage.getItem(WAVECODE_ONBOARDING_KEY)).toBe('true');
  });

  it('shouldShowTour returns true when the flag is not "true"', () => {
    localStorage.setItem(WAVECODE_ONBOARDING_KEY, 'false');
    expect(shouldShowTour()).toBe(true);
    localStorage.setItem(WAVECODE_ONBOARDING_KEY, '');
    expect(shouldShowTour()).toBe(true);
  });

  it('markTourComplete is idempotent', () => {
    markTourComplete();
    markTourComplete();
    expect(localStorage.getItem(WAVECODE_ONBOARDING_KEY)).toBe('true');
  });

  it('resetTour clears the flag and re-enables the tour', () => {
    markTourComplete();
    expect(shouldShowTour()).toBe(false);
    resetTour();
    expect(shouldShowTour()).toBe(true);
    expect(localStorage.getItem(WAVECODE_ONBOARDING_KEY)).toBeNull();
  });

  it('markTourComplete does not throw when localStorage.setItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      expect(() => markTourComplete()).not.toThrow();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('shouldShowTour does not throw when localStorage.getItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    try {
      expect(shouldShowTour()).toBe(true);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});