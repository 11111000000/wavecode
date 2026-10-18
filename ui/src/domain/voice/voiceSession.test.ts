/**
 * Voice-session reducer tests: pin the full transition table
 * from `decisions/wavecode-voice-fab.yaml`.
 *
 * The reducer is pure, so these are pure unit tests — no mocks,
 * no Effect runtime. Tests build a sequence of events and assert
 * the final state shape.
 */

import { describe, it, expect } from 'vitest';
import {
  initialVoiceSession,
  voiceSessionReducer,
  type VoiceSessionEvent,
  type VoiceSessionState,
} from './voiceSession';
import type { TranscriptChunk } from './Transcript';

const interim = (text: string, t = 100): TranscriptChunk => ({
  kind: 'interim',
  text,
  confidence: 0.9,
  lang: 'ru-RU',
  timestampMs: t,
});

const finalChunk = (text: string, t = 500): TranscriptChunk => ({
  kind: 'final',
  text,
  confidence: 0.93,
  lang: 'ru-RU',
  timestampMs: t,
});

const reduce = (events: ReadonlyArray<VoiceSessionEvent>): VoiceSessionState =>
  events.reduce(voiceSessionReducer, initialVoiceSession());

describe('voiceSessionReducer — happy paths', () => {
  it('idle + arm → arming', () => {
    const next = voiceSessionReducer(initialVoiceSession(), { type: 'arm' });
    expect(next).toEqual({ tag: 'arming' });
  });

  it('arming + stt-ready → listening (continuous=false, empty transcript)', () => {
    const s = voiceSessionReducer({ tag: 'arming' }, { type: 'stt-ready' });
    expect(s.tag).toBe('listening');
    if (s.tag !== 'listening') throw new Error('unreachable');
    expect(s.continuous).toBe(false);
    expect(s.transcript.chunks).toHaveLength(0);
    expect(s.transcript.lang).toBe('ru-RU');
  });

  it('listening + chunk(interim) → still listening, transcript updated', () => {
    const start: VoiceSessionState = {
      tag: 'listening',
      transcript: {
        chunks: [],
        interim: '',
        final: '',
        startedAtMs: null,
        stoppedAtMs: null,
        lang: 'ru-RU',
      },
      continuous: false,
    };
    const next = voiceSessionReducer(start, {
      type: 'chunk',
      chunk: interim('сделай по', 100),
    });
    expect(next.tag).toBe('listening');
    if (next.tag !== 'listening') throw new Error('unreachable');
    expect(next.transcript.interim).toBe('сделай по');
    expect(next.transcript.final).toBe('');
    expect(next.transcript.chunks).toHaveLength(1);
  });

  it('listening + chunk(final) → transcribing (interim cleared, final appended)', () => {
    let s: VoiceSessionState = voiceSessionReducer(
      voiceSessionReducer({ tag: 'arming' }, { type: 'stt-ready' }),
      { type: 'chunk', chunk: interim('сделай по', 100) },
    );
    s = voiceSessionReducer(s, { type: 'chunk', chunk: finalChunk('сделай побыстрее', 500) });
    expect(s.tag).toBe('transcribing');
    if (s.tag !== 'transcribing') throw new Error('unreachable');
    expect(s.transcript.interim).toBe('');
    expect(s.transcript.final).toBe('сделай побыстрее');
  });

  it('transcribing + commit → requesting', () => {
    const s: VoiceSessionState = { tag: 'transcribing', transcript: {
      chunks: [finalChunk('сделай побыстрее')],
      interim: '',
      final: 'сделай побыстрее',
      startedAtMs: 500,
      stoppedAtMs: null,
      lang: 'ru-RU',
    } };
    const next = voiceSessionReducer(s, { type: 'commit' });
    expect(next.tag).toBe('requesting');
    if (next.tag !== 'requesting') throw new Error('unreachable');
    expect(next.transcript.final).toBe('сделай побыстрее');
    expect(next.continuous).toBe(false);
  });

  it('requesting + request-sent → applying (with the LLM-supplied score)', () => {
    const start: VoiceSessionState = {
      tag: 'requesting',
      transcript: {
        chunks: [finalChunk('сделай побыстрее')],
        interim: '',
        final: 'сделай побыстрее',
        startedAtMs: 500,
        stoppedAtMs: null,
        lang: 'ru-RU',
      },
      continuous: false,
    };
    const next = voiceSessionReducer(start, {
      type: 'request-sent',
      score: 's("bd*2").gain(0.5)',
    });
    expect(next.tag).toBe('applying');
    if (next.tag !== 'applying') throw new Error('unreachable');
    expect(next.score).toBe('s("bd*2").gain(0.5)');
    expect(next.continuous).toBe(false);
  });

  it('applied in continuous-mode → listening (loop back), fresh transcript', () => {
    const start: VoiceSessionState = {
      tag: 'applying',
      transcript: {
        chunks: [finalChunk('сделай побыстрее')],
        interim: '',
        final: 'сделай побыстрее',
        startedAtMs: 500,
        stoppedAtMs: null,
        lang: 'ru-RU',
      },
      score: 's("bd*2")',
      continuous: true,
    };
    const next = voiceSessionReducer(start, { type: 'applied' });
    expect(next.tag).toBe('listening');
    if (next.tag !== 'listening') throw new Error('unreachable');
    expect(next.continuous).toBe(true);
    expect(next.transcript.chunks).toHaveLength(0);
    expect(next.transcript.final).toBe('');
  });

  it('applied in non-continuous → idle', () => {
    const start: VoiceSessionState = {
      tag: 'applying',
      transcript: {
        chunks: [],
        interim: '',
        final: 'сделай побыстрее',
        startedAtMs: 500,
        stoppedAtMs: null,
        lang: 'ru-RU',
      },
      score: 's("bd*2")',
      continuous: false,
    };
    const next = voiceSessionReducer(start, { type: 'applied' });
    expect(next).toEqual({ tag: 'idle' });
  });
});

