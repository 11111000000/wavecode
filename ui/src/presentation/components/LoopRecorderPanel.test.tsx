import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';

// vi.mock factory hoisted to top of module — must use vi.hoisted so
// the mockState object exists when the factory runs.

// vi.mock factory hoisted to top of module — must use vi.hoisted so
// the mockState object exists when the factory runs.
const { mockState } = vi.hoisted(() => {
  const mockState = {
    regions: vi.fn(() => [] as ReadonlyArray<unknown>),
    regionCount: vi.fn(() => 0),
    recording: vi.fn(() => false),
    recordingSlot: vi.fn(() => null as number | null),
    playbackMode: vi.fn(() => 'all' as const),
    lastError: vi.fn(() => null as string | null),
    startRecording: vi.fn(async () => {}),
    stopRecording: vi.fn(async () => {}),
    punchIn: vi.fn(async () => {}),
    playRegion: vi.fn(async () => {}),
    removeRegion: vi.fn(),
    clearRegions: vi.fn(),
    setPlaybackMode: vi.fn(),
    exportMixDown: vi.fn(async () => null),
  };
  return { mockState };
});

vi.mock('../state/recorderStore', () => ({
  recorderStore: mockState,
}));

import { LoopRecorderPanel } from './LoopRecorderPanel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  // Reset between tests
  mockState.regions.mockReturnValue([]);
  mockState.regionCount.mockReturnValue(0);
  mockState.recording.mockReturnValue(false);
  mockState.recordingSlot.mockReturnValue(null);
  mockState.lastError.mockReturnValue(null);
  mockState.exportMixDown.mockResolvedValue(null);
});

