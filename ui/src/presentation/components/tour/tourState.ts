/**
 * Onboarding-tour state.
 *
 * Single source of truth for the question "has the user seen the
 * welcome tour?". Stored in `localStorage` under
 * `wavecode-onboarding-complete-v1` — keyed by version so a future
 * redesign of the tour can re-trigger it by bumping the suffix.
 *
 * Reads / writes are wrapped in try/catch — `localStorage` throws
 * in private mode (Safari iOS) and in quota-exceeded conditions;
 * a tour must not break the app.
 *
 * The step counter itself lives inside `WelcomeTour.tsx` (a
 * local `createSignal(0)`), not here. The localStorage flag is
 * the only piece of state that survives a page reload; the step
 * counter always restarts at 0 when the overlay re-mounts.
 */

export const WAVECODE_ONBOARDING_KEY = 'wavecode-onboarding-complete-v1';

const COMPLETE_VALUE = 'true';

const readStored = (): boolean => {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(WAVECODE_ONBOARDING_KEY) === COMPLETE_VALUE;
  } catch {
    return false;
  }
};

const writeStored = (): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(WAVECODE_ONBOARDING_KEY, COMPLETE_VALUE);
  } catch {
    /* localStorage unavailable (private mode / quota) — silent no-op */
  }
};

const clearStored = (): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(WAVECODE_ONBOARDING_KEY);
  } catch {
    /* ignore */
  }
};

/**
 * Pure read — does not subscribe to anything. Use this in
 * non-reactive contexts (test setup, `onMount` initial check).
 */
export const shouldShowTour = (): boolean => !readStored();

/**
 * Marks the tour as complete and hides the overlay on next render.
 * Idempotent — calling twice is harmless.
 */
export const markTourComplete = (): void => {
  writeStored();
};

/**
 * Clears the flag. Used by tests and by the (currently absent)
 * "Show tour again" admin button. Renders the overlay again on
 * next render.
 */
export const resetTour = (): void => {
  clearStored();
};