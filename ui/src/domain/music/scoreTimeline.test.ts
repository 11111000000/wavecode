import { describe, it, expect } from 'vitest';
import {
  EMPTY_TIMELINE,
  extractScoreTimeline,
  playheadPhase,
  timelineCycleBounds,
} from './scoreTimeline';

/**
 * The piano roll draws the score's own bars and puts a playhead on
 * them. These tests pin the two facts that make that possible:
 * the length of one pattern repetition, and the score's global time
 * scale.
 */
describe('extractScoreTimeline', () => {
  it('returns the empty timeline for an empty score', () => {
    const tl = extractScoreTimeline('');
    expect(tl.events).toHaveLength(0);
    expect(tl.periodCycles).toBe(1);
    expect(tl.timeScale).toBe(1);
  });

  it('a single note is one bar of pattern', () => {
    const tl = extractScoreTimeline('note("c4 e4 g4")');
    expect(tl.events.length).toBeGreaterThan(0);
    expect(tl.periodCycles).toBe(1);
    expect(tl.timeScale).toBe(1);
  });

  it('a cat of N sections is N bars of pattern', () => {
    const tl = extractScoreTimeline('cat([note("c4"), note("d4"), note("e4")])');
    expect(tl.periodCycles).toBe(3);
    // The sections land one bar apart — the drawn axis and the
    // playhead share these coordinates.
    const starts = tl.events.map((e) => e.startCycle).sort((a, b) => a - b);
    expect(starts[0]).toBe(0);
    expect(Math.max(...starts)).toBe(2);
  });

  it('a stack of one bar is one bar of pattern', () => {
    const tl = extractScoreTimeline('stack(note("c4"), note("d4"))');
    expect(tl.periodCycles).toBe(1);
  });

  it('a stack over a cat takes the longer branch', () => {
    const tl = extractScoreTimeline('stack(cat([note("c4"), note("d4")]), note("e4"))');
    expect(tl.periodCycles).toBe(2);
  });

  it('reads the global slow factor of a slowed cat', () => {
    const tl = extractScoreTimeline('cat([note("c4"), note("d4")]).slow(1.3)');
    expect(tl.periodCycles).toBe(2);
    expect(tl.timeScale).toBeCloseTo(1.3, 6);
  });

  it('reads the global fast factor of a sped-up cat', () => {
    const tl = extractScoreTimeline('cat([note("c4"), note("d4")]).fast(2)');
    expect(tl.periodCycles).toBe(2);
    expect(tl.timeScale).toBeCloseTo(0.5, 6);
  });

  it('ignores a slow that belongs to a nested branch', () => {
    // `slow` inside a stack branch scales that branch only; the drawn
    // model does not stretch it either, so the global scale stays 1.
    const tl = extractScoreTimeline('stack(note("c4"), note("d4").slow(2))');
    expect(tl.timeScale).toBe(1);
  });

  it('the Creep preset is eight bars slowed by 1.3', () => {
    const creep = 'cat(\n  stack(note("g3 b3 d4 b3 g3 b3 d4 b3"), note("g2")),\n  stack(note("f#3 b3 d#4 b3 f#3 b3 d#4 b3"), note("b2")),\n  stack(note("g3 c4 e4 c4 g3 c4 e4 c4"), note("c3")),\n  stack(note("g3 c4 eb4 c4 g3 c4 eb4 c4"), note("c3")),\n  stack(note("[g3,b3,d4]"), note("g2")),\n  stack(note("[b3,d#4,f#4]"), note("b2")),\n  stack(note("[c4,e4,g4]"), note("c3")),\n  stack(note("[c4,eb4,g4]"), note("c3"))\n).slow(1.3)';
    const tl = extractScoreTimeline(creep);
    expect(tl.periodCycles).toBe(8);
    expect(tl.timeScale).toBeCloseTo(1.3, 6);
  });
});

describe('timelineCycleBounds', () => {
  it('an empty score keeps the wide default axis', () => {
    expect(timelineCycleBounds(EMPTY_TIMELINE)).toEqual({ lo: 0, hi: 16 });
  });

  it('the axis starts at the pattern phase 0', () => {
    const tl = extractScoreTimeline('cat([note("c4"), note("d4"), note("e4")])');
    expect(timelineCycleBounds(tl).lo).toBe(0);
  });

  it('the axis ends one bar after the last bar of the repetition', () => {
    const tl = extractScoreTimeline('cat([note("c4"), note("d4"), note("e4")])');
    expect(timelineCycleBounds(tl).hi).toBe(4);
  });

  it('a one bar score still gets a readable axis', () => {
    const tl = extractScoreTimeline('note("c4")');
    expect(timelineCycleBounds(tl).hi).toBeGreaterThanOrEqual(4);
  });
});

describe('playheadPhase', () => {
  it('is 0 before playback starts', () => {
    expect(playheadPhase(0, 1, 8)).toBe(0);
    expect(playheadPhase(-1, 1, 8)).toBe(0);
  });

  it('advances with the scheduler clock', () => {
    expect(playheadPhase(2.5, 1, 8)).toBeCloseTo(2.5, 6);
  });

  it('wraps at the end of one repetition', () => {
    expect(playheadPhase(8, 1, 8)).toBeCloseTo(0, 6);
    expect(playheadPhase(9.25, 1, 8)).toBeCloseTo(1.25, 6);
  });

  it('a slowed score advances slower than the scheduler clock', () => {
    // 1.3 scheduler cycles pass for every bar of the score.
    expect(playheadPhase(1.3, 1.3, 8)).toBeCloseTo(1, 6);
    expect(playheadPhase(10.4, 1.3, 8)).toBeCloseTo(0, 6);
  });

  it('survives a degenerate period or scale', () => {
    // A broken scale falls back to 1 (the score plays 1:1); a broken
    // period falls back to 1 (the pattern is one bar long).
    expect(playheadPhase(4, 0, 8)).toBeCloseTo(4, 6);
    expect(playheadPhase(4, 1, 0)).toBeCloseTo(0, 6);
  });
});
