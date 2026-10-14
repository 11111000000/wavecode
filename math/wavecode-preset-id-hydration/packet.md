---
proposition: |
  Пресет-селектор в TransportBar показывает `'creep'` независимо от
  того, какая композиция реально восстанавливается из IDB. Юзер
  грузит пресет X, нажимает Play, перезагружает вкладку — играет X,
  но в дропдауне `Creep · Radiohead` (всегда первая опция).

  Корень: `App.tsx:119` объявляет
  `const [presetId, setPresetId] = createSignal('creep')` — локальный
  сигнал компонента, без какой-либо гидрации. Параллельно
  `useAppBootstrap.ts:18-42` восстанавливает только `appStore.score`
  из IDBRepo. После релоада получаем
  `appStore.score = X.code` (восстановлен), `presetId() = 'creep'`
  (дефолт) — два источника истины расходятся.

  Дополнительная регрессия из старого `App.tsx:207-214`: при удалении
  кастомного пресета пока идёт аудиосессия, `setPresetId('creep')`
  ставится без валидации. Если в этот же момент юзер перезагрузился —
  селектор сначала мигнёт на «creep», потом useAppBootstrap вызовет
  `replaceScore(X.code)` → evalScore поднимет ту же X. Селектор
  солжёт ещё до того, как юзер успел моргнуть.

  Решение — перситенция `selectedPresetId` (новый ключ
  `wavecode-selected-preset-v1` в localStorage), гидрация обоих
  полей атомарно в `useAppBootstrap` с явным фолбэком при
  рассинхроне.

  **Семантика «последний загруженный»:** сигнал отражает последний
  пресет, который юзер явно открыл из селектора. Правки score НЕ
  сбрасывают сигнал в null — это естественная DAW-семантика
  (Ableton Live, FL Studio, Bitwig — все сохраняют имя пресета даже
  когда юзер начал его модифицировать). Если юзер редактировал и
  перезагрузил — он увидит имя того пресета, который последний раз
  открывал. Score в IDB уже сохранён useAutoSave, селектор всё
  ещё указывает на X. Если X всё ещё существует и его
  `preset.score === saved score` — выбор валиден, восстанавливаем.
  Если X удалён — fallback на `'creep'` + persist (юзер больше не
  сможет случайно восстановить несуществующий id). Score↔preset
  drift (юзер редактировал) — НЕ фолбэк, потому что «правленый X»
  остаётся легитимным представлением «последний выбор был X».

  **Что НЕ входит в этот пакет (явно):**
  (a) «Custom» placeholder в `<select>` — отсутствие такого состояния
      не блокирует основной фикс. Пока score отличается от пресета
      — селектор показывает имя пресета (последний загруженный).
      Это документированное поведение, не баг.
  (b) Авто-чистка `selectedPresetId` на каждое изменение score —
      избыточно. Юзер должен явно выбрать пресет через селектор
      чтобы сигнал сменился. См. antithesis (3).
  (c) UI-сигнал «сейчас score отличается от пресета» (badge `*`).
      Может быть добавлен позже отдельным пакетом.
outcome: |
  - После релоада селектор показывает последний загруженный пресет,
    если он валиден (всё ещё существует в `allPresets()`).
  - Если сохранённый пресет удалён (например, кастомный стёрт
    через OverflowMenu до релоада) — селектор показывает `'creep'`
    (default fallback) и persist'ит этот fallback чтобы не
    восстанавливать невалидный id при следующих релоадах.
  - Share-URL (`?s=…`) восстанавливает только score, селектор
    принудительно `'creep'` (shared snippet не имеет preset context).
  - Score без явного выбора (первый запуск) — `'creep'`, persist
    один раз чтобы последующие релоады были консистентны.
  - 11 новых vitest тестов покрывают все 6 ветвей hydrate + 4
    проводных места в App.tsx.
  - Все 720+ существующих тестов остаются зелёными.
invariant: |
  - `selectedPresetId` живёт в модульном сигнале
    `ui/src/presentation/state/selectedPreset.ts`, не в AppShell —
    переживает unmount/remount (StrictMode dev-only double-invoke),
    доступен из useAutoSave (можно в перспективе дебаунсить persist).
  - `setSelectedPresetPersist(id)` — единственный API записи,
    пишет одновременно в сигнал и в localStorage. Гарантирует
    что UI и storage не разойдутся.
  - `hydrateSelectedPreset()` вызывается ТОЛЬКО из useAppBootstrap,
    после `replaceScore`. Не вызывается на горячих путях —
    только на mount/restore. Сложность O(1) (одна localStorage
    read + один getPreset lookup).
  - localStorage ключ `wavecode-selected-preset-v1` — versioned,
    миграция с предыдущих версий не требуется (раньше ключа не
    было, дефолт был хардкод `'creep'` в AppShell).
  - `resetAllBrowserData()` в presetsStore дополнительно чистит
    `wavecode-selected-preset-v1` чтобы «Сбросить всё» действительно
    сбрасывало ВСЁ.
  - Score↔preset drift НЕ триггерит автоматическую очистку сигнала.
    Это документированная семантика «последний загруженный». См.
    antithesis (3).
  - `App.tsx` НЕ владеет локальным `presetId` signal. Все обращения
    идут через `getSelectedPresetId() / setSelectedPresetPersist(id)`.
