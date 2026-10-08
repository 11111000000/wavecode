declare module '@strudel/core' {
  export function evalScope(...modules: ReadonlyArray<Record<string, unknown>>): Promise<ReadonlyArray<Record<string, unknown>>>;
}

declare module 'superdough' {
  export const superdough: (
    value: unknown,
    t: number,
    hapDuration: number,
    cps?: number,
    cycle?: number,
  ) => Promise<unknown>;
  export function setAudioContext(ctx: AudioContext | null): void;
  export function getAudioContext(): AudioContext;
  export function getSuperdoughAudioController(): unknown;
  export function setSuperdoughAudioController(ctrl: unknown): void;
  export function registerSynthSounds(): void;
  export async function initAudio(options?: Record<string, unknown>): Promise<void>;
  export async function initAudioOnFirstClick(options?: Record<string, unknown>): Promise<void>;
}

declare module 'superdough/superdoughoutput.mjs' {
  export class SuperdoughAudioController {
    constructor(audioContext: AudioContext);
    audioContext: unknown;
    output: { destinationGain: AudioNode | null; channelMerger: unknown };
    nodes: Record<string, unknown>;
    buses: Record<string, unknown>;
    reset(): void;
  }
}

declare module '@strudel/mini' {
  export const mini: unknown;
  export const minify: unknown;
  export const parse: unknown;
}

declare module '@strudel/tonal' {
  export const voicing: unknown;
}

declare module '@strudel/transpiler' {
  export const transpiler: (code: string, transpiler: unknown) => { output: string; [k: string]: unknown };
}

declare module '@strudel/webaudio' {
  type ReplOptions = {
    audioContext?: AudioContext;
    getTime?: () => number;
    defaultOutput?: unknown;
    transpiler?: (code: string, transpiler: unknown) => { output: string; [k: string]: unknown };
  };

  export function webaudioRepl(options?: ReplOptions): {
    evaluate: (code: string) => Promise<unknown>;
    start: () => void;
    stop: () => void;
    pause: () => void;
    toggle: () => void;
    setCps: (cps: number) => void;
    setPattern: (pattern: unknown, autostart?: boolean) => Promise<void>;
    scheduler: unknown;
    state: unknown;
  };
}
