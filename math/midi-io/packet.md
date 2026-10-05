---
proposition: |
  В `ScorePanel` под редактором — пара кнопок «📥 Импорт» / «📤 Экспорт»:
  (1) текстовый round-trip — `.strudel.txt` / `.js` через `FileReader` +
  `Blob`, lossless, ровно тот же `Score = string`, что и в редакторе;
  (2) MIDI round-trip — `.mid` через Standard MIDI File codec, **lossy**:
  экспорт рендерит snippet через `Pattern.query(@span)` в поток Hap-ов,
  фильтрует только `note()`/`n()`-паттерны (сэмпловые `s(...)` скипаются
  с warning; канал 9 GM при импорте маппится в `s(...)`-строку); импорт
  делает auto-BPM detection из inter-onset интервалов (fallback 120), затем
  квантизацию на 16th-grid, и группировку нот по MIDI-каналам в
  `stack(note(...), s(...))`. Длительность экспорта MIDI задаётся
  оператором в поле «циклов» (default 4). Декодер симметричен экспорту:
  ровно то, что MIDI умеет, ровно то, что мы восстанавливаем.
antithesis: |
  (1) Только текст, без MIDI — MIDI мост lossy в обе стороны, оператор
    сначала сохранил snippet, экспортнул в MIDI, потерял все комментарии,
    каналы, контроллеры — зачем? Ответ: для interop с DAW (Logic,
    Ableton, Reaper), для hardware-секвенсоров, для нотной записи в
    Finale/MuseScore. Но эта ценность скрыта от оператора, который
    не делает DAW-pipeline.
  (2) Только MIDI, без текста — текст тривиален (4 строки кода),
    но даёт оператору возможность хранить snippet вне браузера
    (gist, email, backup IDB). Если выбросить — потеряем feature
    "переслал другу snippet в Slack".
  (3) WebMIDI API вместо файлов — WebMIDI шлёт события в реальном
    времени на железо, не в файл. Это другой use-case (live performance),
    и сейчас нет аппаратного контроллера в требованиях.
  (4) MusicXML вместо MIDI — MusicXML нотация точнее, но в 5–10×
    тяжелее по схеме и в нашем контексте (live-coding через
    mini-notation) не нужен: MIDI для interop, текст для шеринга.
  (5) Не квантизовать на 16th-grid — даёт верность источнику, но
    `note("e5 d#5 e5 ...")` без квантизации выглядит как список
    с дробями. Strudel mini-notation ожидает сетку.
  (6) Не auto-detect BPM — ставить 120 BPM default. Auto-detect
    ошибается на rubato/passagens (Für Elise без legato партитуры),
    fallback на 120 обязателен.
  (7) Не вводить UI-поле «циклов», фиксировать 4 — гибкость стоит
    1 input, юзер может захотеть длиннее (4 цикла = 8 сек, мелодия
    типа «Ode to Joy» длиннее).
synthesis: |
  Два канала экспорта покрывают разные use-case'ы:
    текст (lossless) — шеринг, backup, gist, email;
    MIDI (lossy) — interop с DAW/hardware.
  Общий код — пара функций в `presentation/components/MidiIOButtons.tsx`:
    `<input type=file>` для импорта, `URL.createObjectURL(blob)` для
    экспорта, `<a download>` триггерит скачивание. Сами кодеки чистые
  и живут в `domain/midi/`, оркестрация — в `application/midi/`.
  `domain/midi/codec.ts` — pure обёртка над `@tonejs/midi` (парсер/писатель
  SMF, без DOM, без эффектов — соответствует lint-rules для domain).
  `domain/midi/decoder.ts` — pure эвристика: `MIDISequence → Strudel
  snippet` через BPM detection (median inter-onset), 16th quantize,
  per-channel split. `domain/midi/encoder.ts` — pure структура для
  Hap-ов → MIDINote (но сама `Pattern.query()` — effect, в
  `application/midi/exportMidi.ts` через существующий `AudioEngine`).
  `s()`-паттерны НЕ рендерятся в MIDI-ноты (Strudel-сэмплы не имеют
  pitch); они скипаются с warning. При импорте канал 9 (GM Drums)
  маппится в отдельный `s("bd sd ...")` слой через маппинг GM Note→Strudel
  sample-name (e.g. 36 → bd, 38 → sd, 42 → hh).
  Decoder heuristic — явно lossy: `note(...)` восстанавливается точно,
  контроллеры (modulation, expression) и pitch-bend — нет (mini-notation
  их не выражает). Документируем как limitation в `Notes`.
  Кнопки живут в `ScorePanel` (а не в шапке), потому что это
  файл-операции над кодом, контекстно ближе к редактору.
