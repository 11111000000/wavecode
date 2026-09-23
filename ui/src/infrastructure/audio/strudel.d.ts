declare module '@strudel/webaudio' {
  export function evalScope(code: string, evalFn?: unknown): Promise<unknown>;
  export const webaudio: unknown;
  export function hush(): void;
}