/**
 * exportMidi: snippet → MIDI bytes (Uint8Array).
 *
 * Pipeline:
 *   snippet (string)
 *     → transpiler.evaluate(snippet)   [compile-only, no AudioContext]
 *     → Pattern.queryArc(0, cycles)   [Hap[] over N cycles]
 *     → extractNotes(hap)             [NoteEvent[] — flat structure]
 *     → hapsToSequence(events, opts)  [MIDISequence]
 *     → writeSmi(seq)                 [Uint8Array]
 *
 * Layer в `application/`, может использовать @strudel/* (lint-rules
 * разрешают). AudioEngine не расширяется.
 */

import { Effect } from 'effect';
import * as transpiler from '@strudel/transpiler';
import * as core from '@strudel/core';
import { hapsToSequence, type NoteEvent } from '~/domain/midi/encoder';
import { writeSmi } from '~/domain/midi/codec';
import type { MIDIExportOptions, MIDIExportResult } from '~/domain/midi/types';

const DEFAULT_VELOCITY = 100;

const isFiniteFraction = (v: unknown): v is { valueOf: () => number } =>
  typeof v === 'object' && v !== null && typeof (v as { valueOf?: unknown }).valueOf === 'function';

const fractionToNumber = (f: unknown): number => {
  if (typeof f === 'number') return f;
  if (isFiniteFraction(f)) return Number((f as { valueOf: () => number }).valueOf());
  return NaN;
};

const velocityFromContext = (ctx: unknown): number => {
  if (typeof ctx !== 'object' || ctx === null) return DEFAULT_VELOCITY;
  const gain = (ctx as { gain?: unknown }).gain;
  if (typeof gain === 'number') return Math.round(Math.max(0, Math.min(1, gain)) * 127);
  return DEFAULT_VELOCITY;
};

const channelFromContext = (ctx: unknown): number => {
  if (typeof ctx !== 'object' || ctx === null) return 1;
  const ch = (ctx as { channel?: unknown }).channel;
  if (typeof ch === 'number' && ch >= 1 && ch <= 16) return ch;
  return 1;
};

const extractEventsFromHap = (hap: unknown, accumulator: NoteEvent[]): void => {
  const h = hap as {
    whole?: { begin?: unknown };
    duration?: unknown;
    value?: unknown;
    context?: unknown;
    hasOnset?: () => boolean;
  };
  if (h.hasOnset && !h.hasOnset()) return;

  const value = h.value;
  if (value === undefined || value === null) return;

  const begin = fractionToNumber(h.whole?.begin);
  const dur = h.duration !== undefined ? fractionToNumber(h.duration) : 0.25;
  if (!Number.isFinite(begin) || !Number.isFinite(dur) || dur <= 0) return;

  const velocity = velocityFromContext(h.context);
  const channel = channelFromContext(h.context);

  const pushNote = (midi: number): void => {
    if (!Number.isFinite(midi)) return;
    accumulator.push({
      midi,
      startCycle: begin,
      endCycle: begin + dur,
      velocity,
      channel,
    });
  };

  try {
    const freq = (core as { getFrequency?: (h: unknown) => unknown }).getFrequency?.(hap);
    if (typeof freq === 'number' && Number.isFinite(freq) && freq > 0) {
      const midi = Math.round(12 * Math.log2(freq / 440) + 69);
      pushNote(midi);
      return;
    }
  } catch {
    /* fallthrough */
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    pushNote(value);
  }
};

export const exportMidi = (
  snippet: string,
  opts: MIDIExportOptions,
): Effect.Effect<MIDIExportResult, never, never> =>
  Effect.sync((): MIDIExportResult => {
    const warnings: string[] = [];
    try {
      const ev = (transpiler as { evaluate?: (s: string, opts?: object) => unknown }).evaluate;
      if (!ev) {
        return { ok: false, error: '@strudel/transpiler.evaluate недоступен' };
      }
      const pattern = ev(snippet, { nanFallback: 0 });
      const cycles = Math.max(1, Math.min(32, opts.cycles | 0));
      const haps = (pattern as unknown as { queryArc: (a: number, b: number) => unknown[] }).queryArc(0, cycles);

      const events: NoteEvent[] = [];
      let sLayers = 0;
      for (const hap of haps) {
        const v = (hap as { value?: unknown }).value;
        if (typeof v === 'string' && !/^[a-gA-G][#b]?\d+?$/.test(v)) {
          if (/^d(s|hh|bd|cp|crash|ride|ohh|tom|perc|white|pink|brown|sawtooth|triangle|sine)/.test(v)) {
            sLayers++;
            continue;
          }
        }
        extractEventsFromHap(hap, events);
      }
      if (sLayers > 0) {
        warnings.push(`${sLayers} сэмпловых слоёв пропущены (нет pitch)`);
      }

      const { seq, warnings: encWarnings } = hapsToSequence(events, opts);
      warnings.push(...encWarnings);

      const bytes = writeSmi(seq);
      return { ok: true, bytes, warnings };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });