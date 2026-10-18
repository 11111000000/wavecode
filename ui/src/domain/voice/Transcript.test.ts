/**
 * Unit tests for `Transcript` — the value object that stores
 * Web Speech API chunks for a single voice-AI session.
 *
 * These pin the merge contract that the overlay UI and the
 * intent classifier both rely on. A regression here would mean
 * either the UI shows stale text after `final` lands, or the
 * classifier routes garbage to the LLM.
 */

import { describe, it, expect } from 'vitest';
import {
  appendChunk,
  initialTranscriptState,
  type TranscriptChunk,
  type TranscriptState,
} from './Transcript';

const chunk = (
  kind: 'interim' | 'final',
  text: string,
  confidence = 0.9,
  timestampMs = 0,
  lang: TranscriptState['lang'] = 'ru-RU',
): TranscriptChunk =>
  kind === 'interim'
    ? { kind: 'interim', text, confidence, lang, timestampMs }
    : { kind: 'final', text, confidence, lang, timestampMs };

describe('initialTranscriptState', () => {
  it('returns an empty transcript with ru-RU by default', () => {
    const s = initialTranscriptState();
    expect(s.chunks).toHaveLength(0);
    expect(s.interim).toBe('');
    expect(s.final).toBe('');
    expect(s.startedAtMs).toBeNull();
    expect(s.stoppedAtMs).toBeNull();
    expect(s.lang).toBe('ru-RU');
  });

  it('honours an explicit lang tag', () => {
    const s = initialTranscriptState('en-US');
    expect(s.lang).toBe('en-US');
  });
});

describe('appendChunk', () => {
  it('updates interim only, leaves final untouched, on interim chunks', () => {
    let s = initialTranscriptState();
    s = appendChunk(s, chunk('interim', 'сделай по', 0.7, 100));
    expect(s.interim).toBe('сделай по');
    expect(s.final).toBe('');
    expect(s.chunks).toHaveLength(1);

    s = appendChunk(s, chunk('interim', 'сделай побыстрее', 0.8, 200));
    expect(s.interim).toBe('сделай побыстрее');
    expect(s.final).toBe('');
    expect(s.chunks).toHaveLength(2);
  });

  it('on a final chunk: clears interim and appends to final space-separated', () => {
    let s = initialTranscriptState();
    s = appendChunk(s, chunk('interim', 'сделай по', 0.7, 100));
    s = appendChunk(s, chunk('final', 'сделай побыстрее', 0.9, 500));
    expect(s.interim).toBe('');
    expect(s.final).toBe('сделай побыстрее');
    expect(s.chunks).toHaveLength(2);
  });

  it('accumulates multiple finals with single-space separation', () => {
    let s = initialTranscriptState();
    s = appendChunk(s, chunk('final', 'привет', 0.9, 100));
    s = appendChunk(s, chunk('final', 'мир', 0.9, 200));
    s = appendChunk(s, chunk('final', 'как дела', 0.9, 300));
    expect(s.final).toBe('привет мир как дела');
    expect(s.interim).toBe('');
    expect(s.chunks).toHaveLength(3);
  });

  it('trims whitespace around finals so we never grow double-spaces', () => {
    let s = initialTranscriptState();
    s = appendChunk(s, chunk('final', '  привет  ', 0.9, 100));
    s = appendChunk(s, chunk('final', '  мир  ', 0.9, 200));
    expect(s.final).toBe('привет мир');
  });

  it('is a noop on empty text (interim or final)', () => {
    const s0 = initialTranscriptState();
    const a = appendChunk(s0, chunk('interim', '', 0.5, 100));
    expect(a).toBe(s0);
    const b = appendChunk(s0, chunk('final', '', 0.5, 100));
    expect(b).toBe(s0);
  });

  it('stamps startedAtMs on the first non-empty chunk', () => {
    let s = initialTranscriptState();
    s = appendChunk(s, chunk('interim', 'сделай по', 0.7, 1234));
    expect(s.startedAtMs).toBe(1234);
    s = appendChunk(s, chunk('final', 'сделай побыстрее', 0.9, 5678));
    expect(s.startedAtMs).toBe(1234);
  });
});
