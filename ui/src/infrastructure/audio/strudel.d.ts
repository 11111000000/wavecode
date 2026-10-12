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
  export async function samples(
    sampleMap: string | Record<string, unknown>,
    baseUrl?: string,
    options?: Record<string, unknown>,
  ): Promise<void>;
  export async function fetchSampleMap(url: string): Promise<[Record<string, unknown>, string] | undefined>;
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

  // Re-exported from superdough via `export * from "superdough"`.
  export async function samples(
    sampleMap: string | Record<string, unknown>,
    baseUrl?: string,
    options?: Record<string, unknown>,
  ): Promise<void>;
  export async function fetchSampleMap(url: string): Promise<[Record<string, unknown>, string] | undefined>;
  // nanostores map. .get() returns the current snapshot; .set(...)
  // publishes a new snapshot (mutating in place is no-op).
  export const soundMap: {
    get(): Record<string, { onTrigger: unknown; data: unknown }>;
    set(value: Record<string, { onTrigger: unknown; data: unknown }>): void;
  };
  // Eager preload: populate superdough's internal `tt[url]` cache
  // with the AudioBuffer promise so the first haps don't lose the
  // audio-context-race against the decoder. Used by SampleLoader.
  export function loadBuffer(
    url: string,
    audioContext: AudioContext,
    label?: string,
    index?: number,
  ): Promise<AudioBuffer>;
  export function getAudioContext(): AudioContext;
}
