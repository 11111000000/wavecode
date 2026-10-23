import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@solidjs/testing-library';
import {
  DISCLAIMER_VERSION,
  TERMS_STORAGE_KEY,
  TERMS_OPEN_EVENT,
  openTerms,
  readAcceptedTerms,
  useConsentGate,
  writeAcceptedTerms,
} from './consentGate';

/** Mount the hook and hand the accessors back to the test. */
const mountGate = () => {
  let gate: ReturnType<typeof useConsentGate> | undefined;
  const { unmount } = render(() => {
    gate = useConsentGate();
    return null;
  });
  if (!gate) throw new Error('useConsentGate did not mount');
  return { gate, dispose: unmount };
};

describe('consentGate', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('reads nothing until the terms are stored', () => {
    expect(readAcceptedTerms()).toBeNull();
  });

  it('starts pending and visible on a fresh browser', () => {
    const { gate } = mountGate();
    expect(gate.pending()).toBe(true);
    expect(gate.accepted()).toBe(false);
    expect(gate.visible()).toBe(true);
  });

  it('starts accepted when the current version is stored', () => {
    writeAcceptedTerms(DISCLAIMER_VERSION);
    const { gate } = mountGate();
    expect(gate.accepted()).toBe(true);
    expect(gate.pending()).toBe(false);
    expect(gate.visible()).toBe(false);
  });

  it('writes the version on accept and goes down', async () => {
    const { gate } = mountGate();
    gate.accept();
    expect(localStorage.getItem(TERMS_STORAGE_KEY)).toBe(DISCLAIMER_VERSION);
    await waitFor(() => {
      expect(gate.pending()).toBe(false);
    });
    expect(gate.visible()).toBe(false);
  });

  it('stays pending when the write throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { gate } = mountGate();
    gate.accept();
    expect(gate.pending()).toBe(true);
    expect(gate.visible()).toBe(true);
  });

  it('re-prompts on a stale stored version', () => {
    localStorage.setItem(TERMS_STORAGE_KEY, 'v0');
    const { gate } = mountGate();
    expect(gate.accepted()).toBe(false);
    expect(gate.visible()).toBe(true);
  });

  it('re-opens read-only on the footer event and closes again', async () => {
    writeAcceptedTerms(DISCLAIMER_VERSION);
    const { gate } = mountGate();
    expect(gate.visible()).toBe(false);

    openTerms();
    await waitFor(() => {
      expect(gate.visible()).toBe(true);
    });
    expect(gate.readOnly()).toBe(true);
    expect(gate.pending()).toBe(false);

    gate.close();
    await waitFor(() => {
      expect(gate.visible()).toBe(false);
    });
  });

  it('ignores the footer event as a dismiss for a pending gate', async () => {
    const { gate } = mountGate();
    expect(gate.pending()).toBe(true);

    window.dispatchEvent(new CustomEvent(TERMS_OPEN_EVENT));
    gate.close();

    await waitFor(() => {
      expect(gate.visible()).toBe(true);
    });
    expect(gate.readOnly()).toBe(false);
  });

  it('stops listening after the owner is disposed', async () => {
    writeAcceptedTerms(DISCLAIMER_VERSION);
    const { gate, dispose } = mountGate();
    expect(gate.visible()).toBe(false);

    dispose();
    openTerms();

    await waitFor(() => {
      expect(gate.visible()).toBe(false);
    });
  });
});