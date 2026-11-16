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

Этот репозиторий фиксирует решения по методологии
[math-coding v5](docs/math-coding-v5.md): активная запись решений —
`spec.json` (`schema_version: 5`) в корне репозитория.

Единица работы — **утверждение (claim)**, а не файл решения. Утверждение
несёт: текст, предметную область (`scope`), ссылку на источник решения
(`source` с дайджестом), условия подтверждения (`requirements`),
**опровергатель** (`falsifier`), регистр (`fact`/`hypothesis`/`judgment`)
и **отрицательный контроль** (`control`).

`decisions/*.yaml` (133 файла) — исторический реестр ADR: он больше не
пишется и не валидируется ядром, но остаётся источником мотивации для
claim'ов. Правка такого решения переводит связанный claim в состояние
`outdated` и требует `mathc review-source`.

Перед началом работы прочитать:

1. [docs/math-coding-v5.md](docs/math-coding-v5.md) — что изменилось и почему
2. [`spec.json`](spec.json) — цель и активные утверждения
3. [`policy.json`](policy.json) — защищённые пути (`spec.json`, `decisions/`)

### Установка `mathc`

```bash
# Ядро v5: готовый статический бинарь (linux-x86_64) + SHA256SUMS.
MC_VERSION=v5.0.2
base="https://github.com/11111000000/math-coding/releases/download/${MC_VERSION}"
curl -fsSL "${base}/mathc-v${MC_VERSION}-linux-x86_64" -o /tmp/mathc
curl -fsSL "${base}/SHA256SUMS" -o /tmp/SHA256SUMS
(cd /tmp && grep "mathc-v${MC_VERSION}-linux-x86_64" SHA256SUMS | sha256sum -c -)
chmod +x /tmp/mathc && sudo install -m 0755 /tmp/mathc /usr/local/bin/mathc
mathc --version   # → mathc 5
```

Старый edge-релиз (ядро 3.7) отдаёт 404, а его команды (`validate`,
`self-check`, `rehash`, `new-decision`) в ядре 5 **не существуют**.
Формат `decisions/*.yaml` ядро 5 не читает.

### Команды ядра 5

| команда | что делает |
|---|---|
| `mathc init` | создаёт `spec.json` (только если его нет) |
| `mathc goal "AIM" "SCOPE[,SCOPE]" "OWNER"` | задать цель |
| `mathc add ID "TEXT" "SCOPE" "FALSIFIER" fact --requirement "verifier:CMD" --control "CMD" [--source ADR]` | объявить утверждение |
| `mathc run` | исполнить проверки и контроли; 0 = green, 1 = red, 3 = unknown |
| `mathc map` / `mathc next` / `mathc context` | карта покрытия и следующий шаг |
| `mathc review-source ID --by WHO --reason "WHY"` | пересмотр источника после его правки |
| `mathc authorize --by WHO --reason "WHY"` | разрешить изменение защищённых путей |
| `mathc install` | переписать блок math-coding в `AGENTS.md` |
| `mathc doctor` | диагностика установки (ничего не чинит) |

### Правило утверждения

Утверждение становится зелёным только если у него есть **исполняемая
проверка** И **отрицательный контроль**, который меняет предмет claim'а и
ломает эту проверку. Проверка без контроля даёт `not-run` → `unknown`.

Verifier исполняется в рабочем дереве, а контроль — в **изолированной
копии** репозитория (`git clone` без `node_modules`). Поэтому verifier'ы
wavecode не могут рассчитывать на установленные зависимости: все они
живут в `scripts/check-invariants.mjs` (только stdlib Node) и проверяют
архитектурные инварианты.

```bash
node scripts/check-invariants.mjs layering   # слои не тянут друг друга
node scripts/check-invariants.mjs console    # нет глобального console в domain/application
node scripts/check-invariants.mjs camera     # камера — только по явному действию
node scripts/check-invariants.mjs deploy     # CI ничего не деплоит
node scripts/check-invariants.mjs secrets    # в репозитории нет секретов
node scripts/check-invariants.mjs decisions  # решения сохраняют свои ключи
node scripts/check-invariants.mjs spec       # spec.json цел и связан с живыми файлами
node scripts/check-invariants.mjs gate       # гейт использует ядро v5
node scripts/check-invariants.mjs term       # термин-бокс раскладывает жесты по строкам
```

