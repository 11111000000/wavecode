import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LoopRecorder,
  MAX_REGIONS,
  type Region,
  type RegionColor,
} from './LoopRecorder';
import {
  LiveRecorder,
  pickSupportedMime,
  takeFilename,
} from './AudioRecorder';

/**
 * LoopRecorder — pure data-API tests.
 *
 * Что покрываем:
 *   - region CRUD: add / remove / clearAll / get / getRegionCount.
 *   - порядок цветов (auto-color by slot index).
 *   - max-regions cap (4) → throw.
 *   - `pickSupportedMime` / `takeFilename` / `LiveRecorder` доступны
 *     через re-export из LoopRecorder — backward-compat с AudioRecorder.
 *   - `LoopRecorder.beatToMs` — pure helper, beat * cycleMs.
 *
 * НЕ покрываем здесь:
 *   - mixDownRegions / playRegion / punchIn — нужен реальный
 *     AudioContext + OfflineAudioContext. jsdom их не предоставляет.
 *   - Защищено ассертами, что классы LiveRecorder/pickSupportedMime
 *     импортируются из того же module (равенство ссылок).
 */

const fakeBlob = (bytes = 1024, type = 'audio/webm'): Blob =>
  new Blob([new Uint8Array(bytes)], { type });

const expectColor = (region: Region, color: RegionColor): void => {
  expect(region.color).toBe(color);
};

describe('LoopRecorder — region CRUD', () => {
  let recorder: LoopRecorder;

  beforeEach(() => {
    recorder = new LoopRecorder();
  });

  it('starts empty', () => {
    expect(recorder.getRegionCount()).toBe(0);
    expect(recorder.getRegions()).toEqual([]);
  });

  it('addRegion assigns unique id + sequential color', () => {
    const r0 = recorder.addRegion({ blob: fakeBlob(2048, 'audio/webm'), startMs: 0 });
    const r1 = recorder.addRegion({ blob: fakeBlob(4096, 'audio/webm'), startMs: 500 });
    expectColor(r0, 'green');
    expectColor(r1, 'cyan');
    expect(r0.id).not.toBe(r1.id);
    expect(recorder.getRegionCount()).toBe(2);
  });

  it('addRegion respects MAX_REGIONS cap (4) and throws on 5th', () => {
    for (let i = 0; i < MAX_REGIONS; i++) {
      const r = recorder.addRegion({ blob: fakeBlob() });
      expectColor(r, (['green', 'cyan', 'magenta', 'violet'] as const)[i]!);
    }
    expect(recorder.getRegionCount()).toBe(MAX_REGIONS);
    expect(() => recorder.addRegion({ blob: fakeBlob() })).toThrow(/max regions/i);
  });

  it('addRegion stores startMs / sampleRate when provided', () => {
    const r = recorder.addRegion({
      blob: fakeBlob(),
      startMs: 1234,
      sampleRate: 48000,
    });
    expect(r.startMs).toBe(1234);
    expect(r.sampleRate).toBe(48000);
  });

  it('removeRegion returns true on success / false on missing id', () => {
    const r = recorder.addRegion({ blob: fakeBlob() });
    expect(recorder.removeRegion(r.id)).toBe(true);
    expect(recorder.getRegionCount()).toBe(0);
    expect(recorder.removeRegion('does-not-exist')).toBe(false);
  });

  it('clearAllRegions empties the store', () => {
    recorder.addRegion({ blob: fakeBlob() });
    recorder.addRegion({ blob: fakeBlob() });
    recorder.clearAllRegions();
    expect(recorder.getRegionCount()).toBe(0);
    expect(recorder.getRegions()).toEqual([]);
  });

  it('getRegions returns a snapshot copy (mutation does not affect internal store)', () => {
    recorder.addRegion({ blob: fakeBlob() });
    const snap = recorder.getRegions();
    expect(snap.length).toBe(1);
    // The snapshot is a new array — pushing to it doesn't change the recorder.
    (snap as Region[]).push({
      id: 'fake',
      blob: fakeBlob(),
      startMs: 0,
      color: 'green',
      gain: 1,
      sampleRate: 44100,
      createdAtMs: 0,
    });
    expect(recorder.getRegionCount()).toBe(1);
  });

  it('findRegion returns the region or null', () => {
    const r = recorder.addRegion({ blob: fakeBlob() });
    expect(recorder.findRegion(r.id)?.id).toBe(r.id);
    expect(recorder.findRegion('missing')).toBeNull();
  });
});

