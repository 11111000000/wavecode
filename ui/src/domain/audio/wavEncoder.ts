/**
 * Pure 16-bit PCM WAV encoder (RIFF/WAVE).
 *
 * Контракт:
 *   `audioBufferToWav(buf)` принимает `AudioBuffer`-like и возвращает
 *   `Uint8Array` — полный .wav файл: 44-byte RIFF header + interleaved
 *   16-bit signed little-endian PCM samples.
 *
 * Stereo → стерео (channels из `AudioBuffer.numberOfChannels`,
 * обычно 2 для Strudel webaudioRepl output). Никакого downmix —
 * `MediaRecorder` AAC на iOS жмёт стерео без проблем, а WAV в DAW
 * импортируется в исходной раскладке.
 *
 * Clipping: значения вне [-1, 1] клампятся, иначе приводит к wraparound
 * в PCM16.
 *
 * Pure: не зависит ни от Web Audio (кроме типа), ни от Effect-TS,
 * ни от Strudel. Поэтому живёт в `domain/audio/` и тестируется в vitest
 * с синтетическим буфером.
 *
 * Layout reference (44 bytes header):
 *   0..3    'RIFF'
 *   4..7    RIFF chunk size = totalBytes - 8  (little-endian uint32)
 *   8..11   'WAVE'
 *  12..15   'fmt '
 *  16..19   fmt chunk size = 16                 (little-endian uint32)
 *  20..21   format tag = 1 (PCM)                (little-endian uint16)
 *  22..23   numberOfChannels                    (little-endian uint16)
 *  24..27   sampleRate                          (little-endian uint32)
 *  28..31   byteRate = sampleRate * blockAlign  (little-endian uint32)
 *  32..33   blockAlign = channels * 2           (little-endian uint16)
 *  34..35   bitsPerSample = 16                  (little-endian uint16)
 *  36..39   'data'
 *  40..43   data chunk size                     (little-endian uint32)
 *  44..     interleaved int16 samples (channels first → frames)
 */

const HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const PCM_FORMAT_TAG = 1; // WAVE_FORMAT_PCM

const writeAscii = (view: DataView, offset: number, s: string): void => {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
};

const writeUint32LE = (view: DataView, offset: number, value: number): void => {
  view.setUint32(offset, value >>> 0, true);
};

const writeUint16LE = (view: DataView, offset: number, value: number): void => {
  view.setUint16(offset, value & 0xffff, true);
};

const clampToPcm16 = (sample: number): number => {
  if (sample > 1) return 1;
  if (sample < -1) return -1;
  return sample;
};

export type AudioBufferLike = {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly length: number;
  readonly duration: number;
  getChannelData: (channel: number) => Float32Array;
};

/**
 * Кодирует `AudioBuffer` в 16-bit PCM WAV.
 *
 * Каналы интерливятся по фреймам: [L0 R0 L1 R1 ...], как требует
 * WAVE_FORMAT_PCM. Каждый сэмпл — int16 little-endian, диапазон
 * [-32768, 32767] = [-1.0, 1.0) с шагом 1/32768.
 */
export const audioBufferToWav = (buf: AudioBufferLike): Uint8Array => {
  const numChannels = Math.max(1, Math.floor(buf.numberOfChannels));
  const sampleRate = Math.max(1, Math.floor(buf.sampleRate));
  const numFrames = Math.max(0, Math.floor(buf.length));
  const blockAlign = numChannels * BYTES_PER_SAMPLE;
  const byteRate = sampleRate * blockAlign;
  const dataBytes = numFrames * blockAlign;
  const totalBytes = HEADER_BYTES + dataBytes;

  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer);

  // RIFF chunk descriptor.
  writeAscii(view, 0, 'RIFF');
  writeUint32LE(view, 4, totalBytes - 8);
  writeAscii(view, 8, 'WAVE');

  // fmt sub-chunk.
  writeAscii(view, 12, 'fmt ');
  writeUint32LE(view, 16, 16);
  writeUint16LE(view, 20, PCM_FORMAT_TAG);
  writeUint16LE(view, 22, numChannels);
  writeUint32LE(view, 24, sampleRate);
  writeUint32LE(view, 28, byteRate);
  writeUint16LE(view, 32, blockAlign);
  writeUint16LE(view, 34, BITS_PER_SAMPLE);

  // data sub-chunk header.
  writeAscii(view, 36, 'data');
  writeUint32LE(view, 40, dataBytes);

  // Interleaved PCM16 body.
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buf.getChannelData(c));

  let offset = HEADER_BYTES;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const raw = channels[c]![i]!;
      const clipped = clampToPcm16(raw);
      const pcm = clipped < 0 ? Math.round(clipped * 0x8000) : Math.round(clipped * 0x7fff);
      view.setInt16(offset, pcm, true);
      offset += BYTES_PER_SAMPLE;
    }
  }

  return out;
};

