/**
 * Domain types: чистые данные, никаких эффектов.
 * Это контракт между всеми слоями — изменение здесь затрагивает всё.
 */

export type Score = string;

export type Role = 'user' | 'assistant' | 'system';

export type Message = {
  readonly id: string;
  readonly role: Role;
  readonly content: string;
  readonly ts: number;
};

export type AgentStatus = 'idle' | 'streaming' | 'awaiting-tool' | 'error';

export type AudioStatus = 'stopped' | 'playing' | 'error';

export type AppState = {
  readonly score: Score;
  readonly messages: ReadonlyArray<Message>;
  readonly agent: { readonly status: AgentStatus; readonly lastError?: string };
  readonly audio: { readonly status: AudioStatus; readonly lastError?: string };
};

export const initialAppState: AppState = {
  // Creep (Radiohead) — chord progression G → B → C → Cm + bass + synth drum.
  // sbd = synthesized bass drum (работает без sample loading).
  // stack(...) — параллельные дорожки (bass + chords + drums).
  // .slow(2) — каждый шаг 1 секунда, цикл 4 секунды.
  score: [
    '// Creep (Radiohead) — G → B → C → Cm + bass + beat',
    'stack(',
    '  note("<g2 b2 c3 c3>").s("sawtooth").gain(0.35).lpf(400),',
    '  note("<[55,59,62] [59,63,66] [60,64,67] [60,63,67]>").s("sawtooth").gain(0.25).lpf(1500),',
    '  s("sbd*4").gain(0.5)',
    ').slow(2)',
  ].join('\n'),
  messages: [],
  agent: { status: 'idle' },
  audio: { status: 'stopped' },
};