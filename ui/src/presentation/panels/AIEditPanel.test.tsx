import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';

/**
 * Mock the composition root, the LLM-stream use-case, and the audio
 * eval layer so the panel does not pull Strudel / WebAudio into the
 * test environment. Each test installs a fresh mock for
 * `applyEditStream` that returns an `Effect.succeed(...)` so the
 * gen block's `yield*` unwraps it transparently.
 *
 * The mock `AppLayer` is built inside the factory closure (which
 * vi.mock hoists above the static imports) so we have access to
 * `effect` and `AudioEngine`. `Layer.empty` would fail at runtime
 * because the panel's success path calls `yield* AudioEngine` for
 * the post-LLM eval — we provide a no-op stub instead.
 *
 * `vi.hoisted` is required because vi.mock factories run before
 * top-level `const` declarations; without it, `applyEditStreamMock`
 * is in TDZ when the factory tries to close over it.
 */

const mocks = vi.hoisted(() => ({
  applyEditStream: vi.fn(),
  unlockAudioContext: vi.fn(),
}));

vi.mock('~/infrastructure/composition', () => {
  return {
    AppLayer: undefined, // overwritten by a synchronous getter below
  };
});

vi.mock('~/infrastructure/audio/LiveAudioEngine', () => ({
  unlockAudioContext: () => mocks.unlockAudioContext(),
}));

vi.mock('~/application/useCases/llmEdit', () => {
  return {
    applyEditStream: (
      ...args: ReadonlyArray<unknown>
    ): unknown => mocks.applyEditStream(...args),
    applyEdit: vi.fn(),
    getLastRawLLMResponse: () => '',
    isScoreBroken: vi.fn(),
    SELF_HEAL_RETRY_BUDGET: 1,
    cleanLLMResponse: (s: string) => s,
  };
});

vi.mock('~/presentation/components/LLMSettingsPopover', () => ({
  LLMSettingsPopover: (): unknown => null,
}));

// Static imports below run AFTER vi.mock has hoisted the factories
// above. By this point, the mock module `~/infrastructure/composition`
// has a frozen `AppLayer: undefined`; we now overwrite it with a real
// Effect.Layer that supplies a stub AudioEngine so the panel's
// `yield* AudioEngine` calls inside `submit()` resolve.
import { Layer, Effect } from 'effect';
import { AudioEngine } from '~/domain/services';
import * as compositionMod from '~/infrastructure/composition';

(compositionMod as { AppLayer?: unknown }).AppLayer = Layer.succeed(
  AudioEngine,
  {
    eval: (_snippet: string) => Effect.succeed(undefined),
    stop: () => Effect.succeed(undefined),
    compileAndQuery: () => Effect.succeed([]),
    setCps: () => Effect.succeed(undefined),
    setLayerMix: () => Effect.succeed(undefined),
    setScore: () => Effect.succeed(undefined),
    getCycleProgress: () => Effect.succeed(0),
    registerMicStream: () => Effect.succeed(undefined),
    setRepl: () => undefined,
    getReplState: () => ({ cps: 0.5, isPlaying: false }),
    getDebug: () => ({ cps: 0.5, replState: null, evalCount: 0, lastError: undefined }),
  } as never,
);

import { AIEditPanel } from './AIEditPanel';
import { dispatch } from '../state/appStore';

