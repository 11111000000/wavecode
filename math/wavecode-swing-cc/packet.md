---
proposition: |
  Swing в Transport Panel расширяется с boolean toggle до полного
  amount/divisor control: `transportState.swingAmount: number` (0..1,
  default 0.5 для стандартного shuffle) + `transportState.swingDivisor`
  (default 1/8). UI: range slider 0..1 (step 0.01) + select
  (1/4, 1/8, 1/16). `evalWithTransport` применяет
  `.swing(amount, divisor)` если swingAmount > 0 (раньше
  было `swing: boolean` → hardcoded `.swing(0.5, 1/3)`). Старая
  boolean-логика сохраняется: `swing: true` интерпретируется как
  `swingAmount: 0.5, swingDivisor: 1/8` для backward-compat.
antithesis: |
  (1) «Hardcoded 0.5/1/3 — норм, не надо усложнять». Возражение: профи
    хотят контроля над swing-amount (1/3 = триоль, 1/8 = sixteenth)
    и divisor (1/4 = quarter-note shuffle). 0.5/1/3 — одна точка в
    2D-пространстве; pros хотят весь квадрант. (2) «Swing это
    per-track, не global». Возражение: per-track swing = scope creep;
    global — 95% use-case, per-track можно добавить позже. (3)
    «Backward-compat сломает существующие пресеты». Возражение: default
    `swingAmount: 0` (off); migration: если `swing: true` в старых
    данных, читаем как `swingAmount: 0.5` на load. (4) «Slider будет
    дёргать eval каждый кадр». Решение: debounce 100ms (уже есть в
    transportState для cps).
synthesis: |
  Swing становится full numeric control вместо boolean toggle.
  TransportPanel: slider 0..1 + divisor select (1/4, 1/8, 1/16,
  1/3 — триоль). evalWithTransport строит Strudel-выражение:
    `.swing(${amount}, ${divisor})` если amount > 0.
  State shape: `swing: boolean` retire'd → `swingAmount: number`,
  `swingDivisor: string` (e.g. '1/8'). default `0` (off).
  UI: один slider + один select inline, не модал. Mobile-friendly
  (slider ≥44px tall, select full-width).
  State persist в appStore (через existing createEffect autosave
  в IDB) — slider position сохраняется между сессиями.
substrate: |
  + `domain/types.ts`: `TransportState.swing: boolean` retire,
    `TransportState.swingAmount: number` (0..1) +
    `TransportState.swingDivisor: string` (default '1/8').
  + `application/useCases/evalWithTransport.ts`: branch on
    `state.swingAmount > 0` → append `.swing(${amount}, ${divisor})`.
  + `application/reducer.ts`: `AppEvent.setSwingAmount {amount}` +
    `AppEvent.setSwingDivisor {divisor}`. Retire `toggleSwing`.
  + `presentation/state/transportState.ts`: signals + debounced
    dispatch (100ms).
  + `presentation/components/TransportPanel.tsx`: slider + select
    в swing-row. Disable slider when swingAmount=0 (greyed).
  + `presentation/components/TransportPanel.test.ts`: amount=0
    → no .swing() в output, amount=0.5 → .swing(0.5, 1/8).
  + `index.css`: `.transport-swing-row` flex row, slider+select
    inline, mobile @media (full-width).
status: applied
axiom: A1
witness:
  applied_at: 2026-10-09
  commit: pending
  supersedes: null
epistemics:
  - statement: "Strudel `.swing(amount, divisor)` — стандартный
      shuffle; `amount=0.5` даёт триольный shuffle 8-х"
    marker: fact
    evidence: "Strudel docs: `swing(value, divisor)` — `value` ∈ [0,1]
      shuffle amount, `divisor` для базовой доли (1/4, 1/8, 1/3)"
  - statement: "Backward-compat migration: `swing: true` →
      `swingAmount: 0.5` (default divisor `1/8`)"
    marker: judgment
    evidence: "current TransportPanel `useTransportState` читает
      `appStore.transportState.swing` как boolean — для migration
      ставим `useMemo(() => swing ? 0.5 : 0, [swing])`"
  - statement: "Debounce 100ms на slider change — standard для UI
      audio control (Web Audio API doesn't lock on each call)"
    marker: fact
    evidence: "Web Audio API: `cps` change is cheap; no audible
      artifacts from < 200ms updates"
  - statement: "Default swingAmount=0 (off) → existing presets
      (Creep, Seven Nation Army, etc.) play unchanged"
    marker: fact
    evidence: "Strudel evalWithTransport: `if (amount > 0) wrap()`
      branch — bypass для default case"
---