**Здоровье кода** (typecheck, lint, юнит-тесты, сборка, e2e) проверяет
`.github/workflows/ci.yml`. Гейт math-coding проверяет **обоснованность**:
инварианты, зафиксированные в `spec.json`, и связь каждого утверждения с
живым источником.

### Защищённые пути

`policy.json` закрывает `spec.json` и `decisions/`: незакоммиченная правка
этих путей блокирует гейт — ядро требует явного разрешения.

```bash
# порядок: правка → коммит → mathc authorize (если правка ещё в рабочем дереве)
mathc authorize --by az --reason "почему меняется запись решений"
```

### Legacy

Каталог `math/` (пакеты v1.0) удалён: все 87 пакетов отображены в
`decisions/<id>.yaml` через `scripts/migrate-v1-packets.py`. Старые
решения — historical record, **не редактируются** (кроме удаления
секретов); новые утверждения пишутся только в `spec.json`.

## Структура репозитория

```
README.md         короткое описание
AGENTS.md         этот файл
.gitignore        стандартный для Node-проекта
.gitverse/        GitVerse Actions — только math-coding gate (деплоя нет)
spec.json         активная запись решений (math-coding v5, schema_version 5):
                  цель + утверждения (claims) с verifier'ами и контролями
policy.json       защищённые пути записи решений (`spec.json`, `decisions/`)
decisions/        исторический реестр решений math-coding 3.3 (133 файла):
                  источник мотивации для claim'ов; ядро 5 их не читает
attestations/     attestation store 3.3 (kernel evidence для `mathc self-check`)
schemas/          JSON-schema reference (kernel input 3.7, family 3.3)
scripts/          утилиты (проверка инвариантов, миграция v1→v3.3, пресеты)
docs/             проектная документация (в т.ч. docs/math-coding-v5.md)
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

Production: https://wavecode.sibres.tech/ (Caddy на angara-1, обслуживает
`/var/lib/wavecode/dist/`). Прежний адрес https://wavecode.kosov.online/
тоже работает — отдаёт то же приложение, редиректа между ними нет.
Из Tailscale приложение доступно по https://wavecode.kosov.online/
(split-DNS `*.kosov.online` → 100.81.163.63). Отдельного Tailscale
Service `wavecode` нет: имя `wavecode.tail347ae6.ts.net` не резолвится
и в README, и в AGENTS его указывать нельзя.

### Единственный путь: `./bin/deploy.sh`, локально на angara-1

```bash
./bin/deploy.sh
```

Прод разворачивается **только** отсюда — с того же хоста, где ведётся
разработка.

Одна автоматическая точка всё же есть: git-хук `post-merge`
(`.git/hooks/post-merge`) запускает `bin/deploy.sh` в фоне, когда merge
ложится в `master` (лог — `~/wavecode-deploy.log`). Хук лежит в
каталоге `.git/`, а не в репозитории, поэтому в клоны он не уезжает и
на другой машине деплой остаётся ручным. Пуш при этом **не** деплоит:
хук вешается на `git merge`, а не на `git push`.

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

Пуш в `master` **не** деплоит. А вот merge в `master` деплоит: хук
`post-merge` сам зовёт `bin/deploy.sh`. Ручной запуск после merge нужен
только если хук не сработал — например, когда merge сделан в клоне без
`.git/hooks/`.

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
<!-- math-coding:begin -->
## math-coding in this project

Wavecode остаётся beat-maker'ом, который нельзя сломать незаметно: архитектурные инварианты, камера, деплой, секреты и запись решений проверяются свежими воспроизводимыми проверками, а не договорённостями.

9 claim(s).

```sh
mathc run
```

Every verb: mathc help mathc init mathc goal mathc add mathc run mathc map mathc next mathc context mathc waive mathc record mathc install mathc doctor mathc adopt mathc import-adr mathc import-junit mathc authorize mathc re-evaluate mathc review-source mathc mcp
<!-- math-coding:end -->
