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

## Структура репозитория

```
README.md         короткое описание
AGENTS.md         этот файл
.gitignore        стандартный для Node-проекта
.gitverse/        GitVerse Actions — только math-coding gate (деплоя нет)
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
- CI: `.github/workflows/ci.yml` (quality-gate: typecheck + lint + vitest + build) и `.gitverse/workflows/math-coding.yml` (math-coding гейт) — **обе только проверяют, ничего не деплоят**
- Деплой: **только локально** на angara-1 через `./bin/deploy.sh` (см. ниже). Ни GitHub Actions, ни GitVerse Actions прод не разворачивают
- Никаких Nix-выходов, никакой контейнеризации — фронтенд деплоится как SPA

## Deployment

Production: https://wavecode.kosov.online/ (Caddy на angara-1, обслуживает
`/var/lib/wavecode/dist/`). Также доступно на Tailscale:
https://wavecode.tail347ae6.ts.net/.

### Единственный путь: `./bin/deploy.sh`, локально на angara-1

```bash
./bin/deploy.sh
```

Прод разворачивается **только** отсюда — с того же хоста, где ведётся
разработка. Никакого автоматического деплоя нет и не планируется.

`bin/deploy.sh` делает:

1. Проверяет `ui/.env.local` (per-app LLM-ключ) и `/etc/secrets/llm-proxy/master.key`.
2. `pnpm install` (если нет `node_modules`).
3. `pnpm build` — `tsc --noEmit && vite build` → `ui/dist/`.
4. `sudo cp -r ui/dist/* → /var/lib/wavecode/dist/` (владелец `caddy:caddy`).

Caddy подхватывает новую статику без reload — перезаписи файлов
достаточно. Если менялся `ui/.env.local` (per-app LLM-ключ) —
`systemctl reload caddy` вручную, это **не** входит в `deploy.sh`.

Идемпотентно: можно запускать сколько угодно раз.

### Чего нет (и не будет)

- **Никакого auto-deploy по push.** Ни в GitHub Actions, ни в GitVerse
  Actions. Push в `master` меняет код в репозитории и **ничего** не
  разворачивает.
- **Никаких `secrets.WAVECODE_DEPLOY_*`.** SSH-деплой через CI больше
  не существует: `.gitverse/workflows/deploy.yml` удалён 2026-10-20
  после того, как выяснилось, что секреты для него так и не были
  настроены — 14 последовательных run-ов упали с
  `WAVECODE_DEPLOY_HOST not set`. Держать в репозитории мёртвый
  workflow, который выглядит как рабочий путь развёртывания, — хуже,
  чем не иметь его вовсе.
- **Никакого `workflow_dispatch`-деплоя.** Раньше он оставался как
  «ручной запуск для отладки», но требовал тех же ненастроенных
  секретов, то есть был фикцией.

Оставшиеся workflows — **только проверки, прод они не трогают**:

| Файл | Триггер | Что делает |
|---|---|---|
| `.github/workflows/ci.yml` | push/PR в master | typecheck + lint + validate:presets + vitest + `vite build` → артефакт в GitHub |
| `.github/workflows/stale.yml` | cron (пн 09:00 UTC) | бот для issue/PR |
| `.gitverse/workflows/math-coding.yml` | push/PR в master | `mathc validate` + `mathc self-check` (warn-only) |

Локальный эквивалент `ci.yml` — `cd ui && npm run test:precommit`
(typecheck + vitest + lint:no-console + validate:presets). Перед
коммитом в ветку его стоит прогнать.

### Порядок выкладки

```bash
git checkout master
git pull --ff-only gitverse master     # после merge в master
./bin/deploy.sh                        # сборка + выкладка на прод
```

Пуш в `master` **не** деплоит — `bin/deploy.sh` запускается руками.

### Rollback

```bash
# 1. Найти последний зелёный коммит
git log --oneline -20 master

# 2. Откатить master (revert-коммит, не переписывая историю)
git revert <bad-commit-sha>

# 3. Передеплоить (push сам по себе не развернёт)
./bin/deploy.sh
```

`bin/deploy.sh` сохраняет предыдущий билд как
`/var/lib/wavecode/dist.prev.<timestamp>/`, но **не подменяет active**
— это история, не готовая точка отката. Rollback всегда через
`git revert` + повторный `deploy.sh`.

### Грабли

- `bin/deploy.sh` использует `sudo` (нужен NOPASSWD для
  `cp`/`mkdir`/`chown`). Текущая настройка — `az: ALL NOPASSWD: ALL`
  (NixOS default для основного пользователя).
- Caddy vhost настраивается в `~/Projects/AngaraConfig/` (другой
  репо). Public hostname + TLS-сертификаты + сам факт, что этот хост
  обслуживает `/var/lib/wavecode/dist/`, — всё там. Этот репо
  отвечает только за содержимое `dist/`.
- angara-1 держит **только** этот и связанные репо для build'а.
  Production-data (IDB, messages) живёт в браузере юзера, не на
  сервере. Поэтому redeploy = «переписать статику», без миграций БД.