declare module '@strudel/webaudio' {
  export function webaudioOutput(pattern: unknown, ...rest: unknown[]): unknown;
  export function webaudioRepl(code: string): Promise<unknown>;
  export function hush(): void;
  export const doughsamples: unknown;
}

declare module '@strudel/core' {
  export const Pattern: unknown;
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