import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@solidjs/testing-library';

describe('useAudioStartIndicator — poll + safety timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('returns a [getter, setter] tuple on initial mount', async () => {
    const { useAudioStartIndicator } = await import('./useAudioStartIndicator');
    const { result } = renderHook(() =>
      useAudioStartIndicator(() => ({ state: 'suspended', sampleRate: null })),
    );
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(typeof result[0]).toBe('function');
    expect(typeof result[1]).toBe('function');
    expect(result[0]()).toBe(false);
  });

  it('keeps audioStarting true across polls while ctx stays suspended', async () => {
    const { useAudioStartIndicator } = await import('./useAudioStartIndicator');
    const { result } = renderHook(() =>
      useAudioStartIndicator(() => ({ state: 'suspended', sampleRate: 44100 })),
    );
    result[1](true);
    expect(result[0]()).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(result[0]()).toBe(true);
  });

  it('flips audioStarting off after safety timeout (2s) when ctx never reaches running', async () => {
    const { useAudioStartIndicator } = await import('./useAudioStartIndicator');
    const { result } = renderHook(() =>
      useAudioStartIndicator(() => ({ state: 'suspended', sampleRate: 44100 })),
    );
    result[1](true);
    expect(result[0]()).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(result[0]()).toBe(false);
  });

  it('auto-clears via poll (200ms) once ctx reaches running before safety timeout', async () => {
    let current = 'suspended' as string;
    const ctxState = () => ({ state: current, sampleRate: 44100 });
    const { useAudioStartIndicator } = await import('./useAudioStartIndicator');
    const { result } = renderHook(() => useAudioStartIndicator(ctxState));
    result[1](true);
    expect(result[0]()).toBe(true);
    current = 'running';
    vi.advanceTimersByTime(200);
    expect(result[0]()).toBe(false);
  });

  it('does not flip when ctx is already running at start (audioStarting stays false)', async () => {
    const { useAudioStartIndicator } = await import('./useAudioStartIndicator');
    const { result } = renderHook(() =>
      useAudioStartIndicator(() => ({ state: 'running', sampleRate: 44100 })),
    );
    expect(result[0]()).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(result[0]()).toBe(false);
  });
});
