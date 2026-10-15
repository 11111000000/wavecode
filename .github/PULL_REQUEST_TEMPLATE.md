## Перед отправкой

- [ ] CI green (`typecheck + vitest + lint + build` — `Actions` tab)
- [ ] Pre-commit hook зелёный (`bash scripts/pre-commit`)
- [ ] Если меняется поведение — есть запись в `CHANGELOG.md` (секция Unreleased)
- [ ] Если архитектурное изменение — есть YAML в `decisions/<id>.yaml` (math-coding 3.3)

## Что меняет этот PR

<!-- Краткое описание: что и почему, не как. -->

## Тип изменения

- [ ] Bug fix (non-breaking change, fixes #issue)
- [ ] New feature (non-breaking change, adds functionality)
- [ ] Breaking change (would break existing API/UX; needs migration plan)
- [ ] Documentation only
- [ ] Refactor (no behaviour change)

## Как тестировалось

<!--
  - Какие unit/e2e тесты добавлены
  - Скриншот / GIF для UI-изменений
  - Если это audio/AI — что пробовали вручную
-->

## Связанные issues / PRs

<!-- Например: Fixes #42, Refs wavecode-quality-tooling@1 -->
