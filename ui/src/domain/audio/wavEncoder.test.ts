import { describe, it, expect } from 'vitest';
import {
  audioBufferToWav,
  parseWavHeader,
  decodeWavSamples,
  samplesAlmostEqual,
  fakeAudioBuffer,
} from './wavEncoder';

/**
 * Round-trip тесты для WAV encoder:
 *   synthetic AudioBuffer → bytes → parse-back → equals.
 *
 * Без реального Web Audio / OfflineAudioContext — encoder pure,
 * тестируем через `fakeAudioBuffer`.
 */

describe('audio/wavEncoder.audioBufferToWav header', () => {
  it('emits 44-byte RIFF/WAVE header for stereo 44.1kHz', () => {
    const buf = fakeAudioBuffer(2, 100, 44100, () => 0);
    const bytes = audioBufferToWav(buf);
    // 44 (header) + 100 frames * 2 ch * 2 bytes = 444
    expect(bytes.length).toBe(44 + 100 * 2 * 2);
    const meta = parseWavHeader(bytes);
    expect(meta.sampleRate).toBe(44100);
    expect(meta.numberOfChannels).toBe(2);
    expect(meta.bitsPerSample).toBe(16);
    expect(meta.dataBytes).toBe(100 * 2 * 2);
  });

  it('emits correct sizes for mono 48k 512 frames', () => {
    const buf = fakeAudioBuffer(1, 512, 48000, () => 0);
    const bytes = audioBufferToWav(buf);
    expect(bytes.length).toBe(44 + 512 * 2);
    const meta = parseWavHeader(bytes);
    expect(meta.numberOfChannels).toBe(1);
    expect(meta.sampleRate).toBe(48000);
    expect(meta.dataBytes).toBe(512 * 2);
  });

  it('writes RIFF + WAVE + fmt + data magic at correct offsets', () => {
    const buf = fakeAudioBuffer(1, 4, 22050, () => 0);
    const view = new DataView(audioBufferToWav(buf).buffer);
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('RIFF');
    expect(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))).toBe('WAVE');
    expect(String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15))).toBe('fmt ');
    expect(String.fromCharCode(view.getUint8(36), view.getUint8(37), view.getUint8(38), view.getUint8(39))).toBe('data');
  });

  it('reports correct totalBytes in RIFF chunk size field', () => {
    const buf = fakeAudioBuffer(2, 100, 44100, () => 0);
    const bytes = audioBufferToWav(buf);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
  });
});

describe('audio/wavEncoder round-trip', () => {
  it('round-trips silence (all zeros)', () => {
    const original = fakeAudioBuffer(2, 200, 44100, () => 0);
    const bytes = audioBufferToWav(original);
    const decoded = decodeWavSamples(bytes);
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.numberOfChannels).toBe(2);
    expect(decoded.numFrames).toBe(200);
    expect(decoded.channels.length).toBe(2);
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < 200; i++) {
        expect(decoded.channels[c]![i]).toBe(0);
      }
    }
  });

  it('round-trips DC offset (constant non-zero value)', () => {
    const dc = 0.5;
    const original = fakeAudioBuffer(1, 100, 22050, () => dc);
    const bytes = audioBufferToWav(original);
    const decoded = decodeWavSamples(bytes);
    expect(samplesAlmostEqual(new Float32Array(100).fill(dc), decoded.channels[0]!)).toBe(true);
  });

  it('round-trips positive ramp within PCM16 quantization tolerance', () => {
    const original = fakeAudioBuffer(1, 64, 22050, (_c, i) => i / 63);
    const bytes = audioBufferToWav(original);
    const decoded = decodeWavSamples(bytes);
    const expected = new Float32Array(64);
    for (let i = 0; i < 64; i++) expected[i] = i / 63;
    expect(samplesAlmostEqual(expected, decoded.channels[0]!)).toBe(true);
  });

  it('round-trips negative values', () => {
    const original = fakeAudioBuffer(1, 32, 22050, (_c, i) => -(i / 31));
    const bytes = audioBufferToWav(original);
    const decoded = decodeWavSamples(bytes);
    const expected = new Float32Array(32);
    for (let i = 0; i < 32; i++) expected[i] = -(i / 31);
    expect(samplesAlmostEqual(expected, decoded.channels[0]!)).toBe(true);
  });

  it('round-trips stereo interleaved layout', () => {
    const original = fakeAudioBuffer(2, 50, 44100, (c, i) => (c === 0 ? i / 49 : -i / 49));
    const bytes = audioBufferToWav(original);
    const decoded = decodeWavSamples(bytes);
    expect(decoded.numberOfChannels).toBe(2);
    expect(decoded.numFrames).toBe(50);
    const expL = new Float32Array(50);
    const expR = new Float32Array(50);
    for (let i = 0; i < 50; i++) {
      expL[i] = i / 49;
      expR[i] = -i / 49;
    }
    expect(samplesAlmostEqual(expL, decoded.channels[0]!)).toBe(true);
    expect(samplesAlmostEqual(expR, decoded.channels[1]!)).toBe(true);
  });

  it('preserves interleaved frame order in raw bytes (L,R,L,R,...)', () => {
    const original = fakeAudioBuffer(2, 4, 22050, (c, _i) => (c === 0 ? 0.25 : -0.5));
    const bytes = audioBufferToWav(original);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const offset = 44; // first PCM sample
    // 0.25 → round(0.25 * 0x7fff) = 8191
    // -0.5 → round(-0.5 * 0x8000) = -16384
    expect(view.getInt16(offset, true)).toBe(Math.round(0.25 * 0x7fff));
    expect(view.getInt16(offset + 2, true)).toBe(Math.round(-0.5 * 0x8000));
    expect(view.getInt16(offset + 4, true)).toBe(Math.round(0.25 * 0x7fff));
    expect(view.getInt16(offset + 6, true)).toBe(Math.round(-0.5 * 0x8000));
  });
});

