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
  // Без dirt-samples (не загружены). Используем чистый синтез через n()+s(synth).
  // s("sawtooth"/"square"/"triangle"/"sine") — встроенные осцилляторы Strudel,
  // работают без samples.
  score:
    '// Welcome to wavecode!\n' +
    '// Используем синтез (n + sawtooth), samples не подгружены.\n' +
    'stack(\n' +
    '  n("0 ~ 0 ~ 0 3 ~ 4").s("sawtooth").gain(0.3),\n' +
    '  n("0 ~ 2 ~ 1 ~ 0 ~ 2").s("square").gain(0.2).lpf(800)\n' +
    ').slow(2);',
  messages: [],
  agent: { status: 'idle' },
  audio: { status: 'stopped' },
};