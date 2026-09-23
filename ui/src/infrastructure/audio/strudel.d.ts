declare module '@strudel/webaudio' {
  export function webaudioRepl(code: string): Promise<unknown>;
  export function webaudioOutput(pattern: unknown): unknown;
  export function hush(): void;
  export const doughsamples: unknown;
}