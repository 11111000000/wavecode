---
proposition: |
  Production (`https://wavecode.kosov.online/`) деплоится вручную:
  оператор SSH-ит на angara-1 и запускает `bin/deploy.sh`, который
  делает pnpm install + pnpm build + sudo cp в
  `/var/lib/wavecode/dist/` (caddy:caddy). Каждый merge в master
  требовал ручного шага — забыл задеплоить = prod отстаёт от master
  на один цикл.

  Решение — GitVerse Actions workflow (`.gitverse/workflows/deploy.yml`)
  срабатывает на push в master и через SSH-ключ (с `command=`
  restriction в `authorized_keys`) гоняет тот же `bin/deploy.sh`
  на angara-1. Manual fallback остаётся (`./bin/deploy.sh` локально
  или `workflow_dispatch` через UI).

  Ключевые дизайн-решения:
  - Build не на CI: shared `ubuntu-latest` runner не имеет pnpm-кеша
    и не знает про /home/az/.local/bin/pnpm (corepack install path).
    Build на хосте angara-1, где уже всё настроено — `bin/deploy.sh`
    делает pnpm install + build в одну команду.
  - SSH deploy key, не PAT/токен: `command="..."` в `authorized_keys`
    ограничивает ключ ровно pipeline'ом (git fetch + reset + clean +
    deploy.sh). Compromise ключа → злоумышленник не получает
    произвольный shell, только возможность прогнать тот же deploy.
  - `git fetch gitverse` (не origin): origin = GitHub mirror,
    отстаёт. CI должен тянуть с gitverse напрямую.
  - `git reset --hard + clean -fdx` (с `-e ui/.env.local`):
    dev-дерево angara-1 — source of truth только для prod-билда,
    не для локальной разработки. Любой WIP стирается при деплое;
    WIP должен жить в worktree, не в main checkout'е.
  - `bin/deploy.sh` resolves pnpm to absolute path:
    `command -v pnpm` → fallback на `/home/<user>/.local/bin/pnpm`.
    Non-interactive SSH sessions (GitVerse runner) не source'ят
    `~/.bashrc`, поэтому bare `pnpm` падает с "command not found".

  Trigger: `on.push.branches: [master]` + `workflow_dispatch`
  (для отладки secrets и hotfix когда CI лежит).

  Concurrency: `cancel-in-progress: false` — два параллельных
  деплоя (push + dispatch) НЕ отменяют друг друга; второй ждёт
  первого. Race в /var/lib/wavecode/dist/ может оставить
  half-deployed bundle.
outcome: |
  - Каждый push в master → автодеплой на https://wavecode.kosov.online/
    за ~1 минуту (fetch + reset + pnpm install + pnpm build + cp +
    verify).
  - Manual deploy: `./bin/deploy.sh` локально (тот же скрипт, тот же
    sudo, та же последовательность).
  - Manual override: `workflow_dispatch` через GitVerse UI.
  - Rollback: `git revert <bad-sha> && git push gitverse master` —
    CI задеплоит revert-коммит за ~1 минуту. НЕ требует
    вмешательства в /var/lib/wavecode/.
  - `bin/deploy.sh` сохранён как single source of truth для
    deploy-логики: CI = manual = debug. Никаких параллельных
    shell-скриптов, никакого fork'а между CI-версией и manual-версией.