describe('voiceSessionReducer — barge-in', () => {
  it('barge-in during applying → idle (cancels in-flight eval)', () => {
    const start: VoiceSessionState = {
      tag: 'applying',
      transcript: {
        chunks: [],
        interim: '',
        final: 'сделай побыстрее',
        startedAtMs: 500,
        stoppedAtMs: null,
        lang: 'ru-RU',
      },
      score: 's("bd*2")',
      continuous: true,
    };
    const next = voiceSessionReducer(start, { type: 'barge-in' });
    expect(next).toEqual({ tag: 'idle' });
  });

  it('barge-in during listening → idle (resets session)', () => {
    const start: VoiceSessionState = voiceSessionReducer(
      voiceSessionReducer({ tag: 'arming' }, { type: 'stt-ready' }),
      { type: 'chunk', chunk: interim('сделай по', 100) },
    );
    const next = voiceSessionReducer(start, { type: 'barge-in' });
    expect(next).toEqual({ tag: 'idle' });
  });

  it('barge-in during requesting → idle', () => {
    const start: VoiceSessionState = {
      tag: 'requesting',
      transcript: {
        chunks: [],
        interim: '',
        final: 'сделай побыстрее',
        startedAtMs: 500,
        stoppedAtMs: null,
        lang: 'ru-RU',
      },
      continuous: false,
    };
    const next = voiceSessionReducer(start, { type: 'barge-in' });
    expect(next).toEqual({ tag: 'idle' });
  });

  it('barge-in is a noop while idle (nothing to interrupt)', () => {
    const next = voiceSessionReducer(initialVoiceSession(), { type: 'barge-in' });
    expect(next).toEqual({ tag: 'idle' });
  });
});

