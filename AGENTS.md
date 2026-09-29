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
