# math/ — пакеты решений

Здесь живут пакеты math-coding v1.0: `math/<name>/packet.md` + `witness`.

Схема — в [math-coding/AGENTS.md](../math-coding/AGENTS.md) (бинарь
`math-coding` сломан, CLI `create/apply` не работают; пишем вручную).

## Lifecycle (вычисляется из git-истории)

| Состояние | Условие |
|---|---|
| `draft` | пакет создан, нет файла `witness` |
| `applied` | пакет + `witness` в git, proposition не менялся |
| `drift` | witness есть, но proposition изменился |
| `stale` | witness + файлы изменились, proposition тот же |
| `retired` | явный `retire` (supersession или deprecation) |
| `abandoned` | явный `abandon` |

## Список пакетов

| Пакет | Статус | Substrate | Решение |
|---|---|---|---|
| `wavecode-scope` | draft | none | wavecode — чистофронтовый SPA, без backend |