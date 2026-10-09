/**
 * WebMIDI input — optional, only available in Chrome/Edge/Firefox.
 * iOS Safari: `navigator.requestMIDIAccess` is undefined → silently
 * empty list, callers must check `isMidiAvailable()` first.
 *
 * Public API:
 *   - isMidiAvailable(): boolean
 *   - requestMidiAccess(): Promise<MIDIAccess | null> (null on iOS)
 *   - listMidiInputs(access): MIDIInput[] (typed wrapper)
 *   - onNote(access, callback): unsubscribe()
 *
 * Status byte layout (MIDI 1.0):
 *   0x90+ch  note-on (data[1]=note, data[2]=velocity, 0 = note-off equivalent)
 *   0x80+ch  note-off
 *   0xB0+ch  control change
 */

export type NoteEvent =
  | { readonly type: 'noteOn'; readonly note: number; readonly velocity: number }
  | { readonly type: 'noteOff'; readonly note: number };

export type NoteCallback = (e: NoteEvent) => void;

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

export const requestMidiAccess = (): Promise<MidiAccessLike | null> => {
  if (!isWebMidiSupported()) return Promise.resolve(null);
  return (navigator as unknown as {
    requestMIDIAccess: (opts?: { sysex?: boolean }) => Promise<MidiAccessLike>;
  }).requestMIDIAccess({ sysex: false }).catch((err) => {
    console.warn('[MidiInput] requestMIDIAccess failed:', err);
    return null;
  });
};

export const listMidiInputs = (access: MidiAccessLike): ReadonlyArray<MidiInputLike> =>
  Array.from(access.inputs.values());

export const onNote = (
  access: MidiAccessLike,
  callback: NoteCallback,
): (() => void) => {
  const handler = (input: MidiInputLike) => {
    input.onmidimessage = (ev) => {
      const [status, note, velocity] = ev.data;
      if (status === undefined || note === undefined) return;
      const cmd = status & 0xF0;
      if (cmd === 0x90 && velocity !== undefined && velocity > 0) {
        callback({ type: 'noteOn', note, velocity });
      } else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) {
        callback({ type: 'noteOff', note });
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
