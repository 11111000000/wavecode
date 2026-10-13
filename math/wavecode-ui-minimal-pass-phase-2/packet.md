---
proposition: |
  Phase 1 (`math/wavecode-ui-minimal-pass`) убрал визуальный шум,
  но оставил две дыры:

  - **TabBar всё ещё 4 таба** (Score, AI, Mixer, Status). После
    Phase 1 Mixer доступен через BottomToolstrip (`Step/Piano/Mixer`),
    так что таб Mixer — дублирование. Для casual-пользователя
    «Mixer» — лишний сигнал «я что-то пропустил». На мобиле 4
    таба — это уже толще, чем в iOS HIG (≤5 рекомендация, но 3
    чище). Phase 2 убирает Mixer таб → 3 таба: Score, AI, Status.

  - **Pulse-анимации работают всегда**, в т.ч. на mobile и для
    юзеров с `prefers-reduced-motion`. Особенно мешает:
    `.wc-admin-warn` (1.6s pulse), `.audio-loading-pill` (1.5s),
    `.skeleton-pulse` (1.2s — удалено в Phase 1, но похожие
    остались), `@keyframes admin-warn-pulse`. На mobile они жрут
    батарею и отвлекают. Phase 2 добавляет `@media (prefers-reduced-
    motion: reduce)` глобально + `prefers-reduced-motion` overrides
    на конкретных анимациях.

  Phase 2 НЕ делает:
    - Объединение `legacy.css` + `components.css` (архитектурный
      долг, но рискованно — много пересекающихся классов, шанс
      тихих регрессий в визуале. Отдельный пакет `wavecode-css-
      consolidate` позже).
    - Bottom-sheet → drawer для Mixer/Step/Piano (Phase 3).
antithesis: |
  (1) «Убрать Mixer из TabBar — потеряем power-user shortcut».
    Возражение: Mixer уже доступен 1-tap в BottomToolstrip
    (`/app` → BottomToolstrip → [Mixer]). Это ровно тот же
    shortcut. Tab'ы в mobile-bottom-nav — для primary navigation,
    Mixer — инструмент, ему место рядом со Step/Piano.
  (2) «Pulse-анимации — это feedback, их отключение ухудшит UX».
    Возражение: pulse — декорация, не сигнал об ошибке.
    Информационная нагрузка pulse'а низкая (юзер уже слышит
    звук ошибки в audio-lastError). Для тех кому нужны
    «указатели» — admin-warn текст в title и `aria-label`.
  (3) «prefers-reduced-motion — это нишевая фича, не нужна».
    Возражение: WCAG 2.1 Success Criterion 2.3.3 (AAA) +
    OS-level setting (iOS Reduce Motion, Android Remove
    Animations). Юзеры с вестибулярными расстройствами это
    ценят. Реализация стоит 3 строки CSS.
synthesis: |
  Три правки в одной серии:

  1. **`ui/src/presentation/components/TabBar.tsx`** (modify):
     убрать `TabMixerIcon` и `mixer` из `ITEMS`. 4 таба → 3.
     TabBar остаётся на мобиле (Score/AI/Status), на десктопе
     скрыт (`@media (min-width: 1024px) { .wc-tabbar { display:
     none; } }` уже есть в components.css).

  2. **`ui/src/styles/base.css` или `ui/src/index.css`** (modify):
     добавить глобальное правило:
     ```css
     @media (prefers-reduced-motion: reduce) {
       *, *::before, *::after {
         animation-duration: 0.01ms !important;
         animation-iteration-count: 1 !important;
         transition-duration: 0.01ms !important;
       }
     }
     ```
     WCAG-style override: всё что animated → effectively static.

  3. **`ui/src/styles/components.css`** (modify): убрать pulse
     анимации которые дублируют общий override:
     - `.wc-admin-warn` animation: удалить (или оставить,
       общий override её остановит).
     - `.audio-loading-pill` animation: то же.
     - Удалить `@keyframes admin-warn-pulse`, `@keyframes
       audio-loading-pulse` если не используются иначе.

  Visual after:
    TabBar mobile: [Score] [AI] [Status]   ← 3 таба, чище
    Pulse animations: off для reduce-motion + на mobile (через
    media query или просто глобально через 2.).
status: applied
---