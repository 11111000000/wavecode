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
  // Минимальный pattern, гарантированно играющий в браузере:
  // - `note("c4")` создаёт constant pattern (без mini-notation парсинга)
  // - `.s("sine")` использует встроенный OscillatorNode
  // - `.gain(0.3)` — небольшая громкость чтобы избежать clipping
  score:
    '// Welcome to wavecode!\n' +
    '// note("c4") = статичная нота без mini-notation парсинга.\n' +
    'note("c4").s("sine").gain(0.3)',
  messages: [],
  agent: { status: 'idle' },
  audio: { status: 'stopped' },
};