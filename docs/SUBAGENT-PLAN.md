# SUBAGENT-PLAN.md — параллельное выполнение 8 пакетов Phase 5

> Операционный handoff. Каждый пакет в `math/<name>/packet.md` —
> архитектурная спецификация. Этот документ говорит субагенту
> «какие файлы трогать, какие тесты добавить, какие критерии приёма».
> Субагент читает ОБА документа: свой packet и свой раздел здесь.

## Конвенция субагентов

- **ID субагента**: `wavecode/<name>` (например `wavecode/transport-panel`).
- **Worktree-first**: каждый субагент работает в отдельном git worktree
  (см. skill `worktree-first`). Имя ветки — `feat/<name>` или
  `feat/wavecode-<name>`.
- **Commit prefix**: `feat(<scope>): <short description>` (Conventional
  Commits).
- **Packet commit prefix**: после реализации коммита
  `feat(<scope>): ...` субагент ОБНОВЛЯЕТ packet.md до статуса
  `applied` (правка YAML `status: applied`) и добавляет
  `witness` файл (см. AGENTS.md). НЕ отдельный «apply commit»
  (CLI сломан; supersession оформляется ручной правкой YAML).
- **При конфликте с master** субагент НЕ force-push'ит, а пишет
  конфликт-резолюцию в `_witness.notes` рядом с packet.
- **Финальный шаг каждого субагента**: `cd ui && pnpm run lint &&
  pnpm run typecheck && pnpm run test:run` — все три должны
  проходить без новых warning/error.

## Граф зависимостей

```
┌─────────────────────────────────────────────────────┐
│ Layer A: никаких deps, чисто CSS/config/state        │
│   • pwa-mobile       (#6)                           │
│   • mini-toolbar     (#7)                           │
│   • mobile-single-panel (#8)                         │
└─────────────────────────────────────────────────────┘
                     ↕ параллельно
┌─────────────────────────────────────────────────────┐
│ Layer B: state/reducer extensions, independent        │
│   • multi-undo        (#3) — supersede rollback-…   │
│   • url-sharing       (#5) — добавка dep lz-string   │
│   • transport-panel   (#1) — расширяет AudioEngine   │
└─────────────────────────────────────────────────────┘
                     ↕ параллельно, после Layer A или смешанно
┌─────────────────────────────────────────────────────┐
│ Layer C: shared AudioEngine.ts — последовательно     │
│   • audio-recording   (#2) — recordLive + renderOffline│
│   • track-mixer       (#4) — mixerState + injectMix   │
└─────────────────────────────────────────────────────┘
```

**Параллельны** (можно запускать в 1 wave): #1, #3, #5, #6, #7, #8.
**Последовательны** (один worktree, попарно): #2 → #4 (один
мерж-коммит для AudioEngine.ts; либо три параллельных worktree с
последующим `git merge` через `git-octopus` или руками).

## Master-merge порядок (после субагентов)