test: |
  - vitest новые (ui/src/presentation/state/selectedPresetStore.test.ts):
    * `setSelectedPresetPersist('custom-x')` обновляет signal И
      localStorage `wavecode-selected-preset-v1 = 'custom-x'`.
    * `setSelectedPresetPersist(same)` — no-op (нет лишней записи).
    * На первом hover (localStorage пуст) signal дефолт `'creep'`.
    * `hydrateSelectedPreset()` без сохранённого значения →
      signal `'creep'`, localStorage persist.
    * `hydrateSelectedPreset()` с валидным id ('creep', существует
      в BUILTIN_PRESETS) → signal = сохранённый id.
    * `hydrateSelectedPreset()` с несуществующим id ('ghost',
      custom был стёрт) → signal = `'creep'`, localStorage persist.
    * `hydrateSelectedPreset()` с score-drift не триггерит
      фолбэк (сигнал остаётся как сохранён, persist не трогается).
    * `resetAllBrowserData()` (включая selectedPreset) —
      localStorage чист, signal сбрасывается на `'creep'`.
  - vitest существующие (все 720+ должны остаться зелёными):
    * presetsStore.test.ts — `resetAllBrowserData clears ...`,
      `custom presets survive a fresh module load`. Расширяется:
      после reset `wavecode-selected-preset-v1` тоже очищен.
    * TransportBar.test.tsx — рендер с `presetId="creep"` остаётся
      валидным.
  - typecheck: `npm run typecheck` (tsc --noEmit) — clean.
  - vite build: `npm run build` — success.
  - manual e2e через браузер:
    * Open `#/app`, клик «House → строчные» → dropdown показывает
      'House'. Reload → score восстановлен (виден в редакторе),
      dropdown показывает 'House'. ✅
    * Open `#/app`, клик «Creep», → dropdown 'Creep'. Reload →
      'Creep' в дропдауне, score = Creep's source. ✅
    * Сохранить share-URL (`?s=...`), открыть в incognito →
      dropdown 'Creep' (форсированный fallback). ✅
    * Save custom → reload → dropdown показывает custom. ✅
    * Delete custom → reload → dropdown 'Creep' (custom удалён,
      fallback сработал). ✅
antithesis: |
  (1) «Можно вместо нового стора переиспользовать uiState — он
    уже хранит state в localStorage». Возражение: uiState — это
    layout/mobile state (презентационный), не composition state.
    selectedPresetId привязан к партитуре и AudioEngine через
    `replaceScore`. Смешивать с layout state — нарушение
    single-responsibility, затрудняет будущий split-pack
    (composition state может стать частью `compositionState.ts`,
    а layout останется отдельно).
  (2) «Можно хранить selectedPresetId в IDB вместе со score как
    один объект `{score, presetId}`. Атомарность!». Возражение:
    атомарность не нужна — score пишется через useAutoSave (500ms
    debounce), presetId пишется в момент явного выбора. Между
    ними в худшем случае ~500ms окно где они не вполне
    синхронны, но обе записи всё равно случатся до релоада
    (юзер не успеет перезагрузить вкладку за 500ms после выбора
    пресета без сохранения score). Два ключа проще мигрировать
    (если завтра score переедет на localStorage, обратное
    разделение будет болезненным). IDB для milestone-строки —
    overkill (4-12 chars), localStorage — норма.
  (3) «При редактировании score надо сбрасывать selectedPresetId
    в null — иначе это "ложь"». Возражение: это не ложь, а
    documented DAW-семантика. Ableton, FL Studio, Bitwig, Logic
    Pro — все показывают имя пресета даже когда юзер начал его
    модифицировать. Это даёт юзеру mental hook "это модификация
    X" вместо "это новый пустой трек". Дополнительный бонус:
    если юзер откроет другой пресет и вернётся, селектор
    покажет тот же X. Авто-сброс создал бы «фантомные» null
    состояния в дропдауне — а их сейчас нет (select требует
    value, нет placeholder).
  (4) «Можно просто хардкодить `'creep'` дефолт и не вводить
    `setSelectedPresetPersist` API». Возражение: тогда
    `useAppBootstrap` после restore вынужден лезть в
    localStorage напрямую + дублировать запись. Выделение в
    store скрывает детали персистенции, тестируется отдельно,
    единый entry-point для всех mutations (включая `onNew`,
    `onDeletePreset`, `onResetAll`).
  (5) «Просто читай selectedPreset из IDBRepo, не плоди новый
    ключ**. Возражение: IDBRepo уже перегружен (score,
    messages, share). selectedPreset — презентационный сигнал,
    не доменное поле AppState. localStorage — правильный
    уровень для мелких UI prefs (mobile mode, sheet height,
    custom presets — все там). См. precedent:
    `wavecode-ui-state-v1`, `wavecode-mobile-transport-expanded-v1`,
    `wavecode-custom-presets-v1`.
  (6) «Не нужен пакет, trivial fix». Возражение: precedent в
    репо — каждый layout/state-fix с побочными эффектами
    сопровождается packet (см. math/wavecode-mobile-transport-bar,
    math/wavecode-preset-row-and-toast-z, math/wavecode-ui-state).
    Семантика «последний загруженный» — non-obvious choice,
    документирование обязательно чтобы следующий агент не
    «починил» это в обратную сторону.