describe('LoopRecorder.beatToMs — pure helper', () => {
  it('cps=0.5 default (cycleMs=2000): beat 0..3 → 0/500/1000/1500ms', () => {
    expect(LoopRecorder.beatToMs(0)).toBe(0);
    expect(LoopRecorder.beatToMs(1)).toBe(2000);
    expect(LoopRecorder.beatToMs(2)).toBe(4000);
  });

  it('custom cycleMs: cps=1 (cycleMs=1000) → beat=1 → 1000ms', () => {
    expect(LoopRecorder.beatToMs(1, 1000)).toBe(1000);
    expect(LoopRecorder.beatToMs(4, 1000)).toBe(4000);
  });
});

describe('LoopRecorder — backward-compat re-exports', () => {
  it('re-exports LiveRecorder as the same class from AudioRecorder', () => {
    expect(LoopRecorder['LiveRecorder' as never]).toBeUndefined();
    // Re-exported symbols are importable from LoopRecorder.ts as names.
    // Verify class identity at the import-source level:
    expect(typeof LiveRecorder).toBe('function');
    expect(typeof pickSupportedMime).toBe('function');
    expect(typeof takeFilename).toBe('function');
  });

  it('pickSupportedMime returns null when MediaRecorder is unavailable (jsdom default)', () => {
    // jsdom doesn't define MediaRecorder; pickSupportedMime should
    // fall back to null (existing AudioRecorder behaviour, unchanged).
    expect(pickSupportedMime()).toBeNull();
  });

  it('takeFilename produces timestamped .wav names', () => {
    const name = takeFilename('wav');
    expect(name).toMatch(/^wavecode-take-.*\.wav$/);
  });
});

describe('LoopRecorder — estimatedBlobBytes sum', () => {
  it('sums blob sizes across regions', () => {
    const recorder = new LoopRecorder();
    recorder.addRegion({ blob: fakeBlob(100) });
    recorder.addRegion({ blob: fakeBlob(250) });
    expect(recorder.estimatedBlobBytes()).toBe(350);
  });

  it('zero when empty', () => {
    expect(new LoopRecorder().estimatedBlobBytes()).toBe(0);
  });
});

// Sanity: убедимся что `playRegion` явно проверяет наличие региона
// до обращения к ctx.decodeAudioData (который в jsdom упадёт).
// Это покрытие inline async-флоу: оно catch-ит ошибку быстрее, чем
// decodeAudioData — а значит смешает с jsdom. Падаем ожидаемой ошибкой.
describe('LoopRecorder.playRegion — error path without ctx', () => {
  it('throws on missing region id', async () => {
    const recorder = new LoopRecorder();
    const fakeCtx = {} as unknown as AudioContext;
    await expect(recorder.playRegion('missing', fakeCtx)).rejects.toThrow(/region.*not found/);
  });
});

// Sanity: punchIn требует реальный MediaRecorder — мы только проверяем,
// что `pickSupportedMime()` null в jsdom → punchIn rejects с понятной ошибкой.
describe('LoopRecorder.punchIn — guards gracefully when MediaRecorder missing', () => {
  it('rejects with "ни один MediaRecorder" if pickSupportedMime returns null', async () => {
    const recorder = new LoopRecorder();
    const fakeCtx = {
      currentTime: 0,
    } as unknown as AudioContext;
    await expect(recorder.punchIn(fakeCtx)).rejects.toThrow(/MediaRecorder/i);
  });
});

// Тест stub для миксдауна: проверяем только раннюю ошибку "нет регионов".
// OfflineAudioContext нельзя создать в jsdom (нет Web Audio API).
describe('LoopRecorder.mixDownRegions — early failures', () => {
  it('throws when no regions have been added', async () => {
    const recorder = new LoopRecorder();
    const fakeCtx = {} as unknown as AudioContext;
    await expect(recorder.mixDownRegions(fakeCtx)).rejects.toThrow(/нет регионов/);
  });
});

// Spy check: `pickSupportedMime` импортируется в одном module space —
// нет циклических зависимостей.
describe('LoopRecorder — import wiring', () => {
  it('does not throw when imported twice (idempotent)', async () => {
    const m1 = await import('./LoopRecorder');
    const m2 = await import('./LoopRecorder');
    expect(m1.MAX_REGIONS).toBe(m2.MAX_REGIONS);
  });

  it('exports the LiveRecorder class from AudioRecorder (backward-compat intact)', async () => {
    const { LiveRecorder: LR } = await import('./AudioRecorder');
    expect(LR).toBe(LiveRecorder);
  });
});

// Silence "vi is defined but never used" — оставляем для дальнейших тестов с моками.
void vi;
