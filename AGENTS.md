# AGENTS.md — wavecode

---

## AI-agent workflow (server-wide policy, 2026-10-14)

**Source of truth** (Nix-baked, applies to all Paseo agents via
`daemon.appendSystemPrompt`):

- `~/Projects/AngaraConfig/agents-commons/prompts/git.txt`
- `~/Projects/AngaraConfig/agents-commons/prompts/worktree-first.txt`
- `~/Projects/AngaraConfig/AGENTS.md` §16
- `~/Projects/AngaraConfig/KB/30_decisions/agent-auto-commit-policy-2026-10-14.md`

If this section ever conflicts with the source of truth, the source
of truth wins.

**Default workflow:**

1. **Work in a branch** - `feat/<slug>` / `fix/<slug>` / `docs/<slug>` /
   `refactor/<slug>`. Never commit directly to `master` / `main`.
   Worktree (`git worktree add` or `paseo_create_workspace`) is the
   preferred way; see the `worktree-first` skill.
2. **Auto-commit** - after each meaningful edit:
   `git add <files> && git commit -m "..."`. Conventional Commits,
   English, <=72-char subject. Never `git add -A` blindly.
3. **Auto-merge if no problems; ask only on real issues** - when the branch's
   work is complete, run `git merge --no-ff <branch>` into the target
   **automatically**, UNLESS one of these is true: merge conflict in
   the diff, failing pre-merge checks (lint/typecheck/test/secret grep),
   secrets or sensitive content in the diff, target moved ahead (needs
   rebase), force-push required (always ask), change touches external
   paths in `AngaraConfig/AGENTS.md` §8, or user explicitly said
   "ask first". If any hold: **stop and ask the user with a specific
   question and proposed fix**. Otherwise: merge, report (branch →
   target, SHA, summary), then **propose** push (still gated).
4. **Never push without being asked** - push is public + irreversible.
   Wait for "push" / "запушь" / "open PR" / "publish". Same rule for
   `gh pr create` and force-push.
5. **Report state** - after each commit, show branch, SHA, files
   changed, one-line summary.

**Project-specific overrides** (if any) below take precedence over
this section, but defer to the source of truth above.

---

Этот репозиторий использует методологию
[math-coding 3.3](../math-coding/AGENTS.md) для документирования решений.

Каждое не-тривиальное решение фиксируется YAML-файлом в
`decisions/<id>.yaml` со схемой `math-coding/3.3`. Каждый файл
валидируется ядром (`mathc validate`) и участвует в gate-gate
(`mathc self-check`). Перед началом работы обязательно прочитать:

1. [math-coding/AGENTS.md](../math-coding/AGENTS.md) — методология 3.3
2. [math-coding/docs/axioms.md](../math-coding/docs/axioms.md) — пять аксиом
3. [`decisions/decision.yaml`](decisions/decision.yaml) — active policy
   (что входит в scope, какие paths закрыты)
4. [schemas/decision.json](schemas/decision.json) — JSON-schema,
   валидируемая ядром

### Установка `mathc`

```bash
curl -fsSL https://github.com/11111000000/math-coding/releases/download/edge/install.sh \
  | sh -s --
export PATH="$HOME/.local/bin:$PATH"
mathc version  # должен вернуть "math-coding 3.3.0-alpha: bootstrap"
```

Edge release бинарь работает на NixOS angara-1 (glibc 2.40 совместим).
Старая заметка "CLI сломан" — устарела (относится к pre-2026-10 setup,
когда бинарь линковался на удалённый glibc).

### Создание нового решения

```bash
mathc new-decision <id>          # печатает scaffold (id в kebab-case)
# отредактировать decisions/<id>.yaml: intent, commitment, scope,
# obligations[].acceptance.all[].verifier, outcomes, antithesis, counterexample
mathc validate decisions/<id>.yaml
mathc self-check                  # exit 0 = ok, 1 = reject, 3 = unknown
```

### Legacy `math/<name>/packet.md`

Каталог `math/` содержит **мигрированные** пакеты v1.0 (87 штук,
commits до 2026-10-14). Они отображены в `decisions/<id>.yaml`
через скрипт `scripts/migrate-v1-packets.py` и могут быть удалены
после merge этой ветки (см. commit `chore: drop math/ legacy packets`).
Старые пакеты — historical record, **не редактируются**; новые
решения пишутся только в `decisions/`.

## Kanban (agent-kanban) — ОБЯЗАТЕЛЬНО для всех AI-агентов

**Все задачи по wavecode ведутся в агенте-канбане:**
https://kanban.kosov.online (web UI, basicauth `admin:TempAdmin_2026!`)
MCP endpoint: `https://kanban.kosov.online/mcp/`

- **Project:** `wavecode` (id=1)
- **Текущие задачи:** 4 in_progress (Paseo-миграция 2026-10-14) + 1 todo (PWA).
  IDs 1-5 — см. https://kanban.kosov.online
- **Skill:** `wavecode-kanban` (загружается on-demand через `skill()` tool —
  см. [AngaraConfig/agents-commons/skills/wavecode-kanban.md](../AngaraConfig/agents-commons/skills/wavecode-kanban.md))

### Auth: bearer token УЖЕ в env — НЕ ищи его в коде

Paseo daemon получает `KANBAN_BEARER` из systemd
`EnvironmentFile=/etc/opencode/opencode.env` (mode 0600, root:root,
**НЕ в Git**). Все spawned opencode CLI процессы наследуют эту env
переменную (проверено: `cat /proc/<opencode-pid>/environ | grep KANBAN`).

В `OPENCODE_CONFIG_CONTENT` уже прописан reference
`"Authorization": "Bearer {env:KANBAN_BEARER}"` — opencode CLI
резолвит `{env:KANBAN_BEARER}` на старте через `getenv("KANBAN_BEARER")`.
**Тебе НЕ нужно ничего нигде искать, читать, передавать.**

- ❌ НЕ делай `echo $KANBAN_BEARER` (только в debug-случае и в pastebin/private log)
- ❌ НЕ читай `/etc/opencode/opencode.env` или `/etc/secrets/agent-kanban/*`
  из своих скриптов (нет необходимости, нарушает принцип least-privilege)
- ❌ НЕ пиши токен в код, коммиты, комментарии, артефакты
- ❌ НЕ добавляй `.env` файлы с токеном в репо

Если MCP call возвращает `401 Unauthorized` / "no token" / "Missing API key":
- Сначала проверь `echo $KANBAN_BEARER | head -c 8` (длина > 0 значит env OK)
- Если пусто — это значит ты запущен НЕ через Paseo daemon (например,
  локально вручную или через opencode-serve без `EnvironmentFile`)
- Попроси пользователя перезапустить через Paseo UI

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
- Логировать / выводить / коммитить bearer-токен (см. секцию Auth выше).

## Структура репозитория

```
README.md         короткое описание
AGENTS.md         этот файл
.gitignore        стандартный для Node-проекта
.gitverse/        GitVerse Actions workflows (deploy, math-coding gate)
math/<name>/      legacy пакеты решений math-coding v1.0 (будут удалены)
decisions/        решения math-coding 3.3 (active source of truth)
attestations/     attestation store (kernel evidence для `mathc self-check`)
schemas/          JSON-schema reference (math-coding 3.3 kernel input)
scripts/          утилиты (миграция v1→v3.3, проверка)
ui/               браузерный SPA (TypeScript + Effect-TS + Solid.js)
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
