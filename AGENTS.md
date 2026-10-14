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
.gitverse/      GitVerse Actions workflows (deploy)
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
- CI/CD: GitVerse Actions → SSH на angara-1 → `bin/deploy.sh`
- Никаких Nix-выходов, никакой контейнеризации — фронтенд деплоится как SPA

## Deployment

Production: https://wavecode.kosov.online/ (Caddy на angara-1, обслуживает
`/var/lib/wavecode/dist/`). Также доступно на Tailscale:
https://wavecode.tail347ae6.ts.net/.

### Авто-деплой (push в master)

`.gitverse/workflows/deploy.yml` — push в `master` (или ручной
`workflow_dispatch`) триггерит shared `ubuntu-latest` runner, который:

1. Берёт приватный ключ из секрета `WAVECODE_DEPLOY_SSH_KEY` и по
   нему открывает SSH-сессию на angara-1.
2. На хосте принудительно запускается pipeline (через SSH
   `command="..."` restriction в `~/.ssh/authorized_keys`):
   - `git fetch --prune gitverse master`
   - `git reset --hard gitverse/master` (origin = GitHub mirror,
     отстаёт от gitverse — берём напрямую)
   - `git clean -fdx -e ui/.env.local -e ui/node_modules -e ui/dist`
   - `bin/deploy.sh`:
     - `pnpm install` (если нет `node_modules`)
     - `pnpm build` (vite + tsc)
     - `sudo cp -r ui/dist/* → /var/lib/wavecode/dist/` (caddy:caddy)
3. CI-шаг `Verify deployment` опрашивает `wavecode.kosov.online/`
   до 60s — должен вернуть `Last-Modified` header.

Caddy подхватывает новую статику без reload. Если менялся
`ui/.env.local` (per-app LLM-ключ) — `systemctl reload caddy`
вручную, **не** входит в auto-deploy.

### Секреты для GitVerse

Один раз настроить в gitverse → Settings → Secrets (`b11111000000/wavecode`):

| Secret                    | Что                                                     |
|---------------------------|---------------------------------------------------------|
| `WAVECODE_DEPLOY_HOST`    | hostname или IP angara-1 (например `nixos`)            |
| `WAVECODE_DEPLOY_PORT`    | SSH-порт (на angara-1 = `1984`)                        |
| `WAVECODE_DEPLOY_USER`    | SSH-пользователь (на angara-1 = `az`)                 |
| `WAVECODE_DEPLOY_SSH_KEY` | Приватный ed25519-ключ (public в `~/.ssh/authorized_keys` на angara-1 с `command="..."` + `no-pty,no-X11,no-agent,no-port-forwarding`) |

Генерация ключей (если нужно пересоздать):
```bash
ssh-keygen -t ed25519 -N '' -C "wavecode-ci-deploy@gitverse" -f ~/.ssh/wavecode_ci_deploy
# public → вставить в authorized_keys с restrict'ом (см. выше)
# private → целиком содержимое ~/.ssh/wavecode_ci_deploy в секрет
```

### Manual deploy (обход CI)

```bash
./bin/deploy.sh
```

Любой push в master триггерит auto-deploy, **плюс** `workflow_dispatch`
в UI GitVerse → "Run workflow" → запускает тот же flow. Использовать
для отладки secrets или hotfix когда CI лежит.

### Rollback

```bash
# Найти последний зелёный коммит
git log --oneline -20 master
# Откатить master (создаёт revert-коммит, не переписывает историю)
git revert <bad-commit-sha>
git push gitverse master
# → CI задеплоит revert-коммит через ~1 минуту
```

`bin/deploy.sh` сохраняет предыдущие билды как
`/var/lib/wavecode/dist.prev.<timestamp>/` (см. `git clean -fdx -e
dist.prev.*` в workflow), но **не подменяет active** — это история,
не для rollback. Rollback всегда через git revert.

### Грабли

- `bin/deploy.sh` использует `sudo` (нужен NOPASSWD для `cp/mkdir/chown`).
  Текущая настройка — `az: ALL NOPASSWD: ALL` (NixOS default для
  основного пользователя). CI работает через SSH-ключ с
  `command="..."` restrict, поэтому compromise ключа даёт
  злоумышленнику только запуск git+deploy pipeline, не
  произвольный shell.
- Caddy vhost настраивается в `~/Projects/AngaraConfig/` (другой
  репо). Public hostname + TLS сертификаты — там. Этот репо
  отвечает только за содержимое `/var/lib/wavecode/dist/`.
- angara-1 держит **только** этот и связанные репо для build'а.
  Production-data (IDB, messages) живёт в браузере юзера, не
  на сервере. Поэтому redeploy = "переписать статику", без
  миграций БД.
