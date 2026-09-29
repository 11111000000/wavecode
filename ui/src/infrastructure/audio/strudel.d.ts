declare module '@strudel/webaudio' {
  type ReplOptions = {
    audioContext?: AudioContext;
    getTime?: () => number;
    defaultOutput?: unknown;
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
