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

export type LayerMix = {
  readonly layerIndex: number;
  /** 0..1.5 amplitude scalar applied via .gain() */
  readonly gain: number;
  readonly muted: boolean;
  readonly soloed: boolean;
};

export const makeLayerMix = (index: number): LayerMix => ({
  layerIndex: index,
  gain: 1,
  muted: false,
  soloed: false,
});

export type TransportState = {
  readonly cps: number;
  /** 0..1 swing amount; 0 = off. */
  readonly swingAmount: number;
  /** Strudel `.swing(amount, divisor)` divisor; common: '1/4', '1/8', '1/16', '1/3'. */
  readonly swingDivisor: string;
};

export type AppState = {
  readonly score: Score;
  readonly history: ReadonlyArray<Score>;
  readonly future: ReadonlyArray<Score>;
  readonly messages: ReadonlyArray<Message>;
  readonly agent: { readonly status: AgentStatus; readonly lastError?: string };
  readonly audio: { readonly status: AudioStatus; readonly lastError?: string };
  /** Side-state: mixer tracks for the top-level stack of `score`.
   *  Length is reconciled to actual stack size on every `audio.eval`. */
  readonly layerMix: ReadonlyArray<LayerMix>;
  readonly transportState: TransportState;
};

export const HISTORY_LIMIT = 50;

export const initialAppState: AppState = {
  // Дефолтный score при первом запуске (IDB пуст).
  // Creep (Radiohead) — без .slow(2): 1 cycle = 2 sec на cps=0.5,
  // chord changes по 0.5 сек = 120 BPM.
  score: [
    '// Creep (Radiohead) — G → B → C → Cm, indie-rock 4/4',
    'stack(',
    '  note("<g2 b2 c3 c3>").s("sawtooth").gain(0.4).lpf(300),',
    '  note("<[55,59,62] [59,63,66] [60,64,67] [60,63,67]>").s("triangle").gain(0.2).lpf(1500),',
    '  n("<55 67 59 67 62 67 59 67>*2").s("sawtooth").gain(0.12).lpf(1500),',
    '  s("bd ~ sbd ~").gain(0.5),',
    '  s("~ white ~ white").decay(.05).sustain(0).gain(0.22),',
    '  s("white*8").decay(.04).sustain(0).gain(0.15)',
    ')',
  ].join('\n'),
  history: [],
  future: [],
  messages: [],
  agent: { status: 'idle' },
  audio: { status: 'stopped' },
  layerMix: [],
  transportState: { cps: 0.5, swingAmount: 0, swingDivisor: '1/8' },
};
