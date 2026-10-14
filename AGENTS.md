# AGENTS.md — wavecode

Этот репозиторий использует методологию
[math-coding v1.0](../math-coding/AGENTS.md) для документирования решений.

Каждое не-тривиальное решение фиксируется пакетом в `math/<name>/packet.md`.
Перед началом работы обязательно прочитать:

1. [math-coding/AGENTS.md](../math-coding/AGENTS.md) — методология
2. [math-coding/docs/axioms.md](../math-coding/docs/axioms.md) — семь аксиом
3. `math/<latest-packet>/packet.md` — последнее решение

CLI `math-coding` сломан в системе (бинарь ссылается на удалённый glibc);
пакеты создаются вручную по схеме. Lifecycle (draft / applied / retired)
определяется по наличию файла `witness` в `math/<name>/`.

## Kanban (agent-kanban) — ОБЯЗАТЕЛЬНО для всех AI-агентов

**Все задачи по wavecode ведутся в агенте-канбане:**
https://kanban.kosov.online (web UI, basicauth `admin:TempAdmin_2026!`)
MCP endpoint: `https://kanban.kosov.online/mcp/`

- **Project:** `wavecode` (id=1)
- **Текущие задачи:** 4 in_progress (Paseo-миграция 2026-10-14) + 1 todo (PWA).
  IDs 1-5 — см. https://kanban.kosov.online
- **Skill:** `wavecode-kanban` (загружается on-demand через `skill()` tool —
  см. [AngaraConfig/agents-commons/skills/wavecode-kanban.md](../AngaraConfig/agents-commons/skills/wavecode-kanban.md))

**Перед началом работы:**
1. Загрузить skill `wavecode-kanban` через `skill()` — там протокол claim →
   post_progress → request_review/complete.
2. Вызвать `mcp_kanban_get_next_task` (filter по project context) — найти
   существующую задачу, иначе пользователь должен создать новую через UI.
3. Если задача твоя — `mcp_kanban_claim_task`, иначе пользователь
   переназначит или попросит оператора.

**Во время работы:**
- `mcp_kanban_post_progress` — каждый значимый шаг (diff, ошибка,
  артефакт, статус-апдейт). Не молчи.
- `mcp_kanban_post_artifact` — пути к файлам (UI рендерит ссылки).
- `mcp_kanban_post_comment` — ответы на комментарии пользователя.

**В конце:**
- Работа завершена → `mcp_kanban_request_review` (НЕ complete).
- Правки по review → `post_progress` + `request_review` снова.
- После approve пользователем → `mcp_kanban_complete_task` со summary.

**Запрещено:**
- Молча работать без `post_progress` (оператор не видит прогресса).
- `complete_task` до явного одобрения пользователем через UI.
- Создавать задачи без явной просьбы (оператор добавляет через UI сам).

## Структура репозитория

```
README.md       короткое описание
AGENTS.md       этот файл
.gitignore      стандартный для Node-проекта
math/<name>/    пакеты решений (math-coding)
ui/             браузерный SPA (TypeScript + Effect-TS + Solid.js)
```

Composer (`~/Projects/Composer/`) — **отдельный backend-проект в другом треде
разработки**. Wavecode не зависит от Composer, не импортирует его flake,
не имеет серверных компонентов.

## Стек

- TypeScript (strict), Solid.js 1.8, solid-js/store (UI-state), CodeMirror 6
- Effect-TS для архитектурного рантайма (4 слоя: domain / application /
  infrastructure / presentation)
- Strudel (`@strudel/webaudio`) для аудио в браузере (Web Audio API)
- raw `fetch` к llm.kosov.online (LiteLLM proxy, OpenAI-compatible)
- `idb-keyval` для persistence (IndexedDB)
- Тесты: vitest (unit), playwright (e2e)
- Никаких Nix-выходов, никакой контейнеризации — фронтенд деплоится как SPA