describe('audio/wavEncoder clamping', () => {
  it('clamps values > 1 to 1 (no wraparound)', () => {
    const original = fakeAudioBuffer(1, 4, 22050, (_c, _i) => 5.0);
    const bytes = audioBufferToWav(original);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // 1.0 → round(0x7fff) = 32767
    expect(view.getInt16(44, true)).toBe(0x7fff);
  });

  it('clamps values < -1 to -1 (no wraparound)', () => {
    const original = fakeAudioBuffer(1, 4, 22050, () => -5.0);
    const bytes = audioBufferToWav(original);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // -1.0 → round(-0x8000) = -32768
    expect(view.getInt16(44, true)).toBe(-0x8000);
  });

  it('round-trips values exactly at -1.0 and 1.0', () => {
    const original = fakeAudioBuffer(1, 2, 22050, (_c, i) => (i === 0 ? 1.0 : -1.0));
    const bytes = audioBufferToWav(original);
    const decoded = decodeWavSamples(bytes);
    expect(decoded.channels[0]![0]).toBeCloseTo(1.0, 4);
    expect(decoded.channels[0]![1]).toBeCloseTo(-1.0, 4);
  });
});

describe('audio/wavEncoder edge cases', () => {
  it('handles zero-length audio buffer', () => {
    const buf = fakeAudioBuffer(2, 0, 44100, () => 0);
    const bytes = audioBufferToWav(buf);
    expect(bytes.length).toBe(44);
    const meta = parseWavHeader(bytes);
    expect(meta.dataBytes).toBe(0);
  });

  it('handles 1-channel audio (mono)', () => {
    const original = fakeAudioBuffer(1, 8, 8000, (_c, i) => i / 7);
    const bytes = audioBufferToWav(original);
    const decoded = decodeWavSamples(bytes);
    expect(decoded.numberOfChannels).toBe(1);
    expect(decoded.numFrames).toBe(8);
  });

  it('parseWavHeader throws on buffer < 44 bytes', () => {
    expect(() => parseWavHeader(new Uint8Array(10))).toThrow(/слишком короткий буфер/);
  });

  it('parseWavHeader throws on bad signature', () => {
    const bad = new Uint8Array(44);
    bad[0] = 'X'.charCodeAt(0);
    expect(() => parseWavHeader(bad)).toThrow(/неверная сигнатура/);
  });

  it('parseWavHeader throws when data chunk missing', () => {
    const buf = fakeAudioBuffer(1, 4, 22050, () => 0);
    const bytes = audioBufferToWav(buf);
    bytes[36] = 'X'.charCodeAt(0);
    expect(() => parseWavHeader(bytes)).toThrow(/ожидался 'data'/);
  });
});

describe('audio/wavEncoder file-size sanity', () => {
  it('1 second stereo 44.1kHz PCM16 ≈ 176400 bytes payload (header excluded)', () => {
    const buf = fakeAudioBuffer(2, 44100, 44100, () => 0);
    const bytes = audioBufferToWav(buf);
    const payload = bytes.length - 44;
    expect(payload).toBe(44100 * 2 * 2); // 176400 bytes
    expect(bytes.length).toBe(176444);
  });

  it('4-second mono 22.05kHz PCM16 ≈ 176400 bytes payload', () => {
    const buf = fakeAudioBuffer(1, 88200, 22050, () => 0);
    const bytes = audioBufferToWav(buf);
    expect(bytes.length - 44).toBe(88200 * 2);
  });
});