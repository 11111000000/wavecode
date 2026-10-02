---
proposition: |
  При загрузке `presetsStore` кастомные пресеты, чьё имя (lowercase,
  trimmed) совпадает с именем встроенного пресета, дропаются молча
  и localStorage перезаписывается. Защищает от shadow-кастома,
  сохранённого из устаревшего билт-пресета, который сбивает с толку
  оператора в дропдауне («обновил пресет — но звук старый»).
antithesis: |
  (a) Ничего не делать — оператор сам разберётся (F5, clear localStorage,
  удалить кастомный через UI). На практике: жалобы «обновление не
  работает» → 4 итерации одной и той же жалобы на тот же пресет.
  (b) Детектить конфликт по id — но id кастомных имеет префикс `custom-`,
  встроенные — kebab-case типа `fur-elise`, коллизий по id не бывает;
  конфликт проявляется на уровне отображаемого имени.
  (c) Префиксовать встроенные «(built-in)» в дропдауне — визуальная
  развязка, но не убирает shadow: кастом всё равно выигрывает, если
  оператор кликнул на него по привычке.
  (d) Версионировать кастом-пресеты + «Reset on schema mismatch» —
  оркестрация migrations, overkill для текущего объёма.
synthesis: |
  Минимальная миграция в `presetsStore.load()`: case-insensitive
  trim сравнение имени кастома со всеми `BUILTIN_PRESETS[*].name`.
  Совпадение → дроп + перезапись. Срабатывает ровно один раз на
  сессию (при module init). Без UI-уведомления: silent migration
  соответствует best-practice (drop migration scripts в Postgres,
  schema-version migrations в Diesel), оператору не нужно принимать
  решение. Покрыто unit-тестом `drops custom presets whose name
  shadows a builtin on load`.
substrate: ui/src/presentation/state/presetsStore.ts
status: draft
axiom: A4
epistemics:
  - statement: "Кастом с именем 'Für Elise' дропается на module load"
    marker: witness
    evidence: "vitest presetsStore.test.ts:45-67 (12 tests passed 2026-10-02)"
  - statement: "localStorage перезаписывается удалённой записью"
    marker: witness
    evidence: "тот же test, JSON.parse raw не содержит custom-stale id"
  - statement: "Миграция прозрачна для кастомов с уникальными именами"
    marker: source
    evidence: "presetsStore.test.ts:101 'custom presets survive a fresh module load' все еще passes"
---

## Intent

Защита от человеческой ошибки: оператор загружает встроенный пресет,
правит его в редакторе, нажимает 💾 Save с тем же именем — получает
кастом, который shadow-ит встроенный. После обновления встроенного
пресета оператор видит старый кастом в дропдауне и думает, что
обновление не сработало. Удаление shadow-кастомов на load —

минимально инвазивное решение: один тихий шаг, оператор даже не
замечает, что произошла миграция.

## What this is NOT

- Не silent reset всего localStorage (это `resetAllBrowserData` —
  стирает LLM-настройки, ui-state, custom пресеты разом; слишком грубо).
- Не schema-version migration на кастомы (нет схемы-формата, нет
  явных version fields в JSON; overkill).
- Не фича «делит названий наказывает» — это лечение симптома, а не
  причины. Причина — отсутствие UI-подсказки, что кастом может
  shadow-ит встроенный. Эта фича — отдельный пакет.

## Worked example

```ts
// ui/src/presentation/state/presetsStore.ts
const load = (): Preset[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Preset[];
    const builtInNames = new Set(
      BUILTIN_PRESETS.map((p) => p.name.toLowerCase().trim())
    );
    const filtered = parsed.filter(
      (p) => !p.custom || !builtInNames.has((p.name ?? '').toLowerCase().trim())
    );
    if (filtered.length !== parsed.length) {
      localStorage.setItem(KEY, JSON.stringify(filtered));
    }
    return filtered.filter((p) => p.id && p.score && p.name);
  } catch {
    return [];
  }
};
```

Trigger: `customPresets = createSignal<Preset[]>(load())` на module init.
Effect: кастом с именем, совпадающим с BUILTIN, дропается + persist.

## Tests

- presetsStore.test.ts:45-67 — `drops custom presets whose name shadows
  a builtin on load`. Setup: два кастома в localStorage, один из них
  с именем 'Für Elise'. После `vi.resetModules()` + import → кастом
  'Für Elise' отсутствует, builtin 'Für Elise' присутствует, второй
  кастом 'My Sketch' сохранён. localStorage raw не содержит удалённого
  preset.

## Open questions

- Префикс в дропдауне «⭐» уже стоит на кастомах (см. App.tsx:150) —
  оператор должен видеть, что выбирает кастом, не строенный. Но
  оптическая подсказка не предотвращает тень — оператор всё равно
  может кликнуть «Für Elise ⭐» по привычке. Долгосрочно: переименовать
  встроенные пресеты с суффиксом типа «(Beethoven, built-in)» в дропдауне.
  Out of scope этого пакета.
- Что если кастом был намеренно «расширен» поверх встроенного?
  Сценарий: оператор сохранил кастом «Für Elise» с дополнительным
  layer-м (фичи, add_comments) и хочет именно его. Эта миграция
  его уничтожает. Out of scope: предполагается, что shadow-кастом —
  ошибка, а не фича. Если позже понадобится «кастом с тем же именем,
  но другой score» — другой механизм (например, отдельный optgroup
  «Overrides» или schema-version).