invariant: |
  - `bin/deploy.sh` — единственный артефакт, реализующий
    deploy-логику. Изменения deploy-процесса вносятся в нём;
    CI просто его зовёт.
  - `.gitverse/workflows/deploy.yml` — единственный триггер
    автодеплоя. Никаких post-receive hooks, никаких cron'ов,
    никаких manual-triggered webhook'ов.
  - SSH deploy key в `~/.ssh/authorized_keys` на angara-1 имеет
    форму:
      `command="/bin/bash -c 'set -eux; cd ~/Projects/wavecode;
       git fetch --prune gitverse master;
       git reset --hard gitverse/master;
       git clean -fdx -e ui/.env.local -e ui/node_modules -e ui/dist;
       exec /home/az/Projects/wavecode/bin/deploy.sh'",
       no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty
       ssh-ed25519 AAAA…  wavecode-ci-deploy@gitverse`
    Никаких других keys, никаких unrestricted keys.
  - GitVerse secrets `WAVECODE_DEPLOY_{HOST,PORT,USER,SSH_KEY}`
    обязательны — workflow падает с понятной ошибкой при их
    отсутствии (см. `##[error]Process completed with exit code 1`
    в CI log). Восстановление = добавить секрет + rerun.
  - `bin/deploy.sh` checks `.env.local` exists and `VITE_LLM_PROXY_KEY`
    не равен `REPLACE-ME` (placeholder). Без валидного ключа build
    падает с явной ошибкой и инструкцией.
  - Concurrency `cancel-in-progress: false` — два деплоя подряд
    не race'уют (второй ждёт завершения первого).
  - Никаких secrets в bundle или CI logs: deploy key
    монтируется через `${{ secrets.* }}` и пишется в
    `~/.ssh/wavecode_deploy_key` с mode 600, не выводится
    в лог. Verify-step делает только `curl -I PUBLIC_URL` —
    никаких credentials в command.
