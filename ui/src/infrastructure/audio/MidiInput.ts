/**
 * WebMIDI input — optional, only available in Chrome/Edge/Firefox.
 * iOS Safari: `navigator.requestMIDIAccess` is undefined → silently
 * empty list, callers must check `isMidiAvailable()` first.
 *
 * Public API:
 *   - isMidiAvailable(): boolean
 *   - requestMidiAccess(timeoutMs = 1000): Promise<MIDIAccess | null>
 *       (null on iOS or if the permission prompt hangs past timeoutMs)
 *   - getMidiPermissionState(): 'granted' | 'denied' | 'prompt' | 'unknown'
 *   - listMidiInputs(access): MIDIInput[] (typed wrapper)
 *   - onNote(access, callback): unsubscribe()
 *
 * Status byte layout (MIDI 1.0):
 *   0x90+ch  note-on (data[1]=note, data[2]=velocity, 0 = note-off equivalent)
 *   0x80+ch  note-off
 *   0xB0+ch  control change
 */

/**
 * `source` / `sourceId` identify the WebMIDI input that produced the
 * event. They're always populated — input.name is the WebMIDI device
 * label (e.g. "AKAI MPK Mini") and we fall back to `'unknown'` only
 * when the host reports a null name (rare, but possible on some Linux
 * ALSA backends). `sourceId` is the WebMIDI `input.id` UUID, useful
 * for grouping notes that came from the same physical device even if
 * the user renames it between sessions.
 */
export type NoteEvent =
  | {
      readonly type: 'noteOn';
      readonly note: number;
      readonly velocity: number;
      readonly source: string;
      readonly sourceId: string;
    }
  | {
      readonly type: 'noteOff';
      readonly note: number;
      readonly source: string;
      readonly sourceId: string;
    };

export type NoteCallback = (e: NoteEvent) => void;

export type MidiPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

// Minimal WebMIDI types (avoid pulling in @types/webmidi).
export interface MidiInputLike {
  readonly id: string;
  readonly name: string | null;
  onmidimessage: ((ev: { data: Uint8Array; timeStamp: number }) => void) | null;
}
export interface MidiAccessLike {
  readonly inputs: ReadonlyMap<string, MidiInputLike>;
  readonly state: 'connected' | 'disconnected';
  onstatechange: ((ev: { port: { name?: string; type: string; state: string } }) => void) | null;
}

const isWebMidiSupported = (): boolean => {
  return typeof navigator !== 'undefined'
    && typeof (navigator as unknown as { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function';
};

export const isMidiAvailable = isWebMidiSupported;

/**
 * Race `navigator.requestMIDIAccess` against `timeoutMs` (default 1s).
 * On timeout, return `null` so callers (e.g. PianoKeyboard.onMount)
 * don't wait forever when the user-agent silently dismisses the
 * permission prompt. The signature is back-compat — existing callers
 * (`requestMidiAccess()`) keep working unchanged.
 */
export const requestMidiAccess = (timeoutMs = 1000): Promise<MidiAccessLike | null> => {
  if (!isWebMidiSupported()) return Promise.resolve(null);
  const accessPromise = (navigator as unknown as {
    requestMIDIAccess: (opts?: { sysex?: boolean }) => Promise<MidiAccessLike>;
  }).requestMIDIAccess({ sysex: false });
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('midi-timeout')), timeoutMs);
  });
  return Promise.race<MidiAccessLike | null>([accessPromise, timeoutPromise]).catch((err) => {
    if (err instanceof Error && err.message === 'midi-timeout') {
      console.warn('[MidiInput] requestMIDIAccess timed out after', timeoutMs, 'ms');
      return null;
    }
    console.warn('[MidiInput] requestMIDIAccess failed:', err);
    return null;
  });
};

/**
 * Read the MIDI permission state via `navigator.permissions.query`. Falls
 * back to `'unknown'` on browsers without a Permissions API for midi
 * (Safari pre-16.4) or when no Permissions API at all is exposed. Used
 * by the console UI to render a "MIDI permission needed" affordance
 * when state === 'denied' / 'prompt'.
 */
export const getMidiPermissionState = async (): Promise<MidiPermissionState> => {
  if (typeof navigator === 'undefined') return 'unknown';
  const perms = (navigator as unknown as {
    permissions?: { query: (opts: { name: string; sysex?: boolean }) => Promise<PermissionStatus> };
  }).permissions;
  if (!perms || typeof perms.query !== 'function') return 'unknown';
  try {
    const status = await perms.query({ name: 'midi', sysex: false });
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
      return status.state;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
};

export const listMidiInputs = (access: MidiAccessLike): ReadonlyArray<MidiInputLike> =>
  Array.from(access.inputs.values());

export const onNote = (
  access: MidiAccessLike,
  callback: NoteCallback,
): (() => void) => {
  const handler = (input: MidiInputLike) => {
    // Capture source identifying fields ONCE per input binding. The
    // WebMIDI spec guarantees these don't change for the lifetime of
    // the port, so we don't need to read them out of every midimessage
    // event (which would just be busywork in the audio callback-ish
    // hot path).
    const source = input.name ?? 'unknown';
    const sourceId = input.id;
    input.onmidimessage = (ev) => {
      const [status, note, velocity] = ev.data;
      if (status === undefined || note === undefined) return;
      const cmd = status & 0xF0;
      if (cmd === 0x90 && velocity !== undefined && velocity > 0) {
        callback({ type: 'noteOn', note, velocity, source, sourceId });
      } else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) {
        callback({ type: 'noteOff', note, source, sourceId });
      }
      // CC (0xB0) и прочее игнорируем — single-note use-case
    };
  };
  // Bind to existing inputs
  for (const input of listMidiInputs(access)) handler(input);
  // Bind to new ones via statechange
  const stateHandler = (ev: { port: { name?: string; type: string; state: string } }) => {
    if (ev.port.type === 'input' && ev.port.state === 'connected') {
      // Re-find the input (port object != MIDIInput from inputs map)
      for (const input of listMidiInputs(access)) {
        if (input.name === ev.port.name) handler(input);
      }
    }
  };
  access.onstatechange = stateHandler;
  return () => {
    for (const input of listMidiInputs(access)) input.onmidimessage = null;
    access.onstatechange = null;
  };
};