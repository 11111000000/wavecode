/* <reference types="solid-js" /> */
/**
 * Admin — debug inspector route mounted at `#/admin`.
 *
 * Pure read-only view of internal state for development debugging.
 * Each section is a `<details open>` with summary (title + count
 * badge) and body (data display). Polls the logger buffer,
 * AudioContext state, sample-load progress, and piano snapshot at
 * 4Hz; one-shot IDB load via `logger.loadPersistedErrors()`.
 *
 * Routing
 * --------
 * Mounted by `App.tsx` from a tiny in-house hash router that reads
 * `window.location.hash`. Available at `#/admin`. Editor stays at
 * `#/app`; landing at `#/` (or empty hash) keeps the editor visible
 * (no landing page exists in this revision — it was reverted after
 * 0e048a7 — so `/` falls back to the editor, which is the same UX
 * as before this PR).
 *
 * Sections
 * --------
 *   1. Logger ring buffer  — live entries with level/source/ts/text.
 *   2. Console store        — current toasts + unreadErrors + consoleOpen.
 *   3. Persisted errors     — last-100 error/fatal slice from IDB; clear.
 *   4. Audio context        — state / sampleRate / currentTime polled @4Hz.
 *   5. Sample cache         — per-bank loaded/total via
 *                             SampleLoader.getSampleLoadProgress().
 *   6. Piano                — placeholder for live piano (Subagent 14).
 *
 * No side-effects beyond reading state + starting a single 250ms
 * interval. Safe to mount/unmount repeatedly.
 */
import {
  For, Show, createSignal, onMount, onCleanup, type JSX, type Component,
} from 'solid-js';
import {
  logger,
  clearPersistedErrors,
  type LogLevel,
  type LogEntry,
} from '~/infrastructure/log';
import { consoleStore } from '~/presentation/components/consoleStore';
import { getSampleLoadProgress, type SampleLoadProgress } from '~/infrastructure/audio/SampleLoader';
import './admin.css';

const SAMPLE_BANKS: ReadonlyArray<'piano' | 'drums' | 'synth'> = [
  'piano', 'drums', 'synth',
];

const LEVELS: ReadonlyArray<LogLevel> = ['debug', 'info', 'warn', 'error', 'fatal'];

type Filter = {
  readonly level: 'all' | LogLevel;
  readonly source: 'all' | string;
};

type AudioState = {
  readonly state: AudioContextState | 'none';
  readonly sampleRate: number | null;
  readonly currentTime: number;
};

type PianoSnapshot = {
  readonly active: number;
  readonly source: string | null;
};

const formatTime = (ts: number): string => {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
};

const readAudioContext = (): AudioState => {
  const ac = (window as unknown as {
    __wavecodeAudioCtx?: AudioContext;
  }).__wavecodeAudioCtx;
  if (!ac) return { state: 'none', sampleRate: null, currentTime: 0 };
  return { state: ac.state, sampleRate: ac.sampleRate, currentTime: ac.currentTime };
};

const readPiano = (): PianoSnapshot => {
  const p = (window as unknown as {
    __wavecodePiano?: { active?: number; source?: string | null };
  }).__wavecodePiano;
  if (!p) return { active: 0, source: null };
  return {
    active: typeof p.active === 'number' ? p.active : 0,
    source: typeof p.source === 'string' || p.source === null ? p.source : null,
  };
};