substrate: |
  + `domain/midi/types.ts` (new): `MIDINote`, `MIDITrack`, `MIDISequence`,
    `MIDIExportOptions`, `MIDIImportResult` — pure типы.
  + `domain/midi/codec.ts` (new): pure `parseSmi(bytes): MIDISequence`
    и `writeSmi(seq): Uint8Array`, обёртка над `@tonejs/midi`.
  + `domain/midi/decoder.ts` (new): pure `midiToScore(seq, opts): string`
    — auto-BPM, 16th quantize, channel-split → Strudel mini-notation.
  + `domain/midi/encoder.ts` (new): pure `scoreNotesToMidi(events, opts):
    MIDISequence` — Hap[] → MIDINote[] (структура; сама `Pattern.query`
    не здесь).
  + `application/midi/exportMidi.ts` (new): Effect: `snippet + cycles →
    evaluate(snippet) → Pattern → pattern.queryArc(0, cycles) → Hap[] →
    domain.encoder → domain.codec.writeSmi → Uint8Array → Blob`.
    Использует `@strudel/transpiler.evaluate()` напрямую (compile-only,
    без сайд-эффектов на AudioContext — layer application может импортить
    `@strudel/*`, ограничения lint-rules касаются только `domain/` и
    `presentation/`). `AudioEngine` не расширяем.
  + `application/midi/importMidi.ts` (new): Effect: `File → bytes →
    domain.codec.parseSmi → domain.decoder.midiToScore → validate
    (sanity: попытка evaluate через `transpiler.evaluate`, warning если
    throws) → return string`.
  + `presentation/components/MidiIOButtons.tsx` (new): Solid-компонент,
    `<details>`-блок внизу ScorePanel: file-pick → импорт, cycles-input +
    download-link → экспорт. `URL.createObjectURL` / `URL.revokeObjectURL`.
  + `ui/package.json`: `@tonejs/midi: ^2.0.x` в dependencies.
  + `ui/src/presentation/panels/ScorePanel.tsx`: рендер
    `<MidiIOButtons />` под `<CodeMirrorEditor />`.
  + `ui/src/index.css`: стили для `.midi-io-bar` — компактная панель
    внизу ScorePanel, не толще `score-debug`.
  − ничего не удалено. Никаких изменений в reducer, AudioEngine,
    Repo, IDBRepo, presetsStore, appStore — все эти слои не трогаем.
status: draft
axiom: A0
epistemics:
  - statement: "Score это string в AppState (Score = string в domain/types.ts:6)"
    marker: fact
    evidence: "ui/src/domain/types.ts:6 `export type Score = string`"
  - statement: "Architecture layers domain→application→infrastructure→presentation
      с lint-enforced no-restricted-imports"
    marker: fact
    evidence: "ui/ARCHITECTURE.md:55-72 + :496-516"
  - statement: "@tonejs/midi pure-parser без DOM/Effect, можно в domain/"
    marker: judgment
    evidence: "https://github.com/Tonejs/midi.js — pure data structures,
      нет side-effects при parse/write, ~30 KB gzipped"
  - statement: "Strudel Pattern.query(spans) возвращает Hap[] с whole/frac/value"
    marker: fact
    evidence: "@strudel/core Pattern docs (`Hap<T>` interface, query метод)"
  - statement: "s() паттерны в Strudel — это сэмплы без pitch, MIDI не имеет
      для них прямого представления"
    marker: fact
    evidence: "Strudel docs: `s(name)` — выбор сэмпла, нет note-frequency
      output"
  - statement: "GM канал 9 = Drums; ноты 36/38/42 = bd/sd/hh"
    marker: fact
    evidence: "General MIDI standard mapping (MMA, 1991) — канал 9 зарезервирован
      для drums, 36 = Bass Drum 1, 38 = Acoustic Snare, 42 = Closed Hi-Hat"
  - statement: "Оператор делает шеринг/backup ДА, MIDI interop тоже ДА
      (оба выбраны в вопросах)"
    marker: judgment
    evidence: "ответы на вопросы 2026-10-05: «v1 + v2 вместе»"
  - statement: "Кнопки в ScorePanel (не в шапке)"
    marker: judgment
    evidence: "ответ 2026-10-05: «В ScorePanel снизу»"
  - statement: "Длительность экспорта MIDI настраиваемая в UI"
    marker: judgment
    evidence: "ответ 2026-10-05: «Настраиваемо в UI»"
  - statement: "Decoder — quantize + auto BPM detection"
    marker: judgment
    evidence: "ответ 2026-10-05: «Quantize + автоматический BPM detection»"
  - statement: "MIDI-мост lossy в обе стороны"
    marker: judgment
    evidence: "MIDI — discrete events; Strudel mini-notation — source code для
      pattern; эти представления не эквивалентны, roundtrip теряет
      информацию (комментарии, контроллеры, микро-timing, drum-mapping)"
