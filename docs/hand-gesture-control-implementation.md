# Управление музыкой жестами рук — состояние реализации

Документ описывает, что именно реализовано в ветке `feat/hand-gesture-control`
на момент коммита `d2d0930` (база — `master` `8cd6ccc`).

Проектные решения — в [hand-gesture-control-design.md](./hand-gesture-control-design.md),
границы продукта — в [hand-gesture-control-goal.md](./hand-gesture-control-goal.md),
сравнение open-source трекеров — в [hand-gesture-control.md](./hand-gesture-control.md).

## 1. Что сделано

| Слой | Файлы | Что |
|---|---|---|
| Домен | `ui/src/domain/gesture/` | Признаки из 21 точки, фильтр 1 €, детектор жестов с гистерезисом, маппинг осей, квантование к циклу |
| Инфраструктура | `ui/src/infrastructure/gesture/` | Камера + MediaPipe HandLandmarker, конфиг delegate, калибровка близко/далеко |
| Инфраструктура (аудио) | `ui/src/infrastructure/audio/liveParams.ts` | Живой DSP-путь: применение значения к работающему графу без пере-оценки паттерна |
| Презентация | `ui/src/presentation/state/gestureStore.ts`, `panels/GesturePanel.tsx` | Мост capture → признаки → фильтр → жест → параметр; панель настроек |

Тесты: 76 целевых (9 файлов) + полный гейт репозитория (2004 теста).

## 2. Ключевое техническое решение: живой DSP-путь

Текстовая подмена `.gain(X)` в score (`ui/src/application/useCases/injectMix.ts:45`)
перекомпилирует паттерн и меняет его в планировщике — при кадровой частоте
(30–60 значений в секунду) это неприменимо. Поэтому добавлен отдельный путь:

```
AudioEngine.setLiveParam({ scope, param, value, rampMs })
  → LiveParamController.set()
  → superdough output.destinationGain (GainNode)
  → setTargetAtTime(value, now, rampMs/1000/3)
```

`setLiveParam` — **опциональный** член интерфейса `AudioEngine`
(`ui/src/domain/services.ts`), поэтому существующие тест-дубли и моки
продолжают компилироваться без правок.

Найдено в superdough 1.3.0: `SuperdoughOutput` = `channelMerger → destinationGain
→ audioContext.destination` (`node_modules/superdough/superdoughoutput.mjs:132-174`),
а `getSuperdoughAudioController()` (`superdough.mjs:321`) даёт доступ к живому
мастер-узлу.

Тонкость, учтённая в коде: `getSuperdoughAudioController()` создаёт контроллер
на **своём** AudioContext, если контекст не задан. Поэтому мастер-узел
резолвится только после `primeSuperdoughAudio()` (`LiveAudioEngine.ts:642`),
иначе звук ушёл бы в одноразовый контекст.

Сглаживание: `setTargetAtTime` с `timeConstant = rampMs / 1000 / 3`. Сброс
параметров — рампом 60 мс, мгновенный скачок даёт щелчок.

## 3. Что реально слышно сегодня

| Параметр | Состояние | Почему |
|---|---|---|
| `gain` (громкость) | **Работает** | Мастер-GainNode superdough доступен глобально |
| `cutoff`, `hcutoff` | Принимается, клампится, не применяется | Per-voice FX superdough (`connectBusModulator`, `superdough/modulators.mjs:145`) глобально недоступны |
| `room` | То же | То же |
| `speed` | То же | То же |
| `pitch` | Только UI | Ноты в Strudel не имеют глобального узла; понятие «высоты» живёт в слое паттерна |
| `pan` | Только UI | Не входит в `LiveParamName` — нет глобального панорамного узла |

То есть **реально управляет звуком только громкость**. Остальные оси
подготовлены технически: значения валидируются, клампятся в безопасные
диапазоны (gain 0–1.5, cutoff/hcutoff 20–20000, room 0–1, speed 0.25–4) и
уйдут в звук без изменения кода жестов, как только появится доступ к
per-voice FX.

