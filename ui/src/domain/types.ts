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
  // Без dirt-samples (не загружены). Используем синусоиду через n()+s("sine")
  // — встроенный oscillator, не требует createPeriodicWave.
  score:
    '// Welcome to wavecode!\n' +
    '// Sine oscillator через n() + s("sine") — работает без dirt-samples.\n' +
    'stack(\n' +
    '  n("0 ~ 2 ~ 4 0 ~ 3").s("sine").gain(0.3),\n' +
    '  n("4 ~ 2 ~ 0 3 ~ 0").s("sine").gain(0.2).add(7)\n' +
    ').slow(2);',
  messages: [],
  agent: { status: 'idle' },
  audio: { status: 'stopped' },
};