declare module '@strudel/webaudio' {
  // webaudioOutput(hap, _t, currentTime, duration, cps) — arg 2 unused at runtime.
  // We type _t as `any` so TS accepts any value (Cyclist passes undefined).
  export function webaudioOutput(
    hap: unknown,
    _t: any,
    currentTime: number,
    duration: number,
    cps: number,
  ): unknown;
  export function webaudioRepl(code: string): Promise<unknown>;
  export function hush(): void;
  export const doughsamples: unknown;
}

declare module '@strudel/core' {
  export class Pattern {
    constructor(...args: unknown[]);
  }
  export function evaluate(
    code: string,
    transp?: unknown,
  ): Promise<{ pattern?: unknown; meta?: unknown }>;
  export class Cyclist {
    constructor(config: {
      interval: number;
      onTrigger: (hap: unknown, currentTime: number, cps: number, duration: number, ...rest: unknown[]) => unknown;
      onToggle?: (started: boolean) => void;
      onError?: (err: unknown) => void;
      getTime: () => number;
      latency?: number;
      setInterval: (cb: () => void, ms: number) => unknown;
      clearInterval: (handle: unknown) => void;
      beforeStart?: () => Promise<void> | void;
    });
    setPattern(pattern: unknown, autostart: boolean): Promise<void>;
    start(): Promise<void>;
    pause(): void;
    stop(): void;
    setCps(cps: number): void;
  }
  export function sequence(...args: unknown[]): unknown;
  export function stack(...args: unknown[]): unknown;
  export function slow(...args: unknown[]): unknown;
  export function n(...args: unknown[]): unknown;
  export function s(...args: unknown[]): unknown;
  export function gain(...args: unknown[]): unknown;
  export function lpf(...args: unknown[]): unknown;
}

declare module '@strudel/mini' {
  export const mini: unknown;
}

declare module '@strudel/tonal' {
  export const tonal: unknown;
}

declare module 'superdough' {
  export function registerSynthSounds(): void;
  export function registerSound(name: string, factory: unknown): void;
}