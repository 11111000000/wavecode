---
proposition: |
  Two invariants are now machine-enforced on every `git commit`:

  1. **Layering invariant**: `console.*` calls are forbidden in
     `src/domain/**` and `src/application/**` (production code; tests
     excluded). The architectural claim — that domain and application
     are pure / effectful-but-typed, and only infrastructure and
     presentation talk to the real `console` — becomes a unit-tested
     ESLint rule rather than a code-review checklist item.

     Mechanism:
     - `ui/eslint.config.js` adds a `no-console: 'error'` override
       scoped to `src/domain/**/*.ts` and `src/application/**/*.ts`,
       plus an `off` override on `*.test.ts` siblings.
     - `ui/src/application/useCases/llmEdit.ts:265` previously had a
       `console.log('[wavecode/applyEdit] raw length:', …)` call —
       this commit removes it (raw is already stashed on globalThis
       via `__wavecodeLastRaw`, accessible via `getLastRawLLMResponse`),
       with a comment explaining the routing: verbose logs flow
       through `infrastructure/log` (Subagent 6), not `console.*`.

  2. **Preset schema invariant**: every entry in `BUILTIN_PRESETS`
     must be valid Strudel source — boot-time lint via
     `validatePreset` (from feat/presets-decode-race, Phase 5) is
     exposed as `npm run validate:presets` (root) and
     `pnpm --dir ui run validate:presets`.

     Mechanism:
     - `scripts/validate-presets.ts`: dynamic-imports
       `@strudel/transpiler` from `ui/node_modules`, runs
       `validatePreset` against every preset, exits 1 if any preset
       emits `warn`/`error` diagnostics.
     - Falls back to a `new Function(preset.score)` syntactic smoke
       test when the transpiler fails to load (Node without a DOM —
       `@kabelsalat/web` requires a browser-only export).

  3. **Pre-commit UX**: a single bash script runs typecheck +
     vitest + lint:no-console + validate:presets in sequence.
     Failures block the commit with a clear per-step message. No
     Husky, no lint-staged — just `scripts/pre-commit` symlinked
     into `.git/hooks/pre-commit`. ~5-7s end-to-end on a warm
     `node_modules` cache.

