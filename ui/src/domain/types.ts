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
  // Creep (Radiohead) — chord progression G → Bm → C → Cm at ~92 BPM.
  // Uses Strudel mini-notation: stack of bass + arpeggios + drums.
  score: [
    '// Creep (Radiohead) — G → Bm → C → Cm, ~92 BPM',
    'stack(',
    '  note("<g2 b2 c3 c3>*2").s("sawtooth").gain(0.35).lpf(400).decay(0.4),',
    '  n("<[55,59,62]*2 [59,63,66]*2 [60,64,67]*2 [60,63,67]*2>").s("sawtooth").gain(0.18).lpf(1800),',
    '  s("bd*4, ~ sd ~ sd, hh*8").gain(0.45)',
    ').slow(2)',
  ].join('\n'),
  messages: [],
  agent: { status: 'idle' },
  audio: { status: 'stopped' },
};