/**
 * Парсит RIFF-заголовок WAV файла (первые 44 байта).
 * Используется в round-trip тестах: encode → parse → check.
 */
export type WavHeader = {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly bitsPerSample: number;
  readonly dataBytes: number;
};

export const parseWavHeader = (bytes: Uint8Array): WavHeader => {
  if (bytes.length < HEADER_BYTES) {
    throw new Error(`WAV: слишком короткий буфер (${bytes.length} < ${HEADER_BYTES})`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error(`WAV: неверная сигнатура (${riff}/${wave})`);
  }
  const fmtSize = view.getUint32(16, true);
  if (fmtSize !== 16 && fmtSize !== 18 && fmtSize !== 40) {
    throw new Error(`WAV: неожиданный fmt chunk size ${fmtSize}`);
  }
  const formatTag = view.getUint16(20, true);
  if (formatTag !== PCM_FORMAT_TAG) {
    throw new Error(`WAV: не PCM (format tag ${formatTag})`);
  }
  const numberOfChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataMagic = String.fromCharCode(
    view.getUint8(36),
    view.getUint8(37),
    view.getUint8(38),
    view.getUint8(39),
  );
  if (dataMagic !== 'data') {
    throw new Error(`WAV: ожидался 'data' на offset 36, получено '${dataMagic}'`);
  }
  const dataBytes = view.getUint32(40, true);
  return { sampleRate, numberOfChannels, bitsPerSample, dataBytes };
};

/**
 * Декодирует interleaved int16 PCM сэмплы обратно в Float32.
 * Используется в round-trip тестах.
 */
export const decodeWavSamples = (
  bytes: Uint8Array,
): { channels: Float32Array[]; sampleRate: number; numberOfChannels: number; numFrames: number } => {
  const meta = parseWavHeader(bytes);
  if (meta.bitsPerSample !== 16) {
    throw new Error(`WAV decode: только 16-bit поддерживается, получено ${meta.bitsPerSample}`);
  }
  const dataStart = HEADER_BYTES;
  const totalSamples = meta.dataBytes / (meta.bitsPerSample / 8);
  const frames = Math.floor(totalSamples / meta.numberOfChannels);
  const channels: Float32Array[] = Array.from(
    { length: meta.numberOfChannels },
    () => new Float32Array(frames),
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = dataStart;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < meta.numberOfChannels; c++) {
      const int16 = view.getInt16(offset, true);
      const sample = int16 < 0 ? int16 / 0x8000 : int16 / 0x7fff;
      channels[c]![i] = sample;
      offset += 2;
    }
  }
  return { channels, sampleRate: meta.sampleRate, numberOfChannels: meta.numberOfChannels, numFrames: frames };
};

/**
 * Sanity helper: сравнить samples двух буферов с допуском.
 * PCM16 квантование → |error| ≤ 1 / 0x7fff ≈ 3.05e-5; тесты ставят
 * запас ×2 для safety.
 */
export const samplesAlmostEqual = (
  expected: Float32Array,
  actual: Float32Array,
  tolerance = 2 / 0x7fff,
): boolean => {
  if (expected.length !== actual.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (Math.abs(expected[i]! - actual[i]!) > tolerance) return false;
  }
  return true;
};

/**
 * Создаёт синтетический `AudioBuffer`-like объект с указанной
 * формой волны на каждом канале. Используется в round-trip тестах
 * без реального `OfflineAudioContext`/`AudioContext`.
 */
export const fakeAudioBuffer = (
  numberOfChannels: number,
  length: number,
  sampleRate: number,
  fill: (channel: number, frame: number) => number,
): AudioBufferLike => ({
  numberOfChannels,
  length,
  sampleRate,
  duration: length / sampleRate,
  getChannelData: (channel: number) => {
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) out[i] = fill(channel, i);
    return out;
  },
});