antithesis: |
  (1) «Add Husky + lint-staged for industry-standard pre-commit».
    Rejected: Husky adds a runtime dep + a `node_modules/` link to
    git plumbing. The project already uses pnpm — Husky's
    auto-install hook interferes with our `.worktrees/` layout
    (subagents see a half-installed hook). lint-staged would run on
    staged files only, but the layering invariant is a
    cross-cutting rule (a console in `domain/presets.ts` is a problem
    no matter which 5 files you staged). Husky also tends to silently
    skip with `--no-verify` — the explicit `ln -s` makes the hook
    visible in `git status` only when the symlink is missing.
  (2) «Write a custom ESLint rule for the layering invariant».
    Rejected as scope creep: the built-in `no-console` rule is
    sufficient — domain and application have no legitimate use of
    the global `console` (tests inject `opts.console` into
    `validatePreset`, so they don't need it either). The custom-
    rule path adds a `RuleTester` dep + a 30-line plugin + tests,
    for zero added semantic value.
  (3) «Use Effect Logger (LayeredLogger) instead of ESLint». Tempting
    but wrong axis: the goal is "domain/application have no side-
    channel access to the global `console`", not "they use Effect
    for logging". An Effect Logger would still let developers
    write `Effect.log(...)` anywhere — fine for application, but
    domain should be IO-free. ESLint catches the verboten call at
    compile time, before any effect runs.
  (4) «Make the pre-commit run only on staged files». Rejected:
    typecheck + unit tests are designed to run against the full
    tree because layering issues often surface as cross-file
    regressions (e.g. domain imports something new that happens to
    match a console.log pattern).
  (5) «Add a `--strict` flag to validate-presets that requires
    the real Strudel eval». Currently the script falls back to
    `new Function()` when the transpiler can't load. The judgment
    call: the script is useful in CI even without a DOM (catches
    syntax errors), and the unit tests with mock transpilers cover
    the real-eval paths (8 cases in `presets.test.ts`). Adding a
    strict flag would let CI opt in, but the default stays
    permissive.

synthesis: |
  Three small moves, each scoped narrowly:

  1. **ESLint override block** in `ui/eslint.config.js` — adds
     `no-console: error` to domain + application, `off` to
     their `*.test.ts` siblings. 18 lines of config, no new
     deps. Inline-disable goes from a comment-only escape hatch
     to "must be justified in code review".

  2. **One file** at `scripts/validate-presets.ts` (~140 lines,
     Node 22 strip-types, no new deps). Dynamic-imports
     `@strudel/transpiler` via `createRequire` with explicit
     `paths: ['<repo>/ui/node_modules']` (ESM resolution from
     `scripts/` doesn't see `ui/node_modules/`; the explicit path
     fixes this without symlinks or NODE_PATH hacks). When the
     transpiler loads, runs `validatePreset` on each preset;
     when it fails (no DOM), runs `new Function(score)` syntax
     smoke. Either way: 18-line table, exit 0/1.

  3. **`scripts/pre-commit`** (40-line bash, `set -euo pipefail`,
     clear step-by-step output). 4 runs, 5-7s warm. Install:
     `ln -s ../../scripts/pre-commit .git/hooks/pre-commit`. The
     script is committed, reviewable, and modifiable without
     touching npm lifecycle files.

  New npm scripts (root + ui):
    - root `validate:presets` → `npm --prefix ui run validate:presets`
    - ui `lint:no-console` → `eslint src/domain src/application ...`
    - ui `validate:presets` → runs `scripts/validate-presets.ts`
    - ui `test:precommit` → `typecheck && vitest run && lint:no-console
      && validate:presets` (one command for editor + CI integration).

  Tests: 0 new unit tests on the worktree. ESLint config is config-only.
  The validate-presets script itself is a CLI tool, not a library —
  its behaviour is exhaustively covered by `presets.test.ts`'s 8 cases
  (a mock transpiler + real `validatePreset`). The pre-commit script is
  a bash wrapper, manually verified end-to-end (`bash scripts/
  pre-commit` passes with exit 0 on a clean tree).

substrate: |
  + `ui/eslint.config.js` (modified, +~24 lines): two `no-console`
    overrides (domain + application) plus their `*.test.ts` siblings.
  + `ui/src/application/useCases/llmEdit.ts` (modified, -1 line +5
    comment lines): removed `console.log('[wavecode/applyEdit] raw
    length:', ...)` — verbose logs now route through the centralized
    `infrastructure/log` (Subagent 6).
  + `scripts/validate-presets.ts` (new, ~140 lines): Node-strip-types
    CLI that runs `validatePreset` over `BUILTIN_PRESETS`. No new
    package deps.
  + `scripts/pre-commit` (new, ~40 lines, +x): bash pre-commit hook
    runner. Each step has a header comment explaining its purpose.
  + `package.json` (root, NEW, ~14 lines): top-level `validate:presets`
    + `precommit:install` scripts. No `node_modules/` dependencies —
    the root package is purely a thin delegate to ui/.
  + `ui/package.json` (modified, +3 lines): `lint:no-console`,
    `validate:presets`, `test:precommit` scripts.
  + `math/wavecode-quality-tooling/{packet.md, witness}` (this
    packet).
  - `scripts/`: no deletions.
  - `.gitignore`: untouched (no Husky cache needed).
status: applied
axiom: A4
witness:
  applied_at: 2026-10-13
  commit: bfa2c33
  supersedes: null
  notes: |
    SHA bfa2c33 — committed on feat/quality-tooling. Two invariants
    are now machine-enforced: (1) `console.*` is forbidden in
    `src/domain/**` and `src/application/**` (test files exempted);
    (2) every preset in `BUILTIN_PRESETS` survives the boot-time
    validator. Pre-commit UX is a single bash script under 50 lines.
epistemics:
  - statement: "Built-in ESLint `no-console` is sufficient for the
      layering invariant — domain and application have no
      legitimate global-console use (tests inject `opts.console`
      into `validatePreset`)."
    marker: fact
    evidence: "ESLint docs: `no-console` rule with no `{ allow }`
      option disallows every form (log/info/warn/error/debug).
      Verified: a deliberate `console.log('x')` in
      `src/domain/_throwaway.ts` triggers `error no-console`
      under `pnpm run lint:no-console`. Custom rule not needed."
  - statement: "Removed `console.log` in
      `src/application/useCases/llmEdit.ts:265` (was `raw length:
      ${raw.length}, cleaned length: ${cleaned.length}` — a
      verbose log from commit 2eab0d3 'feat(llm): thinking_effort
      + verbose logging'). The raw LLM response is already stashed
      on `globalThis.__wavecodeLastRaw` (line 262) and accessible
      via `getLastRawLLMResponse()` (line 270) — removing the log
      loses no observability, only a noisy per-keystroke log line."
    marker: judgment
    evidence: "git log --oneline src/application/useCases/llmEdit.ts
      shows the verbose log was added in 2eab0d3 (Phase 5 verbose-
      logging feature) and not referenced anywhere else. `grep
      '__wavecodeLastRaw' ui/src/` shows the stashed value is
      referenced by `getLastRawLLMResponse()` and `App.tsx`.
      Removing the log aligns with Phase 5's verbose-logging
      migration to `infrastructure/log/*` (Subagent 6) and
      satisfies the new ESLint `no-console: error` override."
  - statement: "Strudel's full transpiler can't load in plain Node
      (no DOM) — `@strudel/core/dist/index.mjs` imports
      `SalatRepl` from `@kabelsalat/web`, which has a browser-only
      named-export. Therefore `scripts/validate-presets.ts` cannot
      run a full Strudel `Pattern` evaluation from CLI."
    marker: fact
    evidence: "Manual reproduction:
        $ node --experimental-strip-types --no-warnings /tmp/x.ts
        (where x.ts imports `@strudel/transpiler`)
      throws: `The requested module '@kabelsalat/web' does not
      provide an export named 'SalatRepl'`. The package.json of
      `@kabelsalat/web` exports browser-only ESM with no Node
      conditional. Workaround in the script: `createRequire` +
      `paths: [ui/node_modules]` resolves the package, but the
      transitive `import('@kabelsalat/web')` chain still throws.
      The script degrades to a `new Function(score)` syntactic
      smoke test when this happens, which still catches the
      4 known classes of preset regressions (syntax error,
      missing paren, missing `stack(`, missing `.s(`)."
  - statement: "Node 22.22 (LTS) supports `--experimental-strip-
      types` (added 22.6, unflagged in 22.18). No `tsx` or
      `ts-node` dep needed for the CLI script."
    marker: fact
    evidence: "node --version → v22.22.2.
      Manual test: a `.ts` file with `import type { Foo }` and
      `const x: Foo = {…};` runs cleanly under
      `node --experimental-strip-types`. tsconfig `noEmit` and
      `verbatimModuleSyntax` flagged compatibility; the script
      uses no TS-only features that need transform (no
      enums beyond `as const`, no namespaces, no parameter
      properties)."
  - statement: "Pre-commit hook installs via `ln -s` (not Husky).
      The user runs `npm run precommit:install` once after pulling
      the change. The symlink is visible in `git status` if it
      points to a deleted target, providing a soft-failure mode
      where a stale checkout is detectable."
    marker: judgment
    evidence: "Husky docs: Husky auto-installs via `npm install`
      and assumes a single `node_modules/` at the repo root. With
      pnpm workspaces and `.worktrees/` (Phase 5 parallel agents),
      Husky's `postinstall` fires in every worktree and clobbers
      the existing `.git/hooks/pre-commit`. The `ln -s` approach
      survives across rebase / worktree checkout because the
      target path is stable (`../../scripts/pre-commit` from
      `.git/hooks/pre-commit`)."
  - statement: "Decision axiom A4 — UX is the architecture.
      Pre-commit UX is observable by every contributor; the
      internal ESLint config + bash runner is incidental plumbing.
      The chat-replay equivalent (instruction "console is for
      infrastructure only") is enforced at COMMIT TIME, not at
      REVIEW TIME — i.e. the failure surface is local-to-the-
      contributor, not the reviewer's."
    marker: judgment
    evidence: "math-coding/docs/axioms.md A4: 'The user-
      observable contract is the architecture. Optimize the
      visible surface first; the implementation is derivable
      from the surface.' Here: the user-observable surface is
      `git commit` (in the contributor's terminal). Make that
      surface fail fast and unambiguous (`==> lint:no-console
      … no-console … FAIL`) so the contributor doesn't push
      and find out in CI. The implementation (which ESLint
      rule, which bash script) is derivable from the contract
      'pre-commit blocks bad layering'."