---

## Intent

Оператор может вытащить текущий snippet из wavecode в файл и положить
обратно. Два канала — текст и MIDI — закрывают разные потребности:

- **Текст** — шеринг (`gist`, email, slack, README), бэкап вне браузера,
  перенос между устройствами. Lossless, потому что `Score = string`
  уже текст, мы просто пишем его в файл.
- **MIDI** — interop с DAW (Ableton, Logic, Reaper), hardware-секвенсоры,
  нотные редакторы (MuseScore, Finale), YouTube backing tracks.
  Lossy, но открывает экосистему, куда текст не достанет.

UI — пара кнопок в нижней части `ScorePanel`, потому что это
файловые операции над редактируемым кодом, контекстно ближе к
редактору чем к шапке.

## Где что живёт

```
ui/src/
├── domain/midi/                          ← pure, no DOM, no Effect
│   ├── types.ts                             MIDINote, MIDITrack, MIDISequence,
│   │                                        MIDIExportOptions, MIDIImportResult
│   ├── codec.ts                             parseSmi / writeSmi (обёртка над
│   │                                        @tonejs/midi)
│   ├── decoder.ts                           midiToScore(seq, opts): string
│   │                                        (BPM detect, 16th quantize,
│   │                                         channel-split)
│   └── encoder.ts                           scoreNotesToMidi(events, opts):
│                                            MIDISequence  (структура)
│
├── application/midi/                     ← Effect orchestration
│   ├── exportMidi.ts                         snippet + cycles → Blob
│   ├── importMidi.ts                         File → snippet (с валидацией)
│   └── gmDrumMap.ts                          GM Note → Strudel s-name маппинг
│
└── presentation/components/
    └── MidiIOButtons.tsx                  ← Solid, <details> внизу ScorePanel
```

**Ничего** из существующего не переписывается. Reducer, Repo, IDBRepo,
`LiveAudioEngine`, `appStore`, `presetsStore`, `App.tsx` header — все
остаются нетронутыми. Единственное касание `App.tsx` — рендер
`<MidiIOButtons />` внутри `ScorePanel`, **не** в header.

## Worked example

### Импорт MIDI файла

```ts
// presentation/components/MidiIOButtons.tsx
const onImport = async (file: File) => {
  const buf = await file.arrayBuffer();
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* importMidi(buf);
    }).pipe(Effect.provide(AppLayer))
  );
  if (result.ok) {
    dispatch({ type: 'replaceScore', text: result.score });
    if (result.warnings.length) {
      // показать в status-панели
      result.warnings.forEach(w => console.warn('[midi-import]', w));
    }
  } else {
    // показать err в AI-панели status
    setError(`Импорт MIDI: ${result.error}`);
  }
};

// <input type="file" accept=".mid,.midi,.strudel.txt,.js,.txt"
//        onChange={e => onImport(e.currentTarget.files![0])} />
```

### Экспорт MIDI

```ts
// application/midi/exportMidi.ts
export const exportMidi = (
  snippet: string,
  cycles: number,
  bpm: number = 120,
): Effect<Uint8Array, AudioError | ExportError, AudioEngine> =>
  Effect.gen(function* () {
    const engine = yield* AudioEngine;
    // eval snippet → Pattern через существующий engine.eval
    const events = yield* engine.queryEvents(snippet, cycles, bpm);
    // events: MIDINote[] уже готовый (если AudioEngine.queryEvents есть;
    //         если нет — реализуем здесь поверх eval+Pattern.query)
    const seq = scoreNotesToMidi(events, { bpm, ppq: 480 });
    return writeSmi(seq);
  });
```