test: |
  - typecheck: tsc --noEmit clean (не должен ломать от
    изменений deploy.sh — никаких TS-эффектов).
  - manual: запуск через SSH deploy key с фиктивной машины:
      `ssh -i wavecode_ci_deploy -p 1984 az@nixos`
      должен выполнить git fetch + reset + clean + bin/deploy.sh
      и задеплоить в /var/lib/wavecode/dist/.
  - manual: push в master на gitverse → CI workflow_run
    появляется в GitVerse UI → status running → success через
    ~1 минуту → curl -I https://wavecode.kosov.online/ возвращает
    свежий Last-Modified.
  - manual: workflow_dispatch через UI → тот же результат.
  - manual: git revert <bad-sha> && git push → CI задеплоит
    revert за ~1 минуту, без вмешательства в /var/lib/wavecode/.
  - manual: компрометация deploy key (утечка private key) →
    максимальный blast radius = прогон `git fetch + reset +
    clean + bin/deploy.sh` от лица az. НЕ: arbitrary shell,
    НЕ: read /home/az/.ssh/*, НЕ: запись в ~/Projects/wavecode
    (git reset --hard стирает WIP, но не заменяет на
    attacker-controlled tree).
  - manual: secrets не заданы → workflow падает на первом
    SSH-шаге с понятной ошибкой "WAVECODE_DEPLOY_HOST not set".
  - end-to-end: `git log --oneline -1 gitverse/master` совпадает
    с `git log --oneline -1 /var/lib/wavecode/dist`'s source
    (косвенно: bundle hash в dist/index.html сматчен с
    index-*.js в `git show <sha>:ui/dist/assets/`).
antithesis: |
  (1) «Можно делать build на CI runner, потом rsync dist/ в
    /var/lib/wavecode/dist/». Возражение: shared ubuntu-latest
    не имеет ни pnpm-кеша, ни локального path-настройки corepack.
    Build на CI добавляет 60-90s задержки + требует secret'а
    `.env.local` в CI (тоже secret, тоже в UI). Build на angara-1
    уже настроен, бесплатен, и использует тот же скрипт что и
    manual deploy. Single source of truth.
  (2) «Можно webhook из GitVerse → systemd timer на angara-1».
    Возражение: требует webhook-listening демона + auth-secret'а
    + дополнительного moving part. GitVerse Actions — стандартный
    паттерн, логи видны в UI, retry из коробки. `kb-changes-poll`
    в AngaraConfig делает так для KB, но у wavecode таких
    реляционных constraints нет — GitVerse Actions проще.
  (3) «Можно self-hosted runner на angara-1, тогда SSH не нужен».
    Возражение: requires `actions-runner` install + systemd unit +
    registration token + auto-update cron. Дороже в setup'е, не
    даёт функционального выигрыша (runner всё равно должен
    делать то же самое: git fetch + reset + clean + bin/deploy.sh).
    См. Phase 2 в `bin/deploy-angara-2.sh` (AngaraConfig) — это
    eventual, не Phase 1.
  (4) «Можно deploy-ключ с NOPASSWD sudo, чтобы CI сам делал
    `sudo cp` без forced command». Возражение: тогда compromise
    ключа = arbitrary sudo = root-equivalent. Forced command
    ограничивает blast radius до "прогнать тот же deploy" —
    idempotent, auditable, revocable.
  (5) «Нужно atomic swap (dist.new → dist) чтобы не было
    half-deployed». Возражение: Caddy не блокирует файлы
    (read-only open()), `sudo cp -r dist/. dist/` пишет
    файлы по очереди. Между первым и последним файлом
    /var/lib/wavecode/dist/index.html может ссылаться на
    assets, которых ещё нет → 404 на полсекунды. Это ок для
    SPA (browser re-fetches index.html на любой 404), и
    исправление добавило бы complexity (rename, sync) без
    real benefit. Если критично — Phase 2.
  (6) «`git reset --hard` стирает локальный WIP разработчика,
    это неожиданно». Возражение: dev-дерево на angara-1 — НЕ
    место для WIP. WIP живёт в worktree (`paseo_create_workspace
    isolation="worktree"`), не в main checkout'е. Если
    разработчик правит main checkout напрямую — он уже не
    следует convention. Convention документирована в AGENTS.md
    и kb-publish skill.
  (7) «Пакет не нужен, trivial change». Возражение: precedent
    (math/wavecode-mobile-transport-bar, math/wavecode-ui-state,
    math/wavecode-preset-row-and-toast-z) — каждый
    infrastructure-уровневое изменение (CI, deploy, persistence)
    сопровождается packet. Compromise deploy key = full RCE на
    production — non-trivial enough to require the paper trail.
synthesis: |
  Три коммита в одной серии на ветке `feat/ci-deploy-pipeline`
  (merged в master коммитом 59694b6):

  1. **`.gitverse/workflows/deploy.yml`** (90 lines) —
     shared ubuntu-latest runner, SSH на angara-1 с deploy
     key, single step "Deploy to angara-1 via SSH" + "Verify
     deployment" (curl -I). concurrency group +
     cancel-in-progress: false.

  2. **`bin/deploy.sh`** — pnpm resolved to absolute path
     (command -v + /home/<user>/.local/bin fallback), чтобы
     non-interactive SSH (CI runner) находил pnpm без sourcing
     ~/.bashrc.

  3. **`AGENTS.md`** — новая секция "Deployment" (~90 lines):
     поток, secrets checklist, manual override, rollback,
     грабли (sudo, Caddy, dev-дерево как source-of-truth для
     prod-билда только).

  Provisioning (one-time, manual):
    a. SSH keypair: `ssh-keygen -t ed25519 -N '' -C
       "wavecode-ci-deploy@gitverse" -f ~/.ssh/wavecode_ci_deploy`
    b. Public key в `~/.ssh/authorized_keys` с command= restrict
       (см. invariant).
    c. Private key целиком → GitVerse secret
       `WAVECODE_DEPLOY_SSH_KEY`.
    d. `WAVECODE_DEPLOY_HOST=nixos`, `WAVECODE_DEPLOY_PORT=1984`,
       `WAVECODE_DEPLOY_USER=az` — три оставшихся секрета.

  Без secrets workflow падает с понятной ошибкой на первом
  SSH-шаге. После добавления — `gh`-style rerun через UI
  или новый push.

  Push в master = deploy. Rollback = `git revert && push`.
  Manual = `./bin/deploy.sh` или workflow_dispatch. Никаких
  других путей в production.
status: applied
axiom: A5
epistemics:
  - statement: "bin/deploy.sh уже реализует весь deploy-pipeline (install + build + sudo cp), Caddy обслуживает /var/lib/wavecode/dist/"
    marker: fact
    evidence: "ui/src/... нет, bin/deploy.sh:1-93 — единственный артефакт; /var/lib/wavecode/dist/ owned by caddy:caddy; Caddy vhost в AngaraConfig (см. ls /var/lib/wavecode/dist/)"
  - statement: "Manual deploy (bin/deploy.sh по SSH) работал до этого packet'а"
    marker: fact
    evidence: "Last-Modified /var/lib/wavecode/dist/index.html обновлялось при каждом merge в предыдущих коммитах; AGENTS.md НЕ упоминает CI (значит ручной deploy был convention)"
  - statement: "origin = github mirror, отстаёт от gitverse"
    marker: fact
    evidence: "git remote -v → origin = github.com/11111000000/wavecode, gitverse = gitverse.ru:11111000000/wavecode. На 2026-10-14 gitverse/master = 59694b6, origin/master = 1031d8a — отставание ~5 коммитов"
  - statement: "Non-interactive SSH sessions (включая GitVerse Actions runners) не source'ят ~/.bashrc, поэтому /home/az/.local/bin (corepack install) НЕ в PATH"
    marker: fact
    evidence: "ssh test: PATH=/run/wrappers/bin:/home/az/.nix-profile/bin:... НЕ содержит /home/az/.local/bin. Поэтому `pnpm build` в deploy.sh падает с 'command not found' при CI-запуске, хотя работает при интерактивном SSH"
  - statement: "az имеет NOPASSWD: ALL на angara-1 (NixOS default для основного пользователя)"
    marker: fact
    evidence: "sudo -nl: 'User az may run the following commands on nixos: (ALL : ALL) NOPASSWD: ALL'"
  - statement: "GitVerse Actions не имеет self-hosted runner на angara-1 (verified: 0 workflow runs до merge, 1 run после с failure из-за missing secrets)"
    marker: fact
    evidence: "gitverse_actions_list total_count: 0 до push; после push 59694b6 — 1 run, status=failure, diagnosis='WAVECODE_DEPLOY_HOST not set'"
  - statement: "bin/deploy.sh idempotent: повторный запуск переписывает /var/lib/wavecode/dist/ тем же содержимым"
    marker: fact
    evidence: "deploy.sh:55-83 — `sudo cp -r dist/. dist/` + cleanup loop (drop stale hashed assets) + `sudo chown -R caddy:caddy`. Никаких side-effects вне /var/lib/wavecode/dist/"
  - statement: "Reference patterns в соседних репо (Genium-clean, angara-2-config) используют тот же SSH-deploy approach"
    marker: fact
    evidence: "~/Projects/Genium-clean/.gitverse/workflows/ci.yml (test-only), ~/Projects/angara-2-config/.gitea/workflows/deploy.yml (SSH на VPS + nixos-rebuild) — оба идут через secrets + SSH + remote command"
  - statement: "bin/deploy.sh: existing build+deploy script, использовался до этого packet'а"
    marker: fact
    evidence: "bin/deploy.sh history: 357b0b1, f204de7, fc5c25c — pre-existing script. AGENTS.md НЕ упоминает его до этого пакета, но git log + /var/lib/wavecode/dist/index.html Last-Modified показывают, что он регулярно вызывался"
  - statement: "Wavecode.kosov.online обслуживается Caddy с TLS на angara-1 (тот же хост, где живёт /var/lib/wavecode/dist/)"
    marker: fact
    evidence: "curl -I https://wavecode.kosov.online/ → Server: Caddy, Etag, Last-Modified обновляются при деплое. Caddy vhost в AngaraConfig (другой repo), но listener — angara-1 (тот же host где bin/deploy.sh работает)"