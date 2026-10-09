import { getSuperdoughAudioController } from 'superdough';

/**
 * Live recorder — обёртка над `MediaRecorder`.
 *
 * Подключается параллельно к существующему выходному тракту superdough:
 *
 *   superdough.transient → bus → channelMerger → destinationGain → ctx.destination
 *                                                       │
 *                                                       └─► mediaStreamDestination ─► MediaRecorder
 *
 * Таким образом:
 *   - звук продолжает идти в колонки (ctx.destination не трогаем),
 *   - параллельно копия уходит в MediaRecorder,
 *   - iOS background-suspend ломает запись (документировано в packet.notes).
 *
 * MIME detection — через `MediaRecorder.isTypeSupported()`:
 *   Chrome desktop/Android  → audio/webm;codecs=opus (.webm)
 *   Safari macOS / iOS      → audio/mp4;codecs=mp4a.40.2 (.m4a)
 *   Firefox                 → audio/ogg;codecs=opus (.ogg)
 *
 * Если ни один mime не поддержан — `pickSupportedMime()` вернёт null,
 * UI показывает ошибку «браузер не поддерживает MediaRecorder».
 *
 * LiveRecorder — **не** singleton: каждый экземпляр имеет свой lifecycle.
 * `LiveAudioEngine.recordLive()` создаёт свежий инстанс при первом клике,
 * переиспользует после stop+start (toggle).
 */

export type RecorderState = 'idle' | 'recording' | 'stopping' | 'error';

export type RecorderMime = {
  readonly mime: string;
  readonly ext: 'webm' | 'm4a' | 'ogg';
};

export type RecorderResult = {
  readonly blob: Blob;
  readonly mime: string;
  readonly ext: 'webm' | 'm4a' | 'ogg';
};

export type LiveRecorderHandle = {
  readonly start: () => void;
  readonly stop: () => Promise<RecorderResult>;
  readonly getState: () => RecorderState;
  readonly getMime: () => RecorderMime;
  readonly dispose: () => void;
};

const MIME_CANDIDATES: ReadonlyArray<RecorderMime> = [
  { mime: 'audio/webm;codecs=opus', ext: 'webm' },
  { mime: 'audio/webm', ext: 'webm' },
  { mime: 'audio/mp4;codecs=mp4a.40.2', ext: 'm4a' },
  { mime: 'audio/mp4', ext: 'm4a' },
  { mime: 'audio/ogg;codecs=opus', ext: 'ogg' },
  { mime: 'audio/ogg', ext: 'ogg' },
];

export const pickSupportedMime = (): RecorderMime | null => {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate.mime)) return candidate;
  }
  return null;
};

export const listSupportedMimes = (): ReadonlyArray<RecorderMime> =>
  MIME_CANDIDATES.filter((c) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mime),
  );

const noSuchController = (): Error =>
  new Error(
    'SuperdoughAudioController.output.destinationGain недоступен — ' +
      'сначала eval-сниппет (audio должен быть уже запущен)',
  );

type SuperdoughOutputLike = {
  destinationGain: AudioNode | null;
};

type SuperdoughAudioControllerLike = {
  output: SuperdoughOutputLike | null;
};

const getDestinationGain = (audioCtx: AudioContext): AudioNode => {
  const controller = getSuperdoughAudioController() as SuperdoughAudioControllerLike | null;
  const out = controller?.output;
  if (!out || !out.destinationGain) throw noSuchController();
  // Strudel сужает destinationGain на тот же ctx, что мы передали. Если
  // нет — падаем с понятной ошибкой (юзер открыл два таба с разными ctx).
  const node = out.destinationGain;
  if (node.context !== audioCtx) {
    throw new Error(
      'destinationGain привязан к другому AudioContext; ' +
        'recorder должен жить в том же табе, что и eval',
    );
  }
  return node;
};

/**
 * LiveRecorder — class instance per recording session.
 *
 * Lifecycle: idle → recording → stopping → idle.
 * После stop() handle можно start()'нуть снова (toggle UX).
 */
export class LiveRecorder implements LiveRecorderHandle {
  private readonly ctx: AudioContext;
  private readonly picked: RecorderMime;
  private recorderState: RecorderState = 'idle';
  private mediaRecorder: MediaRecorder | null = null;
  private mediaDest: MediaStreamAudioDestinationNode | null = null;
  private sourceGain: AudioNode | null = null;
  private chunks: Blob[] = [];
  private errorMessage: string | null = null;

  constructor(ctx: AudioContext, picked: RecorderMime) {
    this.ctx = ctx;
    this.picked = picked;
  }

  start = (): void => {
    if (this.recorderState !== 'idle') {
      throw new Error(`LiveRecorder.start в state=${this.recorderState} (нужен idle)`);
    }
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('MediaRecorder недоступен в этом окружении');
    }

    const gain = getDestinationGain(this.ctx);
    const dest = this.ctx.createMediaStreamDestination();
    gain.connect(dest);
    this.mediaDest = dest;
    this.sourceGain = gain;

    const recorder = new MediaRecorder(dest.stream, { mimeType: this.picked.mime });
    this.chunks = [];
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    recorder.onerror = (ev: Event) => {
      const err = (ev as { error?: Error }).error;
      this.errorMessage = err ? err.message : 'MediaRecorder error';
      this.recorderState = 'error';
    };
    recorder.start(1000); // 1-second timeslice: chunked, lower memory
    this.mediaRecorder = recorder;
    this.recorderState = 'recording';
  };

  stop = async (): Promise<RecorderResult> => {
    if (this.recorderState !== 'recording') {
      throw new Error(`LiveRecorder.stop в state=${this.recorderState} (нужен recording)`);
    }
    const recorder = this.mediaRecorder!;
    this.recorderState = 'stopping';

    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = (ev: Event) => {
        const err = (ev as { error?: Error }).error;
        reject(err ?? new Error('MediaRecorder onerror'));
      };
    });

    try {
      recorder.stop();
      await stopped;
    } finally {
      this.cleanup();
    }

    const blob = new Blob(this.chunks, { type: this.picked.mime });
    this.recorderState = 'idle';
    return { blob, mime: this.picked.mime, ext: this.picked.ext };
  };

  getState = (): RecorderState => this.recorderState;

  getMime = (): RecorderMime => this.picked;

  getError = (): string | null => this.errorMessage;

  dispose = (): void => {
    this.cleanup();
    this.recorderState = 'idle';
  };

  private cleanup(): void {
    if (this.sourceGain && this.mediaDest) {
      try {
        this.sourceGain.disconnect(this.mediaDest);
      } catch {
        /* already disconnected — fine */
      }
    }
    if (this.mediaDest) {
      try {
        this.mediaDest.disconnect();
      } catch {
        /* noop */
      }
    }
    this.mediaDest = null;
    this.sourceGain = null;
    this.mediaRecorder = null;
    this.chunks = [];
  }
}

/**
 * Утилита для имени файла — `wavecode-take-<ISO-stamp>.<ext>`.
 * Используется и live, и offline render (с дефолтом `.wav` для offline).
 */
export const takeFilename = (ext: 'webm' | 'm4a' | 'ogg' | 'wav'): string => {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  return `wavecode-take-${stamp}.${ext}`;
};