const Admin: Component = () => {
  const [buffer, setBuffer] = createSignal<readonly LogEntry[]>([]);
  const [persisted, setPersisted] = createSignal<readonly LogEntry[]>([]);
  const [audioState, setAudioState] = createSignal<AudioState>(readAudioContext());
  const [sampleProgress, setSampleProgress] = createSignal<SampleLoadProgress>(
    getSampleLoadProgress(),
  );
  const [piano, setPiano] = createSignal<PianoSnapshot>(readPiano());
  const [filter, setFilter] = createSignal<Filter>({ level: 'all', source: 'all' });

  const uniqueSources = (): readonly string[] => {
    const out = new Set<string>();
    for (const e of buffer()) out.add(e.source);
    return Array.from(out).sort();
  };

  const filteredBuffer = (): readonly LogEntry[] => {
    const f = filter();
    const lvl = f.level;
    const src = f.source;
    return buffer().filter((e) => {
      if (lvl !== 'all' && e.level !== lvl) return false;
      if (src !== 'all' && e.source !== src) return false;
      return true;
    });
  };

  onMount(() => {
    // Load persisted slice once. We re-fetch after Clear button so
    // the panel reflects the deletion without waiting for the next
    // error-level push.
    void logger.loadPersistedErrors().then(setPersisted);

    // Poll buffer + audio + samples + piano @4Hz. createMemo is
    // overkill — a signal set every 250ms re-renders the section
    // cheaply. We poll instead of using logger.setSink because
    // ConsoleSheet registers its own sink at module load — Admin
    // would otherwise silence it on every /app → /admin → /app
    // detour (and we can't restore it without modifying
    // ConsoleSheet or logger — both out of scope for this commit).
    // 4Hz is fast enough for debugging UX and keeps buffer copies
    // bounded (4 × ~500 entries/s = 2k ops/s worst case).
    setBuffer(logger.getBuffer());
    const audioId = window.setInterval(() => {
      setBuffer(logger.getBuffer());
      setAudioState(readAudioContext());
      setSampleProgress(getSampleLoadProgress());
      setPiano(readPiano());
    }, 250);

    onCleanup(() => {
      window.clearInterval(audioId);
    });
  });

  const refreshPersisted = async (): Promise<void> => {
    const next = await logger.loadPersistedErrors();
    setPersisted(next);
  };

  const onClearPersisted = async (): Promise<void> => {
    await clearPersistedErrors();
    await refreshPersisted();
  };

  return (
    <div class="admin-page" data-testid="admin-page">
      <header class="admin-header">
        <h1 class="admin-title">wavecode <span class="admin-title-sub">/admin</span></h1>
        <p class="admin-sub">
          Debug inspector — read-only view of internal state.
        </p>
        <nav class="admin-nav">
          <a class="admin-nav-link" href="#/app">← /app</a>
          <a class="admin-nav-link" href="#/">← /</a>
        </nav>
      </header>

      <Section id="logger" title="Logger ring buffer" count={filteredBuffer().length}>
        <FilterBar
          filter={filter()}
          sources={uniqueSources()}
          onChange={(next) => setFilter(next)}
        />
        <ul class="admin-log-list" data-testid="logger-list">
          <Show
            when={filteredBuffer().length > 0}
            fallback={
              <li class="admin-empty">No log entries match the filter.</li>
            }
          >
            <For each={filteredBuffer()}>
              {(e) => <LogEntryRow entry={e} />}
            </For>
          </Show>
        </ul>
      </Section>

      <Section id="console" title="Console store" count={consoleStore.toasts().length}>
        <KeyValue
          rows={[
            { k: 'toasts', v: String(consoleStore.toasts().length) },
            { k: 'unreadErrors', v: String(consoleStore.unreadErrors()) },
            { k: 'consoleOpen', v: consoleStore.consoleOpen() ? 'true' : 'false' },
          ]}
        />
        <Show when={consoleStore.toasts().length > 0}>
          <ul class="admin-toast-list" data-testid="console-toast-list">
            <For each={consoleStore.toasts()}>
              {(t) => (
                <li class="admin-toast" data-severity={t.severity}>
                  <span class={`admin-toast-sev admin-toast-sev-${t.severity}`}>
                    {t.severity}
                  </span>
                  <span class="admin-toast-title">{t.title}</span>
                  <Show when={t.body}>
                      <span class="admin-toast-body">{t.body}</span>
                    </Show>
                  <span class="admin-toast-ts">{formatTime(t.createdAt)}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Section>

      <Section
        id="persisted"
        title="Persisted errors (IDB)"
        count={persisted().length}
      >
        <div class="admin-actions">
          <button
            type="button"
            class="wc-btn"
            data-size="sm"
            data-tone="ghost"
            data-testid="persisted-clear-btn"
            onClick={() => { void onClearPersisted(); }}
          >
            Clear
          </button>
          <button
            type="button"
            class="wc-btn"
            data-size="sm"
            data-tone="ghost"
            data-testid="persisted-refresh-btn"
            onClick={() => { void refreshPersisted(); }}
          >
            Refresh
          </button>
        </div>
        <ul class="admin-log-list" data-testid="persisted-list">
          <Show
            when={persisted().length > 0}
            fallback={
              <li class="admin-empty">
                No persisted errors. Errors above `warn` level are auto-saved.
              </li>
            }
          >
            <For each={persisted()}>
              {(e) => <LogEntryRow entry={e} />}
            </For>
          </Show>
        </ul>
      </Section>

      <Section id="audio" title="Audio context" count={audioState().state === 'none' ? 0 : 1}>
        <KeyValue
          rows={[
            { k: 'state', v: audioState().state },
            { k: 'sampleRate', v: audioState().sampleRate?.toString() ?? '—' },
            { k: 'currentTime', v: `${audioState().currentTime.toFixed(3)}s` },
          ]}
        />
        <p class="admin-hint">
          Polled at 4Hz. `none` means AudioContext is not yet created
          (unlockAudioContext runs on first Play).
        </p>
      </Section>

      <Section id="samples" title="Sample cache" count={sampleProgress().total}>
        <div class="admin-bank-grid" data-testid="sample-bank-grid">
          <For each={SAMPLE_BANKS}>
            {(bank) => {
              const stat = (): { loaded: number; total: number } =>
                sampleProgress().perBank[bank];
              return (
                <div class="admin-bank">
                  <span class="admin-bank-name">{bank}</span>
                  <span class="admin-bank-count">
                    {stat().loaded}/{stat().total}
                  </span>
                  <progress
                    class="sample-progress-bar admin-bank-progress"
                    max={Math.max(stat().total, 1)}
                    value={stat().loaded}
                  />
                </div>
              );
            }}
          </For>
        </div>
        <KeyValue
          rows={[
            { k: 'total loaded', v: String(sampleProgress().loaded) },
            { k: 'total expected', v: String(sampleProgress().total) },
          ]}
        />
      </Section>

      <Section id="piano" title="Piano state" count={piano().active}>
        <KeyValue
          rows={[
            { k: 'active notes', v: String(piano().active) },
            {
              k: 'last MIDI source',
              v: piano().source ?? (piano().active === 0 ? '—' : 'on-screen'),
            },
          ]}
        />
        <p class="admin-hint">
          Subagent 14 owns PianoKeyboard. Active notes & MIDI source
          are read from `window.__wavecodePiano` when exposed by that
          component; until then we report zero / on-screen.
        </p>
      </Section>
    </div>
  );
};

type SectionProps = {
  readonly id: string;
  readonly title: string;
  readonly count: number;
  readonly children: JSX.Element;
};

const Section = (props: SectionProps): JSX.Element => (
  <details class="admin-section" open data-testid={`admin-section-${props.id}`}>
    <summary class="admin-section-summary">
      <span class="admin-section-title">{props.title}</span>
      <span class="admin-section-count" data-testid={`admin-section-count-${props.id}`}>
        {props.count}
      </span>
    </summary>
    <div class="admin-section-body">{props.children}</div>
  </details>
);

type FilterBarProps = {
  readonly filter: Filter;
  readonly sources: readonly string[];
  readonly onChange: (next: Filter) => void;
};

const FilterBar = (props: FilterBarProps): JSX.Element => (
  <div class="admin-filter" data-testid="logger-filter">
    <label class="admin-filter-label">
      <span>level</span>
      <select
        class="admin-filter-select"
        data-testid="filter-level"
        value={props.filter.level}
        onChange={(e) => {
          const v = e.currentTarget.value;
          const level: 'all' | LogLevel =
            v === 'all' ? 'all' : (v as LogLevel);
          props.onChange({ level, source: props.filter.source });
        }}
      >
        <option value="all">all</option>
        <For each={LEVELS}>{(lvl) => <option value={lvl}>{lvl}</option>}</For>
      </select>
    </label>
    <label class="admin-filter-label">
      <span>source</span>
      <select
        class="admin-filter-select"
        data-testid="filter-source"
        value={props.filter.source}
        onChange={(e) => {
          const v = e.currentTarget.value;
          props.onChange({ level: props.filter.level, source: v });
        }}
      >
        <option value="all">all</option>
        <For each={props.sources}>{(s) => <option value={s}>{s}</option>}</For>
      </select>
    </label>
  </div>
);

type LogEntryRowProps = {
  readonly entry: LogEntry;
};

const LogEntryRow = (props: LogEntryRowProps): JSX.Element => (
  <li class="admin-log-row" data-level={props.entry.level} data-source={props.entry.source}>
    <span class="admin-log-time">{formatTime(props.entry.ts)}</span>
    <span class={`admin-log-level admin-log-${props.entry.level}`}>
      {props.entry.level}
    </span>
    <span class="admin-log-source">[{props.entry.source}]</span>
    <span class="admin-log-text">{props.entry.text}</span>
  </li>
);

type KeyValueProps = {
  readonly rows: ReadonlyArray<{ readonly k: string; readonly v: string }>;
};

const KeyValue = (props: KeyValueProps): JSX.Element => (
  <div class="admin-kv">
    <For each={props.rows}>
      {(r) => (
        <div class="admin-kv-row">
          <span class="admin-kv-k">{r.k}</span>
          <span class="admin-kv-v">{r.v}</span>
        </div>
      )}
    </For>
  </div>
);

export default Admin;
export { Admin };