`LiveParamScope = 'layer'` — задокументированный безопасный no-op: в superdough
один глобальный выход, слои существуют только внутри строки паттерна.

## 4. Трекер

MediaPipe Tasks Vision 1.2.3 (Apache-2.0), `HandLandmarker` в режиме `VIDEO`.

- Модель `hand_landmarker.task` (7 819 105 Б, sha256 `fbc2a300…7cde1`) лежит
  в git: `ui/public/models/`.
- wasm (≈29 МБ) генерируется из `node_modules` скриптом
  `scripts/sync-mediapipe-assets.mjs` (`npm run sync:mediapipe`, вызывается в
  `predev`/`prebuild`), каталог `ui/public/mediapipe/` — в `.gitignore`.
- Никаких внешних origin'ов: и модель, и wasm раздаются с того же хоста.
  Правки Caddy не требуются.
- Delegate выбирается по замеру, по умолчанию `CPU`: на Pixel 6 для
  Gesture Recognizer GPU медленнее (20.87 мс против 16.76 мс).
- `detectForVideo` вызывается со строго возрастающими timestamp'ами; в rAF
  пропускаются кадры, если `video.currentTime` не изменился.

Камера **не включается на старте приложения** — только по тумблеру в панели.

## 5. Жесты и оси

Распознаются: `pinch` (щипок), `openPalm` (ладонь), `fist` (кулак),
`pointUp` (указание вверх), `snap` (щелчок).

Непрерывные оси: высота (близко/далеко до камеры, нормализуется по размеру
ладони — 4…20 см) и крен ладони. Фильтр 1 € (Casiez et al., CHI 2012) с
настраиваемыми `minCutoff`/`beta`, deadzone 0.02, кривые `linear`/`log`/`exp`.

Потеря руки → параметры замораживаются; >1.5 с без руки → плавный возврат
к нейтрали (не резкий сброс).

Ритм квантуется к доле 1/8 цикла (`TERM_DIVISION = 8`), lookahead 120 мс;
событие переносится **вперёд**, а не опаздывает, чтобы не сбивать сетку.

## 6. Доступ к панели

Кнопка «✋ руки» в панели микрофона (`ui/src/presentation/components/MicPanel.tsx:277`)
→ `openKindSheet('gesture', 'half')` → bottom sheet `kind="gesture"`.

Отдельный таб сознательно **не** добавлялся: это сломало бы зен-раскладку
и e2e-тесты раскладки.

## 7. Тесты

```
cd ui
npx vitest run src/domain/gesture src/infrastructure/gesture \
  src/infrastructure/audio/liveParams.test.ts \
  src/presentation/state/gestureStore.test.ts \
  src/presentation/panels/GesturePanel.test.tsx
```

Фикстуры landmark-ов в `ui/src/domain/gesture/fixtures/handFixtures.ts`
синтетические — при реальном тестировании их нужно заменить записанными
данными.

## 8. Что не сделано

- Бенчмарк-скрипт латентности (`scripts/bench/hand-latency.ts`).
- e2e через Chromium fake-camera (`--use-file-for-fake-video-capture`).
- Авто-выбор delegate по замеру — сейчас только ручной выбор.
- Персистентность калибровки (живёт в памяти).
- Доступ к per-voice FX superdough → без него слышна только громкость.
- Режим терминовки в части записи ритма: различение и клавиши есть,
  запись в сетку — нет.

## 9. Открытые вопросы

1. **Формат фиксации решения** — math-coding гейт в репозитории неработоспособен
   (upstream v5.0.0 удалил форматы v3/v4; edge-релиз 3.7 отдаёт 404), поэтому
   решение зафиксировано документацией, а не файлом `decisions/*.yaml`.
2. **Первый набор жестов** — предлагается щипок / ладонь / кулак / указание вверх.
3. **Первая непрерывная ось для MVP** — предлагается высота.
4. **Режим терминовки** — входит ли в MVP или в отдельную фазу.