### Экспорт текста

```ts
// presentation/components/MidiIOButtons.tsx
const onExportText = () => {
  const blob = new Blob([appStore.score], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename() || 'wavecode-score.strudel.txt';
  a.click();
  URL.revokeObjectURL(url);
};
```

### Decoder: MIDI → Strudel (центральная эвристика)

```ts
// domain/midi/decoder.ts
const midiToScore = (
  seq: MIDISequence,
  opts: { bpm?: number; quantizeGrid?: number } = {},
): string => {
  const bpm = opts.bpm ?? detectBpm(seq);  // median inter-onset / fallback 120
  const grid = opts.quantizeGrid ?? 0.25;   // 16th (quarter = 1.0)
  // notes: для каждого канала:
  //   - quantize onset к grid (в долях cycle)
  //   - собрать в массив нот, чередуя с `~` (rest) если onset пропущен
  //   - wrap в note("...")
  // канал 9 → s("bd sd hh ...") через gmDrumMap
  // если >1 канала → stack(note(...), s(...), note(...))
  return lines.join('\n');
};

const detectBpm = (seq: MIDISequence): number => {
  const onsets = seq.tracks.flatMap(t => t.notes.map(n => n.timeSec));
  if (onsets.length < 4) return 120;
  onsets.sort((a, b) => a - b);
  const ioi = onsets.slice(1).map((t, i) => t - onsets[i]).filter(d => d > 0);
  ioi.sort((a, b) => a - b);
  const median = ioi[Math.floor(ioi.length / 2)];
  // 1 beat ≈ median IOI; BPM = 60 / median
  const bpm = Math.round(60 / median);
  return bpm >= 30 && bpm <= 300 ? bpm : 120;
};
```

### UI: панель внизу ScorePanel

```tsx
// ui/src/presentation/panels/ScorePanel.tsx
export function ScorePanel() {
  // ...существующее...
  return (
    <div class="score-panel-inner">
      <CodeMirrorEditor ... />
      <div class="score-debug">...</div>
      <MidiIOButtons />           {/* new */}
    </div>
  );
}

// ui/src/presentation/components/MidiIOButtons.tsx
export function MidiIOButtons() {
  const [open, setOpen] = createSignal(false);
  const [cycles, setCycles] = createSignal(4);
  return (
    <details class="midi-io-bar" open={open()} onToggle={...}>
      <summary>📁 Файловые операции</summary>
      <div class="midi-io-row">
        <label class="midi-io-field">
          <span>Импорт:</span>
          <input type="file" accept=".mid,.midi,.strudel.txt,.js,.txt"
                 onChange={onImport} />
        </label>
        <label class="midi-io-field">
          <span>Экспорт MIDI, циклов:</span>
          <input type="number" min="1" max="32" value={cycles()}
                 onInput={e => setCycles(+e.currentTarget.value)} />
          <button onClick={onExportMidi}>📤 MIDI</button>
        </label>
        <button onClick={onExportText}>📤 Текст</button>
      </div>
    </details>
  );
}
```

## What this is NOT

- **Не** live WebMIDI output (в железо в реальном времени). Это другой
  use-case, отдельный пакет.
- **Не** MusicXML импорт/экспорт. Слишком тяжёлая схема, нет
  потребителя.
- **Не** `.wav`/`.mp3` рендер. Только events, метаданные, interop.
- **Не** Strudel pattern редактор внутри MIDI-импорта. Декодер
  выдаёт грубый сниппет, юзер редактирует руками.
- **Не** auto-recovery из MIDI при ошибке. Импорт либо работает,
  либо валится с error, как `editScore`.
- **Не** новый persistence layer. Экспортированный MIDI не
  автоматически импортируется обратно, юзер сам выбирает файл.
- **Не** изменение `LiveAudioEngine`. Если `engine.queryEvents()`
  нет — добавляем в этом пакете как **новый метод интерфейса**
  `AudioEngine` (substrate-extension), не правим существующий eval.
- **Не** замена существующего шеринга через `shareURL` (если есть) —
  это другой механизм, не конкурируем.
- **Не** IDB-кеш для MIDI. Каждый импорт — свой файл, юзер сам
  хранит.

## Тесты

- `domain/midi/codec.test.ts` — round-trip: write MIDI → parse → equals
  (pitch, onset, duration, channel).
