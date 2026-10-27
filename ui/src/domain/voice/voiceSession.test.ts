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
import {
  initialTranscriptState,
  type TranscriptChunk,
  type TranscriptState,
} from './Transcript';

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

  it('applied in non-continuous → sent (the buffer survives the send)', () => {
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
    // NOT `idle`: the panel must stay open with the text so the user
    // can see what was sent, fix a misheard word and send it again.
    expect(next.tag).toBe('sent');
    expect(next.tag === 'sent' && next.editedText).toBe('сделай побыстрее');
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

describe('voiceSessionReducer — take continuation after release', () => {
  it('arm from paused resumes listening with the transcript intact', () => {
    // Regression: `fromPaused` had no `arm` branch, so the second
    // press-and-hold of a take dispatched `arm` → `stt-ready` →
    // `chunk` and every one of them was a no-op. The microphone
    // recorded, the audio was transcribed by the server, and the
    // words were thrown away — the panel simply never changed.
    let s: VoiceSessionState = voiceSessionReducer({ tag: 'idle' }, { type: 'arm' });
    s = voiceSessionReducer(s, { type: 'stt-ready' });
    s = voiceSessionReducer(s, { type: 'chunk', chunk: finalChunk('первая фраза', 500) });
    s = voiceSessionReducer(s, { type: 'pause' });
    expect(s.tag).toBe('paused');

    s = voiceSessionReducer(s, { type: 'arm' });
    expect(s.tag).toBe('listening');
    if (s.tag !== 'listening') throw new Error('unreachable');
    // The whole point: what was already dictated survives.
    expect(s.transcript.final).toBe('первая фраза');

    // `stt-ready` still arrives from the orchestrator's start
    // sequence and must not clobber the resumed take.
    s = voiceSessionReducer(s, { type: 'stt-ready' });
    expect(s.tag).toBe('listening');
    if (s.tag !== 'listening') throw new Error('unreachable');
    expect(s.transcript.final).toBe('первая фраза');
  });

  it('a second utterance appends to the take rather than replacing it', () => {
    let s: VoiceSessionState = voiceSessionReducer({ tag: 'idle' }, { type: 'arm' });
    s = voiceSessionReducer(s, { type: 'stt-ready' });
    s = voiceSessionReducer(s, { type: 'chunk', chunk: finalChunk('сделай тише', 500) });
    s = voiceSessionReducer(s, { type: 'pause' });

    s = voiceSessionReducer(s, { type: 'arm' });
    s = voiceSessionReducer(s, {
      type: 'chunk',
      chunk: finalChunk('и добавь немного ритма', 900),
    });
    expect(s.tag).toBe('transcribing');
    if (s.tag !== 'transcribing') throw new Error('unreachable');
    expect(s.transcript.final).toBe('сделай тише и добавь немного ритма');
  });

  it('the continued take reaches review with both utterances in the buffer', () => {
    let s: VoiceSessionState = voiceSessionReducer({ tag: 'idle' }, { type: 'arm' });
    s = voiceSessionReducer(s, { type: 'stt-ready' });
    s = voiceSessionReducer(s, { type: 'chunk', chunk: finalChunk('сделай тише', 500) });
    s = voiceSessionReducer(s, { type: 'pause' });
    s = voiceSessionReducer(s, { type: 'arm' });
    s = voiceSessionReducer(s, {
      type: 'chunk',
      chunk: finalChunk('и добавь немного ритма', 900),
    });
    s = voiceSessionReducer(s, { type: 'enter-review' });
    expect(s.tag).toBe('review');
    if (s.tag !== 'review') throw new Error('unreachable');
    // One «→ В ИИ» then ships the whole take, not just the last
    // press. `send-review` reads exactly this buffer.
    expect(s.editedText).toBe('сделай тише и добавь немного ритма');
  });
});

describe('voiceSessionReducer — full press-and-talk flow', () => {
  it('drives idle → arming → listening → transcribing → requesting → applying → sent', () => {
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
    expect(final.tag).toBe('sent');
  });
});

describe('voiceSessionReducer — review-and-edit flow', () => {
  const seedTranscript = {
    chunks: [finalChunk('сделай побыстрее', 500)],
    interim: '',
    final: 'сделай побыстрее',
    startedAtMs: 100,
    stoppedAtMs: null,
    lang: 'ru-RU',
  } as const;

  it('listening + enter-review → review with editedText=transcript.final', () => {
    const start: VoiceSessionState = {
      tag: 'listening',
      transcript: seedTranscript,
      continuous: true,
    };
    const next = voiceSessionReducer(start, { type: 'enter-review' });
    expect(next.tag).toBe('review');
    if (next.tag !== 'review') throw new Error('unreachable');
    expect(next.editedText).toBe('сделай побыстрее');
    expect(next.transcript).toBe(seedTranscript);
  });

  it('transcribing + enter-review → review (same transcript, same edited seed)', () => {
    const start: VoiceSessionState = { tag: 'transcribing', transcript: seedTranscript };
    const next = voiceSessionReducer(start, { type: 'enter-review' });
    expect(next.tag).toBe('review');
    if (next.tag !== 'review') throw new Error('unreachable');
    expect(next.transcript).toBe(seedTranscript);
    expect(next.editedText).toBe('сделай побыстрее');
  });

  it('paused + enter-review → review', () => {
    const start: VoiceSessionState = { tag: 'paused', transcript: seedTranscript };
    const next = voiceSessionReducer(start, { type: 'enter-review' });
    expect(next.tag).toBe('review');
  });

  it('review + edit-review(text) → review with editedText=text', () => {
    const start: VoiceSessionState = {
      tag: 'review',
      transcript: seedTranscript,
      editedText: 'сделай побыстрее',
    };
    const next = voiceSessionReducer(start, {
      type: 'edit-review',
      text: 'сделай побыстрее и добавь свинг',
    });
    expect(next.tag).toBe('review');
    if (next.tag !== 'review') throw new Error('unreachable');
    expect(next.editedText).toBe('сделай побыстрее и добавь свинг');
  });

  it('review + edit-review(same) → unchanged reference (cheap eq)', () => {
    const start: VoiceSessionState = {
      tag: 'review',
      transcript: seedTranscript,
      editedText: 'foo',
    };
    const next = voiceSessionReducer(start, { type: 'edit-review', text: 'foo' });
    expect(next).toBe(start);
  });

  it('review + send-review(text) → requesting with transcript.final=text', () => {
    const start: VoiceSessionState = {
      tag: 'review',
      transcript: seedTranscript,
      editedText: 'побыстрее и со свингом',
    };
    const next = voiceSessionReducer(start, {
      type: 'send-review',
      text: 'побыстрее и со свингом',
    });
    expect(next.tag).toBe('requesting');
    if (next.tag !== 'requesting') throw new Error('unreachable');
    expect(next.transcript.final).toBe('побыстрее и со свингом');
    expect(next.continuous).toBe(false);
  });

  it('review + cancel-review → idle', () => {
    const start: VoiceSessionState = {
      tag: 'review',
      transcript: seedTranscript,
      editedText: 'anything',
    };
    const next = voiceSessionReducer(start, { type: 'cancel-review' });
    expect(next).toEqual({ tag: 'idle' });
  });

  it('review + arm → listening (resume dictation from where we left off)', () => {
    const start: VoiceSessionState = {
      tag: 'review',
      transcript: seedTranscript,
      editedText: 'edited',
    };
    const next = voiceSessionReducer(start, { type: 'arm' });
    expect(next.tag).toBe('listening');
    if (next.tag !== 'listening') throw new Error('unreachable');
    expect(next.continuous).toBe(true);
    expect(next.transcript).toBe(seedTranscript);
  });

  it('review + barge-in → idle', () => {
    const start: VoiceSessionState = {
      tag: 'review',
      transcript: seedTranscript,
      editedText: 'foo',
    };
    expect(voiceSessionReducer(start, { type: 'barge-in' })).toEqual({ tag: 'idle' });
  });
});

/**
 * Field report (2026-10-24): "I made the first composition, then
 * pressed the voice button again to edit it — the text was recognised
 * and there was no way to send it."
 *
 * Two independent holes, both of which end in "text on screen, no
 * send button".
 *
 * 1. `arm` was a no-op from `transcribing`, `requesting` and
 *    `applying`. `requesting`/`applying` cover the WHOLE LLM round
 *    trip — `runRoute` dispatches `request-sent` before it calls the
 *    LLM — so a press while the previous edit was still landing was
 *    swallowed whole: no microphone, no recording, no recognition, no
 *    error. The panel just kept saying «применяю правку…».
 *
 * 2. A take whose FINAL upload came back empty (whisper returns `""`
 *    for a clip it cannot make sense of) but whose INTERIM had text
 *    parked in `paused` — a state with no review form. The text was
 *    on screen and unsendable.
 */
describe('voiceSessionReducer — a press must always start a take', () => {
  const transcript = initialTranscriptState('ru-RU');

  it.each([
    ['transcribing', { tag: 'transcribing', transcript } as VoiceSessionState],
    ['requesting', { tag: 'requesting', transcript, continuous: false } as VoiceSessionState],
    ['applying', { tag: 'applying', transcript, score: 'note("c4")', continuous: false } as VoiceSessionState],
  ])('arm from %s starts listening instead of doing nothing', (_name, state) => {
    const next = voiceSessionReducer(state, { type: 'arm' });
    expect(next.tag).toBe('listening');
  });

  it('arm from applying does not lose the score the AI was applying', () => {
    // The route finishes on its own and dispatches `applied`; by then
    // the FSM is `listening`, where `applied` has no branch. That is
    // correct — the score was already handed to the editor by
    // `onApplied` — but the re-arm must not pretend the take
    // produced that score.
    const state: VoiceSessionState = {
      tag: 'applying', transcript, score: 'note("c4")', continuous: false,
    };
    const next = voiceSessionReducer(state, { type: 'arm' });
    expect(next.tag).toBe('listening');
    expect('score' in next).toBe(false);
  });
});

describe('voiceSessionReducer — a take with text is always sendable', () => {
  const base = initialTranscriptState('ru-RU');

  it('enter-review seeds the buffer from the interim when there is no final', () => {
    const interimOnly: TranscriptState = { ...base, interim: 'сделай бас быстрее' };
    const next = voiceSessionReducer(
      { tag: 'paused', transcript: interimOnly },
      { type: 'enter-review' },
    );
    expect(next.tag).toBe('review');
    if (next.tag !== 'review') throw new Error('unreachable');
    // Without this the review form opened EMPTY and the «→ В ИИ»
    // button stayed disabled: the text was visible and unsendable.
    expect(next.editedText).toBe('сделай бас быстрее');
  });

  it('enter-review prefers the final over the interim', () => {
    const both: TranscriptState = {
      ...base, interim: 'черновик', final: 'готовая фраза',
    };
    const next = voiceSessionReducer(
      { tag: 'paused', transcript: both },
      { type: 'enter-review' },
    );
    if (next.tag !== 'review') throw new Error('unreachable');
    expect(next.editedText).toBe('готовая фраза');
  });

  it('a final chunk landing on a parked take is not thrown away', () => {
    const next = voiceSessionReducer(
      { tag: 'paused', transcript: base },
      {
        type: 'chunk',
        chunk: {
          kind: 'final', text: 'опоздавшая фраза', confidence: 0.9,
          lang: 'ru-RU', timestampMs: 0,
        },
      },
    );
    // `transcribing` is where the subscriber's auto-review looks.
    expect(next.tag).toBe('transcribing');
    if (next.tag !== 'transcribing') throw new Error('unreachable');
    expect(next.transcript.final).toBe('опоздавшая фраза');
  });
});

/**
 * A press during `applying` / `requesting` must NOT carry the
 * already-sent instruction into the new take.
 *
 * The user sends an instruction, hears the composition, and says the
 * next one. The first instruction is already on its way to the LLM —
 * sending it again with the second one appended would apply it twice.
 */
describe('voiceSessionReducer — a press after the instruction was sent', () => {
  const sent = initialTranscriptState('ru-RU');

  it.each([
    ['requesting', { tag: 'requesting', transcript: { ...sent, final: 'сделай композицию' }, continuous: false } as VoiceSessionState],
    ['applying', { tag: 'applying', transcript: { ...sent, final: 'сделай композицию' }, score: 'note("c4")', continuous: false } as VoiceSessionState],
  ])('arm from %s starts with an empty buffer', (_name, state) => {
    const next = voiceSessionReducer(state, { type: 'arm' });
    expect(next.tag).toBe('listening');
    if (next.tag !== 'listening') throw new Error('unreachable');
    expect(next.transcript.final).toBe('');
    expect(next.transcript.interim).toBe('');
  });

  it('arm from review DOES carry the unsent buffer over', () => {
    // The opposite contract: `review` holds text the user has not
    // sent yet, so a press continues that take
    // (`decisions/wavecode-voice-take-continuation`).
    const state: VoiceSessionState = {
      tag: 'review',
      transcript: { ...sent, final: 'сделай композицию' },
      editedText: 'сделай композицию',
    };
    const next = voiceSessionReducer(state, { type: 'arm' });
    expect(next.tag).toBe('listening');
    if (next.tag !== 'listening') throw new Error('unreachable');
    expect(next.transcript.final).toBe('сделай композицию');
  });
});

/**
 * The unsent/sent distinction, spelled out for the one state that
 * keeps it: `transcribing` holds a final chunk the user has NOT
 * confirmed yet, so a press continues that take.
 */
describe('voiceSessionReducer — an unsent buffer survives a press', () => {
  it('arm from transcribing keeps the transcript', () => {
    const transcript = { ...initialTranscriptState('ru-RU'), final: 'сделай композицию' };
    const next = voiceSessionReducer(
      { tag: 'transcribing', transcript },
      { type: 'arm' },
    );
    expect(next.tag).toBe('listening');
    if (next.tag !== 'listening') throw new Error('unreachable');
    expect(next.transcript.final).toBe('сделай композицию');
  });
});

/**
 * `dismiss` is the panel's ✕ — «закрой и забудь». It has to work in
 * EVERY active state.
 *
 * Before the composer UX the reducer only honoured it from `paused`
 * and `errored`, so pressing ✕ while recording released the mic and
 * dropped the take — and left the FSM pinned in `listening`. The
 * panel went on counting seconds for a session that no longer
 * existed, and the only way out was the FAB (which then started a
 * take nobody asked for). That is the «отменить непонятно как»
 * report.
 */
describe('voiceSessionReducer — dismiss is a wildcard', () => {
  const transcript = { ...initialTranscriptState('ru-RU'), final: 'сделай потише' };

  it.each([
    ['arming', { tag: 'arming' } as VoiceSessionState],
    ['listening', { tag: 'listening', transcript, continuous: true } as VoiceSessionState],
    ['transcribing', { tag: 'transcribing', transcript } as VoiceSessionState],
    ['requesting', { tag: 'requesting', transcript, continuous: false } as VoiceSessionState],
    ['applying', { tag: 'applying', transcript, score: 'note("c4")', continuous: false } as VoiceSessionState],
    ['paused', { tag: 'paused', transcript } as VoiceSessionState],
    ['review', { tag: 'review', transcript, editedText: 'сделай потише' } as VoiceSessionState],
    ['sent', { tag: 'sent', transcript, editedText: 'сделай потише' } as VoiceSessionState],
    ['errored', { tag: 'errored', error: 'boom', transcript } as VoiceSessionState],
  ])('dismiss from %s → idle', (_name, state) => {
    expect(voiceSessionReducer(state, { type: 'dismiss' })).toEqual({ tag: 'idle' });
  });

  it('dismiss from idle stays idle', () => {
    expect(voiceSessionReducer(initialVoiceSession(), { type: 'dismiss' }))
      .toEqual({ tag: 'idle' });
  });
});

/**
 * «Отменить отправку» — the user pulls the plug while the request is
 * on the wire. The text goes back into the form, untouched, so the
 * next attempt is one word away.
 */
describe('voiceSessionReducer — cancel-send', () => {
  const transcript = { ...initialTranscriptState('ru-RU'), final: 'сделай потише' };

  it('cancel-send from requesting → review with the text intact', () => {
    const next = voiceSessionReducer(
      { tag: 'requesting', transcript, continuous: false },
      { type: 'cancel-send' },
    );
    expect(next.tag).toBe('review');
    if (next.tag !== 'review') throw new Error('unreachable');
    expect(next.editedText).toBe('сделай потише');
    expect(next.transcript.final).toBe('сделай потише');
  });

  it('cancel-send from applying → review with the text intact', () => {
    const next = voiceSessionReducer(
      { tag: 'applying', transcript, score: 'note("c4")', continuous: false },
      { type: 'cancel-send' },
    );
    expect(next.tag).toBe('review');
    if (next.tag !== 'review') throw new Error('unreachable');
    expect(next.editedText).toBe('сделай потише');
  });

  it('cancel-send from review is a no-op (nothing is in flight)', () => {
    const start: VoiceSessionState = {
      tag: 'review',
      transcript,
      editedText: 'сделай потише',
    };
    expect(voiceSessionReducer(start, { type: 'cancel-send' })).toBe(start);
  });
});

/**
 * `sent` — the instruction reached the LLM and the score was written.
 * The buffer is still the user's: it can be edited and sent again.
 */
describe('voiceSessionReducer — the sent state', () => {
  const transcript = { ...initialTranscriptState('ru-RU'), final: 'сделай потише' };

  it('send-review from sent → requesting (the re-send)', () => {
    const next = voiceSessionReducer(
      { tag: 'sent', transcript, editedText: 'сделай потише' },
      { type: 'send-review', text: 'сделай потише и добавь ритма' },
    );
    expect(next.tag).toBe('requesting');
    if (next.tag !== 'requesting') throw new Error('unreachable');
    expect(next.transcript.final).toBe('сделай потише и добавь ритма');
  });

  it('arm from sent starts a FRESH take (the instruction is already in the score)', () => {
    const next = voiceSessionReducer(
      { tag: 'sent', transcript, editedText: 'сделай потише' },
      { type: 'arm' },
    );
    expect(next.tag).toBe('listening');
    if (next.tag !== 'listening') throw new Error('unreachable');
    expect(next.transcript.final).toBe('');
  });

  it('edit-review from sent keeps the state and updates the buffer', () => {
    const next = voiceSessionReducer(
      { tag: 'sent', transcript, editedText: 'сделай потише' },
      { type: 'edit-review', text: 'сделай потише' },
    );
    expect(next.tag).toBe('sent');
  });
});