1. Layer A (#6, #7, #8) — fast-forward в master.
2. Layer B (#1, #3, #5) — fast-forward в master.
3. Layer C (#2, #4) — `git merge --no-ff` с одним merge-коммитом
   либо поочерёдно.

---

## #1 — wavecode-transport-panel

**Packet**: `math/wavecode-transport-panel/packet.md`
**Files (touch only)**:

| Path | Action |
|---|---|
| `ui/src/domain/services.ts` | extend `AudioEngine` interface +2 methods: `setCps`, `getCycleProgress` |
| `ui/src/infrastructure/audio/LiveAudioEngine.ts` | implement both methods |
| `ui/src/domain/types.ts` | add `transportState: {cps, swing}` to AppState |
| `ui/src/application/reducer.ts` | add `setCps`, `toggleSwing` events |
| `ui/src/application/useCases/evalWithTransport.ts` | new — pure: `evalWithTransport(score, transport) → string` applies `.swing()` if toggle on |
| `ui/src/presentation/state/transportState.ts` | new — signals: cps, swing, debounced reducer sync |
| `ui/src/presentation/components/TransportPanel.tsx` | new — UI with cps slider, bpm indicator, swing btn, RAF-playhead |
| `ui/src/App.tsx` | render `<TransportPanel />` in `.app-controls-row` |
| `ui/src/index.css` | `.transport-panel`, `.bpm-indicator`, `.playhead` |
| `ui/src/presentation/state/audioActions.ts` | `evalScore()` → chain через `evalWithTransport()` |

**Tests**:
- vitest: `evalWithTransport.test.ts` — pure fn, swing on/off
  idempotency; reducer `setCps`/`toggleSwing` events.
- vitest: `transportState.test.ts` — debounce sync.
- vitest (live AudioEngine mocks): skipped (LiveAudioEngine — effect,
  testing через `pnpm test:e2e`).

**Acceptance**:
- CPS slider двигается 0.05–2.0, audio реально меняет tempo.
- BPM индикатор пересчитывает `60·cps·2`.
- Swing toggle добавляет shuffle feel к playback (audit на preset
  `Creep`).
- Playhead равномерно движется RAF-цикл.
- ИИ-edit score не задевает transport-state (выключен swing,
  score без `.swing()`).
- `pnpm lint && pnpm typecheck && pnpm test:run` clean.

---

## #2 — wavecode-audio-recording

**Packet**: `math/wavecode-audio-recording/packet.md`
**Files**:

| Path | Action |
|---|---|
| `ui/src/domain/audio/wavEncoder.ts` | new — `audioBufferToWav(buf) → Uint8Array` 16-bit PCM |
| `ui/src/infrastructure/audio/AudioRecorder.ts` | new — `LiveRecorder` class wrapping MediaRecorder |
| `ui/src/infrastructure/audio/OfflineRender.ts` | new — `renderToWav(snippet, cycles, cps) → Promise<Blob>` chunked |
| `ui/src/domain/services.ts` | extend AudioEngine +2 methods: `recordLive`, `renderOffline` |
| `ui/src/infrastructure/audio/LiveAudioEngine.ts` | implement both |
| `ui/src/presentation/components/RecordButton.tsx` | new — toggle + modal «Render offline» |
| `ui/src/App.tsx` | render button |
| `ui/src/index.css` | `.record-modal` |

**Tests**:
- vitest: `wavEncoder.test.ts` — synthetic AudioBuffer fixture →
  round-trip decode (basic RIFF header parse).
- vitest: `MediaRecorder` mock не нужен — covered manual QA + e2e.
- playwright: 1 spec — click record on preset, wait 2s, stop, expect
  download event with correct mime (webm/mp4 by platform).

**Acceptance**:
- Live recording downloads Blob with `audio/webm;codecs=opus`
  (Chrome) или `audio/mp4` (Safari).
- Offline render downloads `.wav`, file plays in `ffprobe`.
- Progress modal не блокирует UI между chunks.
- На iOS Safari limitation задокументирована (iOS background →
  запись обрывается, нужно PWA; см. Notes в packet).

---

## #3 — wavecode-multi-undo

**Packet**: `math/wavecode-multi-undo/packet.md`
**Files**:

| Path | Action |
|---|---|
| `ui/src/domain/types.ts` | remove `scorePrev`; add `history: string[]` (max 50), `future: string[]` (max 50) |
| `ui/src/application/reducer.ts` | `replaceScore` push to history, clear future; add `undoScore`/`redoScore` events; add `commitHistoryCheckpoint` |
| `ui/src/application/reducer.test.ts` | rename rollback cases → undo/redo; add 600ms grouping test |
| `ui/src/presentation/state/uiState.ts` | install keyboard shortcuts: Ctrl+Z undo, Ctrl+Y/Ctrl+Shift+Z redo |
| `ui/src/presentation/state/editorTypingTracker.ts` | new — debounce 600ms typing tracker |
| `ui/src/App.tsx` | swap `↶ Откатить` → `↶ Undo` + `↷ Redo`, both disabled по history.length/future.length |
| `math/rollback-and-retry/packet.md` | edit YAML, добавить `supersession: math/wavecode-multi-undo/` |
| `math/rollback-and-retry/witness` | **НЕ удалять** — applied остаётся applied, но superseded |

**Tests**:
- vitest: `reducer.test.ts` — undo/redo symmetry, history cap 50
  (push 51-й → oldest отпадает), future cleared on new replace,
  commitHistoryCheckpoint merges with top.
- vitest: `editorTypingTracker.test.ts` — debounce 600ms groups edits.

**Acceptance**:
- Ctrl+Z отменяет typing burst (grouped), Ctrl+Y возвращает.
- Новая правка на пустом future очищает future (как VSCode).
- IDB load: history пуст, current score загружается.
- Single-rollback кнопка полностью удалена; если юзер жмёт «откатить»
  в привычном месте — открывается undo через `↶` или по Ctrl+Z.

---

## #4 — wavecode-track-mixer

**Packet**: `math/wavecode-track-mixer/packet.md`
**Files**:

| Path | Action |
|---|---|
| `ui/src/domain/layers/parseStack.ts` | new — pure fn `parseStackTopLayers(score) → LayerDescriptor[]` |
| `ui/src/domain/types.ts` | add `AppState.layerMix: LayerMix[]` |
| `ui/src/application/useCases/injectMix.ts` | new — pure fn `injectMix(score, layerMix) → string` |
| `ui/src/application/reducer.ts` | add `setLayerGain`, `toggleLayerMute`, `toggleLayerSolo`, `setLayerCount` events |
| `ui/src/presentation/state/transportState.ts` (shared with #1 — separate file if conflict) | signals mixer, debounced reducer sync |
| `ui/src/presentation/components/MixerPanel.tsx` | new — vertical list rows |
| `ui/src/presentation/panels/ScorePanel.tsx` | render `<MixerPanel />` под `<MidiIOButtons />` |
| `ui/src/presentation/state/audioActions.ts` | `evalScore()` → `injectMix(score, layerMix)` → eval |
| `ui/src/index.css` | `.mixer-row`, `.mixer-mute`, `.mixer-solo`, `.mixer-gain` |

**Tests**:
- vitest: `parseStack.test.ts` — simple stack, nested stack, plain
  pattern (1 layer), score with multi-line continuation.
- vitest: `injectMix.test.ts` — gain replacement, mute wrapping,
  solo cascade (any soloed → others muted), `layerMix.length != count`
  reconciliation.

**Acceptance**:
- Mixer auto-populates when score loaded — 6 layers для Creep.
- Mute одной дорожки глушит её, остальные 5 звучат.
- Solo одной дорожки глушит остальные 5.
- Slider gain 0.5 → 0.3 — заметная разница в громкости.
- Score в IDB без изменений (mixer side-state).
- ИИ-edit score = recreate layers; mixer auto-reconciles.

---

## #5 — wavecode-url-sharing

**Packet**: `math/wavecode-url-sharing/packet.md`
**Files**:

| Path | Action |
|---|---|
| `ui/package.json` | dep `lz-string: ^1.5.0` |
| `ui/src/domain/urlCodec.ts` | new — pure: `encodeSnippet`, `decodeSnippet`, `parseShareUrl` |
| `ui/src/presentation/components/ShareButton.tsx` | new — UI с modal |
| `ui/src/presentation/state/shareState.ts` | new — signals: `shareUrl`, `pendingUrl`, `isLoadingShared` |
| `ui/src/App.tsx` | render `<ShareButton />` |
| `ui/src/main.tsx` | `onMount`: parse `location.search`, override IDB-scoped loadScore |
| `ui/src/index.css` | `.share-modal`, `.share-url` (monospace input) |

**Tests**:
- vitest: `urlCodec.test.ts` — round-trip, large-payload warning, decode
  malformed → throw → safe error message.
- vitest: `parseShareUrl.test.ts` — empty, with `?s=`, with `?s=&t=`,
  with garbage.

**Acceptance**:
- Share URL copied в clipboard, paste в новый tab → score loaded.
- Если IDB не пуст — модалка «Load shared snippet? You have unsaved work».
- Score > 8KB → warning «слишком длинный, экспортируй в .strudel.txt».
- Fallback `execCommand('copy')` если `Clipboard API` не secure.

---

## #6 — wavecode-pwa-mobile

**Packet**: `math/wavecode-pwa-mobile/packet.md`
**Files**:

| Path | Action |
|---|---|
| `ui/package.json` | devDep `vite-plugin-pwa: ^0.20.x` |
| `ui/vite.config.ts` | extend with VitePWA plugin |
| `ui/public/manifest.webmanifest` | new — name, icons, display, theme_color |
| `ui/public/icon-192.png` | new — generated «wc» monogram |
| `ui/public/icon-512.png` | new |
| `ui/public/apple-touch-icon-180.png` | new |
| `ui/index.html` | +4 meta теги + manifest link + apple-touch link |
| `ui/src/index.css` | `body { padding: env(safe-area-inset-*) }` |

**Tests**:
- playwright: 1 spec — navigate to dev preview (no SW in dev), на
  production build проверить `manifest` parses и `apple-touch-icon`
  link exists. SW behavior tested manual.

**Acceptance**:
- Production build: `<link rel="manifest">` resolves 200.
- iOS Safari «Add to Home Screen» даёт fullscreen.
- Service worker registers, precaches initial bundle.
- Lighthouse PWA score ≥ 90 (manual score в CI не запускаем).

---

## #7 — wavecode-mini-notation-toolbar

**Packet**: `math/wavecode-mini-notation-toolbar/packet.md`
**Files**:

| Path | Action |
|---|---|
| `ui/src/presentation/components/MiniNotationToolbar.tsx` | new — Solid компонент + buttons grid |
| `ui/src/presentation/components/CodeMirrorEditor.tsx` | expose `getView(): EditorView` через callback prop |
| `ui/src/presentation/panels/ScorePanel.tsx` | render `<MiniNotationToolbar />` |
| `ui/src/index.css` | `.mini-toolbar` (sticky, visualViewport-aware), `.mini-toolbar-btn` |
| `ui/src/main.tsx` (optional) | register visualViewport listener |

**Tests**:
- playwright: 1 spec — set viewport 375×667, focus editor, tap toolbar
  button `note(`, expect doc has `note(` в cursor.
- visualViewport positioning — manual QA (iPhone).

**Acceptance**:
- Toolbar visible только на mobile breakpoint (≤720px).
- Tap каждой кнопки вставляет snippet в cursor.
- Selected range → replaced; no selection → inserted at cursor.
- Editor сохраняет focus после tap.
- `view.dispatch` не дропает undo history.

---

## #8 — wavecode-mobile-single-panel

**Packet**: `math/wavecode-mobile-single-panel/packet.md`
**Files**:

| Path | Action |
|---|---|
| `ui/src/presentation/state/uiState.ts` | `loadState` honors `window.matchMedia('(max-width: 720px)')` if no explicit pref; add `setMobileMode`, `getMobileMode` |
| `ui/src/App.tsx` | add `📱` toggle в header, mini-menu с 3 опциями |
| `ui/src/index.css` | extended `@media (max-width: 720px)` |

**Tests**:
- playwright: 2 specs — (a) viewport 375×667, reload, AI/Status
  collapsed. (b) toggle to «compact», change localStorage, reload → still compact.

**Acceptance**:
- First load на ≤720px — Score full, AI/Status collapsed.
- Юзер может переопределить toggle-button (📱 меню).
- localStorage override побеждает matchMedia detection.
- Desktoptest (1280) → default все 3 панели.

---

## Общие критерии приёма для всех 8 субагентов

Перед merge субагент ОБЯЗАН:

1. Прочитать `packet.md` своего пакета + свой раздел здесь.
2. Реализовать в своём worktree (`feat/<name>`).
3. `cd ui && pnpm run lint && pnpm run typecheck && pnpm run test:run` — всё clean.
4. Добавить e2e spec если пакет его требует (`pnpm run test:e2e` локально,
   см. `ui/playwright.config.ts` — WebKit проект НЕ добавлять, политика).
5. Обновить `packet.md`: YAML `status: applied` + добавить
   `witness` файл с `- sha: <commit>` + `- kind: creation` + файлы
   + notes (см. `math/wavecode-fur-elise-preset-accuracy/witness` для шаблона).
6. `git push origin feat/<name>` — не merge, ОЖИДАНИЕ human approval.
7. Сообщить в чат: «✅ <name> applied @ <sha>» + output последнего
   `pnpm run typecheck`/`test:run`.

**Запрещено**:
- Force-push в master.
- Менять файлы в scope другого субагента (видим конфликт — пишем
  в `_witness.notes` и стучим).
- Добавлять deps без явного упоминания в packet.md.
- Менять архитектурные инварианты (см. PLAN.md §5).
- Менять `playwright.config.ts` для добавления WebKit проекта.

---

## Если субагент нашёл коллизию

Пример: `#1 transport-panel` уже добавил `transportState.ts`, а
`#4 track-mixer` хочет shared signals. Решение:

1. Один из них рефакторит свои signals в `presentation/state/
   playState.ts` (общая зона).
2. Другой импортит из общего модуля.
3. Конфликт разрешается **до merge** в master через rebase; при
   невозможности — субагент-«позже» адаптирует интерфейс.
4. Если нельзя — фиксируется в `_witness.notes` и решает author.

## Готовность к старту

Все 8 packet.md — `status: draft`. После approval Phase 5 в PLAN.md
запускаются 8 субагентов в worktree'ах согласно графу зависимостей.
Субагент сам читает свой пакет + свой раздел SUBAGENT-PLAN.md,
реализует, коммитит, ждёт approval на merge.
