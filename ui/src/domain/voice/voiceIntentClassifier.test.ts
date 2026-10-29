/**
 * Voice-intent classifier tests (MVP rule-based).
 *
 * The MVP behaviour: every non-empty final transcript with
 * confidence ≥ 0.5 → `EditScoreIntent`. Empty / too-quiet →
 * typed-failure result. No LLM call.
 *
 * Future LLM-routed versions inherit the same signature; these
 * tests pin the public contract so swapping the impl is safe.
 */

import { describe, it, expect } from 'vitest';
import {
  MIN_CONFIDENCE,
  classifyTranscript,
  type ClassifierContext,
} from './voiceIntentClassifier';
import {
  appendChunk,
  initialTranscriptState,
  type TranscriptChunk,
} from './Transcript';
import type { EditScoreIntent } from './VoiceIntent';

const ts = (n: number) => 1_700_000_000_000 + n;

const interim = (text: string, confidence = 0.9, t = 0): TranscriptChunk => ({
  kind: 'interim',
  text,
  confidence,
  lang: 'ru-RU',
  timestampMs: ts(t),
});

const final = (text: string, confidence = 0.9, t = 100): TranscriptChunk => ({
  kind: 'final',
  text,
  confidence,
  lang: 'ru-RU',
  timestampMs: ts(t),
});

const ctx = (now = ts(200)): ClassifierContext => ({
  now,
  currentScore: '',
  bargeInMode: 'replace',
});

describe('classifyTranscript', () => {
  it('returns no-speech for an empty transcript', () => {
    const r = classifyTranscript(initialTranscriptState(), ctx());
    expect(r).toEqual({ ok: false, reason: 'no-speech' });
  });

  it('returns no-speech when only interim partials are present', () => {
    let s = initialTranscriptState();
    s = appendChunk(s, interim('сделай по', 0.95, 10));
    const r = classifyTranscript(s, ctx());
    expect(r).toEqual({ ok: false, reason: 'no-speech' });
  });

  it('returns too-low-confidence when the final chunk sits below the gate', () => {
    let s = initialTranscriptState();
    s = appendChunk(s, interim('сделай по', 0.95, 10));
    s = appendChunk(s, final('сделай побыстрее', MIN_CONFIDENCE - 0.01, 100));
    const r = classifyTranscript(s, ctx());
    expect(r).toEqual({ ok: false, reason: 'too-low-confidence' });
  });

  it('routes a confident finalised utterance to edit-score with the trimmed text', () => {
    let s = initialTranscriptState();
    s = appendChunk(s, interim('сделай по', 0.95, 10));
    s = appendChunk(s, final('сделай побыстрее', 0.93, 100));
    const now = ts(200);
    const r = classifyTranscript(s, ctx(now));
    expect(r.ok).toBe(true);
    if (r.ok !== true) throw new Error('unreachable: expected ok=true');
    if (r.intent.kind !== 'edit-score') throw new Error('unreachable: expected edit-score');
    const intent: EditScoreIntent = r.intent;
    expect(intent.kind).toBe('edit-score');
    expect(intent.instruction).toBe('сделай побыстрее');
    expect(intent.confidence).toBe(0.93);
    expect(intent.timestampMs).toBe(now);
  });

  it('uses the LAST final chunk confidence, not the average', () => {
    let s = initialTranscriptState();
    s = appendChunk(s, final('первая фраза', 0.4, 50));
    s = appendChunk(s, final('вторая фраза', 0.95, 100));
    const r = classifyTranscript(s, ctx());
    expect(r.ok).toBe(true);
    if (r.ok !== true) throw new Error('unreachable: expected ok=true');
    if (r.intent.kind !== 'edit-score') throw new Error('unreachable: expected edit-score');
    expect(r.intent.confidence).toBe(0.95);
    expect(r.intent.instruction).toBe('первая фраза вторая фраза');
  });
});