describe('LoopRecorderPanel — initial render', () => {
  it('renders title and counter "0/4 regions"', () => {
    const { getByText } = render(() => <LoopRecorderPanel />);
    expect(getByText(/Loop recorder/i)).toBeTruthy();
    expect(getByText(/0\/4 regions/)).toBeTruthy();
  });

  it('renders exactly 4 slot buttons with distinct colors', () => {
    const { getAllByRole } = render(() => <LoopRecorderPanel />);
    const slots = getAllByRole('button').filter((b) => b.classList.contains('loop-slot'));
    expect(slots.length).toBe(4);
    const colors = slots.map((s) => s.getAttribute('data-color'));
    expect(colors).toEqual(['green', 'cyan', 'magenta', 'violet']);
    expect(new Set(colors).size).toBe(4); // distinct
  });

  it('all slots start with data-empty=true when no regions exist', () => {
    const { getAllByRole } = render(() => <LoopRecorderPanel />);
    const slots = getAllByRole('button').filter((b) => b.classList.contains('loop-slot'));
    for (const s of slots) {
      expect(s.getAttribute('data-empty')).toBe('true');
    }
  });

  it('renders 4 beat-marker buttons in the punch-in timeline', () => {
    const { container } = render(() => <LoopRecorderPanel />);
    const beats = container.querySelectorAll('.loop-timeline-beat');
    expect(beats.length).toBe(4);
  });

  it('mix-down button is disabled when there are no regions', () => {
    const { getByText } = render(() => <LoopRecorderPanel />);
    const mixBtn = getByText(/Mix → WAV/);
    expect((mixBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('Clear button is disabled when there are no regions', () => {
    const { getByText } = render(() => <LoopRecorderPanel />);
    const clearBtn = getByText(/Clear/);
    expect((clearBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('Stop button is disabled when not recording', () => {
    const { getByText } = render(() => <LoopRecorderPanel />);
    const stopBtn = getByText(/Stop/);
    expect((stopBtn as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('LoopRecorderPanel — interactions', () => {
  it('clicking an empty slot invokes startRecording with slot=1', async () => {
    const { getAllByRole } = render(() => <LoopRecorderPanel />);
    const slot = getAllByRole('button').find((b) => b.classList.contains('loop-slot'))!;
    fireEvent.click(slot);
    expect(mockState.startRecording).toHaveBeenCalledWith(1);
  });

  it('clicking a non-empty slot calls playRegion with the region id', async () => {
    const region = { id: 'r-test-1', blob: new Blob(), startMs: 0, color: 'green', gain: 1, sampleRate: 44100, createdAtMs: 0 };
    mockState.regions.mockReturnValue([region]);
    mockState.regionCount.mockReturnValue(1);
    const { getAllByRole } = render(() => <LoopRecorderPanel />);
    const slot = getAllByRole('button').find((b) => b.classList.contains('loop-slot'))!;
    expect(slot.getAttribute('data-empty')).toBe('false');
    fireEvent.click(slot);
    expect(mockState.playRegion).toHaveBeenCalledWith('r-test-1');
  });

  it('shift+click on a non-empty slot calls removeRegion', () => {
    const region = { id: 'r-shift-delete', blob: new Blob(), startMs: 0, color: 'green', gain: 1, sampleRate: 44100, createdAtMs: 0 };
    mockState.regions.mockReturnValue([region]);
    mockState.regionCount.mockReturnValue(1);
    const { getAllByRole } = render(() => <LoopRecorderPanel />);
    const slot = getAllByRole('button').find((b) => b.classList.contains('loop-slot'))!;
    fireEvent.click(slot, { shiftKey: true });
    expect(mockState.removeRegion).toHaveBeenCalledWith('r-shift-delete');
    expect(mockState.playRegion).not.toHaveBeenCalled();
  });

  it('clicking a beat calls punchIn(beat)', () => {
    const { container } = render(() => <LoopRecorderPanel />);
    const beats = container.querySelectorAll('.loop-timeline-beat');
    fireEvent.click(beats[2]!); // beat=2
    expect(mockState.punchIn).toHaveBeenCalledWith(2);
  });

  it('Clear button calls clearRegions when regions exist', () => {
    mockState.regionCount.mockReturnValue(2);
    const { getByText } = render(() => <LoopRecorderPanel />);
    const clearBtn = getByText(/Clear/);
    fireEvent.click(clearBtn);
    expect(mockState.clearRegions).toHaveBeenCalled();
  });
});

describe('LoopRecorderPanel — recording state surfaces', () => {
  it('shows "● recording slot N" pill when recordingSlot set', () => {
    mockState.recording.mockReturnValue(true);
    mockState.recordingSlot.mockReturnValue(2);
    const { getByText } = render(() => <LoopRecorderPanel />);
    expect(getByText(/recording slot 2/)).toBeTruthy();
  });

  it('marks the recording slot\'s button with data-status="recording"', () => {
    mockState.recording.mockReturnValue(true);
    mockState.recordingSlot.mockReturnValue(3);
    const { getAllByRole } = render(() => <LoopRecorderPanel />);
    const slots = getAllByRole('button').filter((b) => b.classList.contains('loop-slot'));
    // slot index 3 → recordingSlot=3 means zero-based idx=2 (third slot, "magenta").
    const recSlot = slots[2]!;
    expect(recSlot.getAttribute('data-status')).toBe('recording');
    // other slots should not be "recording"
    for (const s of slots) {
      if (s === recSlot) continue;
      expect(s.getAttribute('data-status')).not.toBe('recording');
    }
  });

  it('Stop button enabled when recording', () => {
    mockState.recording.mockReturnValue(true);
    const { getByText } = render(() => <LoopRecorderPanel />);
    const stopBtn = getByText(/Stop/);
    expect((stopBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('Click Stop invokes stopRecording', () => {
    mockState.recording.mockReturnValue(true);
    const { getByText } = render(() => <LoopRecorderPanel />);
    fireEvent.click(getByText(/Stop/));
    expect(mockState.stopRecording).toHaveBeenCalled();
  });
});

describe('LoopRecorderPanel — error display', () => {
  it('shows error pill when lastError() returns non-null', () => {
    mockState.lastError.mockReturnValue('boom');
    const { container } = render(() => <LoopRecorderPanel />);
    const errEl = container.querySelector('.loop-err');
    expect(errEl).toBeTruthy();
    expect(errEl?.textContent).toContain('boom');
  });

  it('no error pill when lastError() returns null', () => {
    const { container } = render(() => <LoopRecorderPanel />);
    expect(container.querySelector('.loop-err')).toBeNull();
  });
});

describe('LoopRecorderPanel — mix-down flow', () => {
  it('disables mix-down when regionCount is 0', () => {
    const { getByText } = render(() => <LoopRecorderPanel />);
    const mixBtn = getByText(/Mix → WAV/) as HTMLButtonElement;
    expect(mixBtn.disabled).toBe(true);
  });

  it('mix-down is callable when regionCount > 0', () => {
    mockState.regionCount.mockReturnValue(2);
    const { getByText } = render(() => <LoopRecorderPanel />);
    const mixBtn = getByText(/Mix → WAV/) as HTMLButtonElement;
    expect(mixBtn.disabled).toBe(false);
    // Mock exportMixDown returns null → no download triggered (test passes).
    fireEvent.click(mixBtn);
    expect(mockState.exportMixDown).toHaveBeenCalled();
  });
});
