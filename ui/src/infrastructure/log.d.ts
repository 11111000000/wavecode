/**
 * Stub declarations for `~/infrastructure/log`.
 *
 * The real module is provided by Subagent 1 (PR `feat/log-pipeline`).
 * This file exists so ConsoleSheet's dynamic `import()` type-checks
 * before that PR lands, and so consumers can rely on the public types
 * (logger, MAX_LOG_ENTRIES, LogLevel, LogEntry, LogSink) defined by
 * the unified module.
 *
 * Когда Subagent 1 мерджится, реальный `infrastructure/log/logger.ts`
 * соответствует этому контракту; дальнейшие изменения — синхронизировать
 * с ним.
 */

declare module '~/infrastructure/log' {
  export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

  export type LogEntry = {
    readonly id: number;
    readonly level: LogLevel;
    readonly text: string;
    readonly args: readonly unknown[];
    readonly source: string;
    readonly ts: number;
  };

  export type LogSink = (entry: LogEntry) => void;

  export const MAX_LOG_ENTRIES: number;

  export const logger: {
    install(): void;
    setSink(sink: LogSink | null): void;
    getBuffer(): readonly LogEntry[];
    clear(): void;
    push(
      level: LogLevel,
      args: readonly unknown[],
      source?: string,
    ): void;
  };

  export function cleanLogArgs(args: readonly unknown[]): unknown[];
}
