/**
 * Haptic feedback helper — wraps `navigator.vibrate` for safe,
 * capability-gated, and testable use.
 *
 * Mobile browsers (Android Chrome/Edge/Firefox) support the
 * Vibration API; iOS Safari does NOT (always silently no-op).
 * Calling `triggerHaptic(5)` on a non-supporting browser is a
 * silent no-op — no errors, no warnings.
 *
 * The packet uses 5ms patterns for snap events (very brief —
 * "yes, you crossed a snap threshold"). Longer patterns (10–20ms)
 * are reserved for future affordance events (drag start, drag end).
 */

const isVibrateAvailable = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return typeof navigator.vibrate === 'function';
};

/** Trigger a brief vibration. Returns true on success, false if
 *  Vibration API is unavailable or the call was rejected. */
export const triggerHaptic = (ms: number = 5): boolean => {
  if (!isVibrateAvailable()) return false;
  if (ms <= 0) return false;
  try {
    return navigator.vibrate(ms);
  } catch {
    return false;
  }
};

/** Pulse pattern for "snap crossed" — a slightly longer vibration
 *  than the brief 5ms. Used for "sheet opened" / "sheet closed"
 *  confirmations. */
export const triggerSnapPulse = (): boolean => triggerHaptic(10);

/** Cancel any ongoing vibration. Useful when the user starts a
 *  new drag and the previous drag's vibration is still in progress. */
export const cancelHaptic = (): boolean => {
  if (!isVibrateAvailable()) return false;
  try {
    return navigator.vibrate(0);
  } catch {
    return false;
  }
};