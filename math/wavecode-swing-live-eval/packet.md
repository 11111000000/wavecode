---
proposition: |
  Swing-слайдер в TransportPanel реально влияет на звук во время
  воспроизведения: при изменении `swingAmount` или `swingDivisor`
  выполняется `audio.eval(evalWithTransport(score, transport))` с
  тем же debounce 100ms что у cps. Re-eval запускается только
  если `AudioContext.state === 'running'` (не будит звук от
  простого движения слайдера) и только если обёртка реально
  отличается от последней применённой (`amount` или `divisor`
  изменились). Текущий пакет `wavecode-swing-cc` (applied) описывает
  инфраструктуру (state, UI, wrap-функцию), но не закрывает триггер
  re-eval — этот долг закрывается здесь, без изменения state-shape
  и UI.
antithesis: |
  (1) «cps уже подхватывается через setCps без re-eval, swing тоже
    должен через какой-то hot-swap». Возражение: Strudel API делит
    режимы: `cps` это prop на репле (`repl.setCps(n)` — дешёвый
    hot-swap), а `swing(...)` это оператор паттерна, требует полного
    `repl.evaluate(snippet)`. Hot-swing не существует.
    (2) «Re-eval каждый кадр — слайдер дёргается часто». Решение:
    debounce 100ms в `useTransportAudioSync` (уже есть для cps),
    плюс skip если ни amount ни divisor не изменились.
    (3) «Re-eval с amount=0 → 0 при неактивном аудио запустит звук».
    Решение: гейт по `__wavecodeAudioCtx.state === 'running'` —
    не запускаем звук от простого движения слайдера. evalScore
    (по кнопке Play) — единственная точка инициации звука.
    (4) «Re-eval от slider при работающем Strudel вызовет glitch».
    Возражение: да, каждый `repl.evaluate` кратко рестартует
    scheduler — это фундаментальное свойство Strudel, не баг
    нашего слоя. Пользователь явно тянет swing amount осознанно;
    при дефолтном score без swing часть слайдера неактивна
    (amount=0 → паттерн неизменен → re-eval технически
    идемпотентен, но всё равно skip-аем по gate).
synthesis: |
  `useTransportAudioSync` расширяется вторым `createEffect`,
  подписанным на `swingAmount()` и `swingDivisor()` (из
  `transportState`). Локальный memo `lastEvaluatedSwing:
  { amount, divisor } | null` хранит последнее применённое
  значение. На изменение:
    1. Если новое совпадает с lastEvaluatedSwing → no-op (Solid
       сам не пере-запустит эффект при равенстве, но защищаемся
       от лишних вызовов после double-render / HMR).
    2. Иначе — debounce 100ms, затем проверка
       `__wavecodeAudioCtx.state === 'running'`. Если не running —
       запоминаем новое значение (state persistence) но не eval'им.
    3. Если running — вызываем новый helper
       `reEvalScoreWithTransport()` который делает тот же
       `injectMix + evalWithTransport` что `evalScore`, но без
       `unlockAudioContext()` / `dispatch status: playing`. Если
       eval падает — логируем, status не трогаем (юзер не нажимал
       Play, мы не должны показывать баннер ошибки).
  Тесты:
    + `useTransportAudioSync.test.ts` — мокаем
      `__wavecodeAudioCtx.state` (running/suspended) +
      мокаем AudioEngine.eval через `vi.mock` AppLayer (или
      прямой мок `globalThis.__wavecodeAudioCtx` + effect через
      `installTransportAudioSync`).
    + `audioActions.test.ts` — пополняем на `reEvalScoreWithTransport`.
  State-shape: без изменений. UI без изменений. Migration
  backward-compat: `swingAmount: 0` (default off) → на холодном
  старте lastEvaluatedSwing=null, swing change с amount=0
  пропустится по равенству с дефолтом.
  Пакет-wavecode-swing-cc: остаётся applied как есть; это
  не рефактор пакета — это закрытие долга по triggers.
status: applied
axiom: A2
witness:
  applied_at: 2026-10-13
  branch: fix/swing-live-eval
  commit: pending
  supersedes: null
epistemics:
  - statement: "Strudel различает cps (repl.setCps, hot-swap) и
      swing (pattern operator, требует repl.evaluate)"
    marker: fact
    evidence: "@strudel/webaudio: `repl.setCps(n)` мутирует prop
      на running scheduler; `.swing(amount, divisor)` — это
      метод на Hap/Pattern, требует перепарсинга score через
      `repl.evaluate(snippet)`"
  - statement: "useTransportAudioSync уже подписан только на cps()
      — swing signal не наблюдается ни одним эффектом"
    marker: fact
    evidence: "grep 'useTransportAudioSync|createEffect' →
      ui/src/presentation/state/useTransportAudioSync.ts:27 —
      один createEffect, читает только cps()"
  - statement: "Debounce 100ms — стандарт для UI audio control
      (Web Audio API не лочится на каждом вызове)"
    marker: fact
    evidence: "Текущий useTransportAudioSync:15 уже использует
      SYNC_DEBOUNCE_MS = 100; Strudel/SuperCollider-сэмплеры
      переживают <200ms updates без audible artifacts"
  - statement: "__wavecodeAudioCtx создаётся через unlockAudioContext()
      и его state управляется платформой (running/suspended/closed)"
    marker: fact
    evidence: "ui/src/infrastructure/audio/LiveAudioEngine.ts:410,
      421 — get/create __wavecodeAudioCtx, ctx.resume() в eval,
      ctx.suspend() только при явном stop"
  - statement: "evalScore использует тот же wrap-path:
      injectMix + evalWithTransport — re-eval helper может
      переиспользовать без дублирования логики"
    marker: fact
    evidence: "ui/src/presentation/state/audioActions.ts:27-30 —
      `injectMix(score, layerMix)` затем
      `evalWithTransport(mixed, transportState)`"
---