beforeEach(() => {
  mocks.applyEditStream.mockReset();
  // Seed the active preset with a known score + an empty dialog so
  // the panel renders and submit() can read activeMessages().
  // Default active preset is 'creep' — switch to a synthetic 'p1'
  // so the test is hermetic from preset-store state.
  dispatch({ type: 'switchPreset', id: 'p1' });
  dispatch({ type: 'replaceScore', text: 'note("c4")' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AIEditPanel — happy path streaming', () => {
  it('renders the empty-state placeholder when there are no messages', () => {
    const { queryByText } = render(() => <AIEditPanel />);
    expect(queryByText(/Здесь будет диалог/)).toBeTruthy();
  });

  it('streams assistant tokens into a draft message then replaces with the final message', async () => {
    let capturedOnToken: ((s: string) => void) | undefined;

    mocks.applyEditStream.mockImplementation(
      (
        _score: unknown,
        _instruction: unknown,
        _history: unknown,
        _audioState: unknown,
        _options: unknown,
        ...rest: unknown[]
      ) => {
        const callbacks = rest[0] as {
          onToken?: (s: string) => void;
        } | undefined;
        capturedOnToken = callbacks?.onToken;
        // Simulate the LLM streaming two tokens then completing.
        queueMicrotask(() => {
          capturedOnToken?.('stack(');
          capturedOnToken?.('note("c4"))');
        });
        return Effect.succeed({ score: 'stack(note("c4"))', wasHealed: false, attempts: 1 });
      },
    );

    const { queryByText, findByText } = render(() => <AIEditPanel />);
    const applyBtn = document.querySelector('[data-ai-apply-btn]') as HTMLButtonElement | null;
    expect(applyBtn).toBeTruthy();
    const input = document.querySelector('[data-ai-textarea]') as HTMLTextAreaElement | null;
    expect(input).toBeTruthy();
    fireEvent.input(input!, { target: { value: 'сделай stack' } });
    fireEvent.click(applyBtn!);

    // Let microtask + queueMicrotask drain.
    await new Promise((r) => setTimeout(r, 30));
    // The panel passes ONLY onToken to applyEditStream (onComplete and
    // onError are owned by the useCase internally), so the mock
    // implementation captures the same object — verify the streaming
    // path captured it.
    expect(capturedOnToken).toBeDefined();
    // Tokens flowed to the draft and the final message replaced it.
    const finalBody = await findByText('stack(note("c4"))');
    expect(finalBody).toBeTruthy();
    // Success status visible.
    expect(queryByText(/Готово/)).toBeTruthy();
    // No manual retry button (success path).
    expect(document.querySelector('.ai-retry-btn')).toBeNull();
  });
});

describe('AIEditPanel — self-heal success', () => {
  it('renders "Готово (сам исправил)" when wasHealed is true', async () => {
    let capturedOnComplete: ((r: unknown) => void) | undefined;
    mocks.applyEditStream.mockImplementation(
      (
        _score: unknown,
        _instruction: unknown,
        _history: unknown,
        _audioState: unknown,
        _options: unknown,
        ...rest: unknown[]
      ) => {
        const callbacks = rest[0] as { onComplete?: (r: unknown) => void } | undefined;
        capturedOnComplete = callbacks?.onComplete;
        queueMicrotask(() => {
          capturedOnComplete?.({ score: 'stack(note("c4"))', wasHealed: true, attempts: 2 });
        });
        return Effect.succeed({ score: 'stack(note("c4"))', wasHealed: true, attempts: 2 });
      },
    );
    const { queryByText } = render(() => <AIEditPanel />);
    const applyBtn = document.querySelector('[data-ai-apply-btn]') as HTMLButtonElement | null;
    const input = document.querySelector('[data-ai-textarea]') as HTMLTextAreaElement | null;
    fireEvent.input(input!, { target: { value: 'wrap' } });
    fireEvent.click(applyBtn!);
    await new Promise((r) => setTimeout(r, 30));
    expect(queryByText(/сам исправил/)).toBeTruthy();
  });
});

describe('AIEditPanel — error path keeps lastFailed', () => {
  it('surfaces the retry button when applyEditStream rejects', async () => {
    mocks.applyEditStream.mockReturnValue(Effect.fail(new Error('boom')));
    const { queryByText, findByText } = render(() => <AIEditPanel />);
    const applyBtn = document.querySelector('[data-ai-apply-btn]') as HTMLButtonElement | null;
    const input = document.querySelector('[data-ai-textarea]') as HTMLTextAreaElement | null;
    fireEvent.input(input!, { target: { value: 'fail' } });
    fireEvent.click(applyBtn!);
    const errLabel = await findByText(/LLM ошибка/);
    expect(errLabel).toBeTruthy();
    expect(document.querySelector('.ai-retry-btn')).toBeTruthy();
    expect(queryByText(/Готово/)).toBeNull();
  });
});