describe('voiceSessionReducer — pause and resume', () => {
  it('pause from listening → paused (with transcript preserved)', () => {
    let s: VoiceSessionState = voiceSessionReducer(
      { tag: 'arming' },
      { type: 'stt-ready' },
    );
    s = voiceSessionReducer(s, { type: 'chunk', chunk: interim('сделай по', 100) });
    s = voiceSessionReducer(s, { type: 'pause' });
    expect(s.tag).toBe('paused');
    if (s.tag !== 'paused') throw new Error('unreachable');
    expect(s.transcript.interim).toBe('сделай по');
  });

  it('paused + resume → listening (continuous=true so the user can keep going)', () => {
    let s: VoiceSessionState = voiceSessionReducer(
      { tag: 'arming' },
      { type: 'stt-ready' },
    );
    s = voiceSessionReducer(s, { type: 'chunk', chunk: interim('сделай по', 100) });
    s = voiceSessionReducer(s, { type: 'pause' });
    s = voiceSessionReducer(s, { type: 'resume' });
    expect(s.tag).toBe('listening');
    if (s.tag !== 'listening') throw new Error('unreachable');
    expect(s.continuous).toBe(true);
    expect(s.transcript.interim).toBe('сделай по');
  });
});

describe('voiceSessionReducer — error and dismiss', () => {
  it('error from listening → errored (transcript preserved)', () => {
    let s: VoiceSessionState = voiceSessionReducer(
      { tag: 'arming' },
      { type: 'stt-ready' },
    );
    s = voiceSessionReducer(s, { type: 'chunk', chunk: interim('сделай по', 100) });
    s = voiceSessionReducer(s, { type: 'error', message: 'mic permission denied' });
    expect(s.tag).toBe('errored');
    if (s.tag !== 'errored') throw new Error('unreachable');
    expect(s.error).toBe('mic permission denied');
    expect(s.transcript.interim).toBe('сделай по');
  });

  it('errored + dismiss → idle', () => {
    let s: VoiceSessionState = voiceSessionReducer(
      { tag: 'arming' },
      { type: 'stt-ready' },
    );
    s = voiceSessionReducer(s, { type: 'error', message: 'stt unsupported' });
    s = voiceSessionReducer(s, { type: 'dismiss' });
    expect(s).toEqual({ tag: 'idle' });
  });

  it('errored + arm → arming (user can try again after a recoverable failure)', () => {
    let s: VoiceSessionState = voiceSessionReducer(
      { tag: 'arming' },
      { type: 'error', message: 'transient' },
    );
    s = voiceSessionReducer(s, { type: 'arm' });
    expect(s).toEqual({ tag: 'arming' });
  });
});

describe('voiceSessionReducer — re-arm', () => {
  it('arm from listening re-arms; chunk alone does NOT', () => {
    let s: VoiceSessionState = voiceSessionReducer(
      { tag: 'arming' },
      { type: 'stt-ready' },
    );
    // Many chunks while listening — state must stay listening.
    s = voiceSessionReducer(s, { type: 'chunk', chunk: interim('сделай', 100) });
    s = voiceSessionReducer(s, { type: 'chunk', chunk: interim('сделай по', 200) });
    expect(s.tag).toBe('listening');
    s = voiceSessionReducer(s, { type: 'chunk', chunk: interim('сделай побыстрее', 300) });
    expect(s.tag).toBe('listening');
    // Explicit arm — must go back to arming.
    s = voiceSessionReducer(s, { type: 'arm' });
    expect(s).toEqual({ tag: 'arming' });
    // And stt-ready brings us back to a fresh listening state.
    s = voiceSessionReducer(s, { type: 'stt-ready' });
    expect(s.tag).toBe('listening');
    if (s.tag !== 'listening') throw new Error('unreachable');
    expect(s.transcript.chunks).toHaveLength(0);
  });
});

describe('voiceSessionReducer — full press-and-talk flow', () => {
  it('drives idle → arming → listening → transcribing → requesting → applying → idle', () => {
    const events: ReadonlyArray<VoiceSessionEvent> = [
      { type: 'arm' },
      { type: 'stt-ready' },
      { type: 'chunk', chunk: interim('сделай по', 100) },
      { type: 'chunk', chunk: finalChunk('сделай побыстрее', 500) },
      { type: 'commit' },
      { type: 'request-sent', score: 's("bd*2")' },
      { type: 'applied' },
    ];
    const final = reduce(events);
    expect(final).toEqual({ tag: 'idle' });
  });
});
