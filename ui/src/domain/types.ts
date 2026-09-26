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
  // Creep (Radiohead) — простая прогрессия аккордов G→B→C→Cm.
  // Использует только n("...").s(...).gain(...).lpf(...) — наш LiveAudioEngine
  // сам парсит regex'ом и играет через OscillatorNode (минует superdough bug).
  // Без stack/slow — чтобы избежать проблем с transpiler.
  score: [
    '// Creep (Radiohead) — G → B → C → Cm аккорды',
    'n("55 59 62").s("sawtooth").gain(0.5).lpf(800),',
    'n("59 62 66").s("sawtooth").gain(0.5).lpf(800),',
    'n("60 64 67").s("sawtooth").gain(0.5).lpf(800),',
    'n("60 63 67").s("sawtooth").gain(0.5).lpf(800)',
  ].join('\n'),
  messages: [],
  agent: { status: 'idle' },
  audio: { status: 'stopped' },
};