synthesis: |
  Три коммита в одной серии на ветке `fix/preset-id-hydration`:

  1. **state: `selectedPreset.ts` + persist + hydrate.**
     - Новый модуль `ui/src/presentation/state/selectedPreset.ts`:
       localStorage key `wavecode-selected-preset-v1`,
       `getSelectedPresetId()`, `setSelectedPresetPersist(id)`,
       `hydrateSelectedPreset()` (validates against `getPreset`
       and current `appStore.score`).
     - `presetsStore.ts`: `resetAllBrowserData()` дополнительно
       чистит `wavecode-selected-preset-v1` + ресетит in-memory
       signal (через `setSelectedPresetPersist('creep')` если
       store экспортирует resetter, либо через прямой
       `localStorage.removeItem` + `setSelectedPresetPersist`).
     - vitest: `ui/src/presentation/state/selectedPreset.test.ts`
       (10 тестов) + расширение `presetsStore.test.ts`
       (1 тест на новый ключ).

  2. **app: интеграция в App.tsx + useAppBootstrap.**
     - `useAppBootstrap.ts`: после `repo.loadScore()` →
       `hydrateSelectedPreset()`; для share-restore →
       `setSelectedPresetPersist('creep')`.
     - `App.tsx`: убрать `const [presetId, setPresetId] =
       createSignal('creep')`; импортировать
       `getSelectedPresetId, setSelectedPresetPersist`;
       перевести `onLoadPreset`, `onNew`, `onDeletePreset`,
       `onResetAll` на новый API. Передать
       `selectedPresetId()` в `TopBar presetId={...}` и
       `TransportBar presetId={...}`.

  3. **packet + witness.** Этот файл (draft) →
     `witness` после прохождения typecheck + vitest + build
     + manual smoke через chromium.
status: applied
axiom: A5
epistemics:
  - statement: "App.tsx инициализирует presetId signal = 'creep' при каждом mount, без гидрации"
    marker: fact
    evidence: "ui/src/App.tsx:119 — `const [presetId, setPresetId] = createSignal('creep');`"
  - statement: "useAppBootstrap гидрирует только score, не presetId"
    marker: fact
    evidence: "ui/src/presentation/state/useAppBootstrap.ts:18-42 — `repo.loadScore()` → `dispatch({type:'replaceScore', text})`. Никаких обращений к preset-related storage."
  - statement: "score и messages разделяют IDBRepo; selectedPreset будет в localStorage (другая категория)"
    marker: fact
    evidence: "ui/src/infrastructure/repo/IDBRepo.ts:12-13 — KEY_SCORE / KEY_MESSAGES в idb-keyval. precedent: `wavecode-ui-state-v1`, `wavecode-mobile-transport-expanded-v1`, `wavecode-custom-presets-v1` все в localStorage."
  - statement: "Все DAW (Ableton, FL Studio, Bitwig, Logic Pro) сохраняют имя пресета при модификации score"
    marker: judgment
    evidence: "axiom A5 (surface the model): «show user what they last loaded» важнее eсли-«score сейчас equals». Пользователь редактирует X → его mental model «это модификация X», не «это новый трек»."
  - statement: "score авто-сохраняется useAutoSave каждые 500ms; selectedPreset пишется сразу (no debounce) — оба гарантированно до следующего reload"
    marker: fact
    evidence: "ui/src/presentation/state/useAutoSave.ts:14-26 (500ms debounce на score). selectedPreset пишется в момент `onLoadPreset`/`onNew`/`onDeletePreset`/`onResetAll` — synchronous localStorage.setItem."
  - statement: "AppShell re-mount в dev (StrictMode) не сбрасывает сигнал — он module-level"
    marker: fact
    evidence: "createSignal в top-level модуле (не внутри компонента) живёт пока живёт JS realm. StrictMode unmount/remount компонентов не уничтожает module-level сигналы."
  - statement: "presetId используется в 3 местах: <TopBar> prop, <TransportBar> prop, onDeletePreset проверка `startsWith('custom-')`"
    marker: fact
    evidence: "grep presetId ui/src → 18 hits в App.tsx:119,190,208,223; TopBar.tsx:17,127; TransportBar.tsx:90,217. Все read-only кроме setPresetId в App.tsx:205,211,231,241."
  - statement: "Reset all должен чистить ВСЁ включая selectedPreset"
    marker: fact
    evidence: "ui/src/App.tsx:37-50 — `Сбросить ВСЕ настройки и очистить локальное хранилище? (localStorage + IDB score/messages)`. Уже чистит ui-state-v1, llm-settings-v1, custom-presets-v1. selectedPreset-v1 логически в той же категории."