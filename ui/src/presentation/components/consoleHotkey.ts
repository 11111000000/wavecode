/**
 * consoleHotkey — pure modifier-aware hotkey matcher.
 *
 * Why this exists: we need ONE place that encodes "Cmd OR Ctrl" cross-
 * platform semantics (Mac uses `metaKey`, Win/Linux use `ctrlKey`).
 * Tests assert the contract directly; consumers don't repeat the
 * metaKey||ctrlKey incantation.
 *
 * What this is NOT:
 *   - It does NOT look at `event.target`. The caller decides whether
 *     the hotkey should fire when focus is in INPUT/TEXTAREA. Keeping
 *     target-check out of the helper makes it text-input-aware only
 *     where the caller wants (e.g. `consoleGlobals` suppresses, but
 *     CodeMirror Cmd+D for "duplicate line" would NOT suppress).
 *   - It does NOT call `preventDefault`. Caller's responsibility.
 *
 * Modifier rules:
 *   - `metaKey || ctrlKey` is always the "trigger" for Cmd/Ctrl.
 *     We don't let the hotkey require only one of the two — that
 *     would break either Mac or Win/Linux.
 *   - `shift` and `alt` are EXPLICIT: each must match the event flag.
 *     If `hotkey.shift === undefined`, event.shiftKey must be false.
 *     If `hotkey.shift === true`, event.shiftKey must be true.
 *   - `alt` follows the same contract.
 *
 * Case-insensitive: `event.key` is normalized via `.toLowerCase()`.
 * The cost is one string-alloc per match — negligible vs the cost of
 * writing two `||` branches everywhere.
 */

export type Hotkey = {
  /** Lowercase key (e.g. 'd', '`', '/'). Modifier-aware comparisons use event.ctrlKey||metaKey OR'd. */
  readonly key: string;
  /** If true, shift must be held. If undefined, shift must NOT be held. */
  readonly shift?: boolean;
  /** If true, alt/option must be held. If undefined, alt must NOT be held. */
  readonly alt?: boolean;
};

const matchesFlag = (eventFlag: boolean, required: boolean | undefined): boolean => {
  if (required === undefined) return !eventFlag;
  return eventFlag === required;
};

export const matchesHotkey = (event: KeyboardEvent, hotkey: Hotkey): boolean => {
  if (event.key.toLowerCase() !== hotkey.key) return false;
  if (!(event.metaKey || event.ctrlKey)) return false;
  if (!matchesFlag(event.shiftKey, hotkey.shift)) return false;
  if (!matchesFlag(event.altKey, hotkey.alt)) return false;
  return true;
};