- `domain/midi/decoder.test.ts` — известные fixture: Creep (Radiohead)
  в MIDI-форме → должен давать читаемый `note("g2 b2 c3 c3")`-style
  snippet, bpm ≈ 120 (Creep = 120 BPM).
- `domain/midi/decoder.test.ts` — detectBpm: шум → 120 (fallback),
  rubato-passage → fallback или close-to-source (не 600 BPM).
- `domain/midi/decoder.test.ts` — channel 9: только drums → `s("bd sd")`,
  mixed tracks → `stack(note(...), s(...))`.
- `application/midi/exportMidi.test.ts` — sample snippet "Für Elise" →
  midi → обратно в decoder → хотя бы похожий snippet (lossy check).
- `ui/src/presentation/components/MidiIOButtons.test.tsx` — Solid
  testing-library: file-pick вызывает dispatch, текст-экспорт создаёт
  Blob с правильным MIME.

## Notes

- **`@tonejs/midi` вес**: ~30 KB gzipped. Добавляется в main bundle.
  Если критично — выделить в lazy chunk: `await import('@tonejs/midi')`
  внутри `application/midi/`. Решаем на этапе имплементации по
  lighthouse-метрикам.
- **Strudel `Pattern.query()` API**: проверить на этапе impl, что
  `query(spanSec)` возвращает `Hap[]` в нужной форме. Если форма
  неудобная (value = `{ freq }` вместо числа), добавляем шаг
  `freq → midi note number` через `Tonal` (`@strudel/tonal` уже
  есть в deps) или `noteToFreq`-инверсию.
- **GM Drum Map**: подмножество из ~20 нот (kick, snare, hihat, tom,
  crash). Не все 128 — для не-мапленных выводим `s("gm36")` или
  similar fallback.
- **BPM detection accuracy**: median IOI работает на steady-бит
  музыке (рок, поп). На rubato/classical (Für Elise) часто
  промахивается → fallback 120. Это явно lossy и документировано.
- **Velocity**: Strudel `.velocity()` или `.gain()` → MIDI velocity
  (0..127). Default 100 если не указано.
- **Длительность экспорта**: cycles ∈ [1, 32]. Дефолт 4 (= 8 сек
  при cps=0.5). Можно сделать default 'preset' из имени (Creep →
  1 cycle = 2 сек потому что score = один такт; но это усложняет
  — оставляем 4).
- **`s()` паттерны при экспорте**: пропускаются (warning в
  status-панель: «2 сэмпловых слоя не экспортированы: bass_drum,
  snare_drum»). Альтернатива: мапить в GM Drums (ch 9) — но это
  не lossless, может фрустрировать.
- **Self-файлы**: импортируем свой же экспорт — должно работать
  (round-trip smoke test). Тест добавляется.
- **`.strudel.txt` vs `.js` vs `.txt`**: импорт принимаем все три,
  экспорт — `.strudel.txt` (явное имя, не конфликтует с `.js`
  редактором).
- **`Score` остаётся `string`**: никакой новой структуры, никакого
  `Score = { midi?, text? }`. `Score = string` — единственный контракт.
  Импорт MIDI **декодируется** в Strudel snippet-string перед
  `replaceScore`. То есть MIDI-импорт = генерированная правка кода.
- **Reducer не меняется**: импорт = `replaceScore`. Экспорт = нет
  state change. Существующий `replaceScore` уже сохраняет `scorePrev`
  для undo — MIDI-импорт тоже откатывается через «↶ Откатить».
- **Wired без расширения `AudioEngine`**: используем
  `@strudel/transpiler.evaluate()` (compile-only, не трогает
  AudioContext) + `Pattern.queryArc()`. `AudioEngine` остаётся
  нетронутым, separation of concerns сохранён (export — отдельный
  flow, не конкурирует с playback).

## Open questions

1. **Семпловые слои в экспорте**: пропустить (просто) или
   попытаться замапить в GM Drums (сложнее, lossy наоборот).
   Default: пропустить.
2. **Round-trip в e2e тесте**: Playwright `#001` — экспортнуть
   Creep, перевести в MIDI, импортировать обратно, проверить
   что получился играемый snippet (eval success в Strudel).
3. **Lazy-load `@tonejs/midi`**: пока в main, после импл — проверить
   lighthouse, вынести если надо.
4. **`URL.createObjectURL` cleanup**: на unmount компонента
   `revokeObjectURL` для текущего URL — memory leak иначе.