/**
 * Consent gate state — who has accepted the site terms, and whether the
 * blocking overlay should be up.
 *
 * See `decisions/wavecode-disclaimer-gate.yaml`. Two states matter:
 *
 *   • pending  — the current wording has never been accepted. The gate
 *     covers the viewport, the app underneath is `inert`, and there is
 *     no way out except the checkbox + «Принять».
 *   • readOnly — accepted, but re-opened from the landing footer. Same
 *     overlay, no consent controls, a «×» to close.
 *
 * Acceptance is versioned and persisted in `localStorage`, so bumping
 * `DISCLAIMER_VERSION` re-prompts everyone on the previous wording.
 *
 * Fail-visible: if the write throws (private mode, storage disabled) the
 * acceptance is NOT recorded and the gate stays up. A silently accepted
 * gate is a worse failure than a repeated prompt.
 */

import { createMemo, createSignal, onCleanup, onMount, type Accessor } from 'solid-js';

/**
 * Bump when the wording changes: every stored acceptance of an older
 * version stops matching and the gate comes back.
 */
export const DISCLAIMER_VERSION = 'v1';

export const TERMS_STORAGE_KEY = 'wavecodeTermsAccepted';

/** Fired by the landing footer to re-open the terms after acceptance. */
export const TERMS_OPEN_EVENT = 'wavecode:open-terms';

export const openTerms = (): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TERMS_OPEN_EVENT));
};

export const readAcceptedTerms = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TERMS_STORAGE_KEY);
  } catch {
    // Private-mode / disabled storage — treat as "not accepted yet".
    return null;
  }
};

export const writeAcceptedTerms = (version: string): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(TERMS_STORAGE_KEY, version);
    return true;
  } catch {
    return false;
  }
};

export interface ConsentGate {
  /** Current version is accepted — the gate stays down unless re-opened. */
  readonly accepted: Accessor<boolean>;
  /** Never accepted: the gate blocks the app and cannot be dismissed. */
  readonly pending: Accessor<boolean>;
  /** Accepted, then re-opened read-only from the footer. */
  readonly readOnly: Accessor<boolean>;
  /** The overlay is on screen; whatever is behind it must be inert. */
  readonly visible: Accessor<boolean>;
  readonly accept: () => void;
  readonly close: () => void;
}

export const useConsentGate = (): ConsentGate => {
  const [acceptedVersion, setAcceptedVersion] = createSignal<string | null>(
    readAcceptedTerms(),
  );
  const [readOnly, setReadOnly] = createSignal(false);

  const accepted = createMemo(() => acceptedVersion() === DISCLAIMER_VERSION);
  const pending = createMemo(() => !accepted());
  const visible = createMemo(() => pending() || readOnly());

  onMount(() => {
    const onOpen = (): void => {
      setReadOnly(true);
    };
    window.addEventListener(TERMS_OPEN_EVENT, onOpen);
    onCleanup(() => window.removeEventListener(TERMS_OPEN_EVENT, onOpen));
  });

  return {
    accepted,
    pending,
    readOnly,
    visible,
    accept: () => {
      const version = DISCLAIMER_VERSION;
      // A failed write leaves the gate up — see the fail-visible note above.
      setAcceptedVersion(writeAcceptedTerms(version) ? version : null);
      setReadOnly(false);
    },
    close: (): void => {
      setReadOnly(false);
    },
  };
};