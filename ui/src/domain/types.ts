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
  // Creep (Radiohead) — reggae-inspired drone.
  // МИНИМАЛЬНАЯ рабочая версия — одиночные ноты без chord/multi-pattern,
  // чтобы избежать IndexSizeError в superdough (partials.length < 2 → ошибка
  // createPeriodicWave).
  // AI правка через REPL может развить это в полный Creep с chord'ами.
  score: [
    '// Creep (Radiohead) — minimal reggae drone',
    '// Простая нота — AI правка через REPL может развить в полный Creep',
    'n("43").s("triangle").lpf(200).gain(0.3).slow(4)',
  ].join('\n'),
  messages: [],
  agent: { status: 'idle' },
  audio: { status: 'stopped' },
};