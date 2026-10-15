# wavecode

> **Live-coding music in the browser, with an AI agent.**
> Write a score in Strudel mini-notation — the agent edits on request, plays it via the Web Audio API.
> Pure-frontend SPA, no backend, no server.
>
> 🇷🇺 **Русская версия:** [README.md](README.md) · 🇬🇧 This file is the English translation

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg"/></a>
  <a href=".github/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/11111000000/wavecode/ci.yml?branch=master&label=CI&logo=githubactions&logoColor=white"/></a>
  <a href="https://wavecode.kosov.online/"><img alt="Live demo" src="https://img.shields.io/badge/demo-wavecode.kosov.online-ffb547?logo=googlechrome&logoColor=white"/></a>
  <a href="https://github.com/11111000000/wavecode"><img alt="Repo" src="https://img.shields.io/badge/gitverse-11111000000/wavecode-1f6feb?logo=git&logoColor=white"/></a>
</p>

<p align="center">
  <img src="docs/wavecode-redesign-screenshot.png" alt="wavecode UI: score editor on the left, AI chat on the right, transport bar on top, preset panel on the bottom" width="900"/>
</p>

---

## ▶ Try it

* **Live demo:** <https://wavecode.kosov.online/> (also available over Tailscale: <https://wavecode.tail347ae6.ts.net/>)
* **Stable build:** auto-deploys from `master` — see [CI/CD](docs/ARCHITECTURE.md)
* **PWA:** installable as a standalone app (Chrome / Edge / Safari iOS 16.4+)

> **First run:** open `#/app` (skipping the landing), wait ~5 seconds for Strudel samples to load from the ServiceWorker cache. The "Loaded N/M samples" badge in the top bar shows progress. Audio only starts on the ▶ click (browser autoplay policy).

---

## What it is

**wavecode** is a browser-based AI agent for live-coding music. The score file (JS code in Strudel mini-notation) is edited by **both** the user and an LLM. The Strudel runtime in the main thread re-computes patterns and plays them through the Web Audio API. There are no servers besides the LLM proxy (`llm.kosov.online`).

```text
┌────────────────────────────────────────────────────────┐
│ Browser (single SPA)                                   │
│                                                        │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐   │
│  │ Solid UI │←→│ Effect   │  │  Main thread        │   │
│  │ + CM6    │  │ Layer DI │  │  Strudel runtime    │   │
│  └────┬─────┘  └────┬─────┘  │  @strudel/webaudio  │   │
│       │             │        └─────────┬──────────┘   │
│       │             │                  │              │
│       │             ▼                  ▼              │
│       │      LLMClient ──► llm.kosov.online   Web Audio API
│       │             │                  │              │
│       ▼             ▼                  ▼              │
│   IndexedDB  (score + messages)    speakers           │
└────────────────────────────────────────────────────────┘
```

**Stack:** TypeScript (strict) · Solid.js 1.8 · Effect-TS 3.x · CodeMirror 6 · `@strudel/webaudio` · `idb-keyval` · raw `fetch` to an OpenAI-compatible LLM API. Tests: vitest + Playwright.

**Deep dive:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — four layers (domain / application / infrastructure / presentation), Effect-Layer DI, why not React/Monaco/Tidal+SuperDirt, how Strudel runs in the main thread, agent loop, tool-calling protocol.

---

## Quick start

Requirements: **Node.js ≥ 20.10** (for `--experimental-strip-types` in `validate:presets`) and **pnpm** (`npm install -g pnpm`).

```sh
git clone https://github.com/11111000000/wavecode.git
cd wavecode/ui
npm install          # ~3 minutes on a cold cache
cp .env.example .env.local
# edit .env.local: VITE_LLM_PROXY_URL + VITE_LLM_PROXY_KEY
npm run dev          # http://localhost:5173/
```

### Pre-commit quality checks

```sh
cd ui
npm run typecheck           # tsc --noEmit
npm run test:run            # vitest (unit, 56 files, ~5 sec warm)
npm run lint:no-console      # fails if domain/application use console.*
npm run validate:presets    # syntactic smoke test of every BUILTIN_PRESET
```

Or one command from the root: `bash scripts/pre-commit` (after `npm run precommit:install` to install the git hook).

### Production build

```sh
cd ui
npm run build               # → ui/dist/
```

`ui/dist/` is a static SPA, ready to deploy to any static host (Vercel, Cloudflare Pages, GitHub Pages, nginx). Deployment details: [bin/deploy.sh](bin/deploy.sh) and [docs/ARCHITECTURE.md § Deployment](docs/ARCHITECTURE.md).

---

## Features

- 🎵 **Strudel mini-notation** — 8 built-in presets (Creep, Für Elise, Smoke on the Water, …) plus custom ones via UI
- 🤖 **AI agent** — multi-turn chat, tool-calling (`edit_score`, `eval_snippet`, `undo_score`, `read_score`), two models (smart / fast)
- 🎹 **Piano keyboard** with WebMIDI — polyphony, parallel recording, sustain pedal
- 🥁 **Step sequencer** — grid editor (view/sketch/edit modes), live eval on score edit
- 🎚️ **Track mixer** — mute / solo / gain per track, live updates without restart
- 🎙️ **Audio recording** — WAV export, bar counter
- 🌐 **URL sharing** — `?s=…` encodes the full score + messages, restored in a new session
- 📡 **PWA** — offline-ready, Workbox auto-update, dedicated cache for Strudel-vendor
- ⌨️ **Hotkeys** — `Ctrl/⌘+\`` toggles Console, `Ctrl/⌘+Z/Y` undo/redo, focus AI/score
- 🔍 **Console UX** — bottom-sheet with three tabs (Errors / All / By source), 5/1s throttle, IDB-persisted last-100 errors, 500-entry ring buffer
- 🔗 **URL state** — `#/`, `#/app`, `#/admin` (debug inspector)
- 🌍 **i18n** — README in [Russian](README.md) (primary) and English (this file)

---

## Architectural decisions

Full traceability — every decision is captured as a YAML in `decisions/` under the **math-coding 3.3** schema (see [AGENTS.md § math-coding](AGENTS.md)). 88 decisions cover everything from stack choice down to per-source log throttling.

**Foundational 16** (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details):

<!-- BEGIN decisions-table -->
| Decision | State | Summary |
|---|---|---|
| `console-ux-polish` | active | Three additive polishes to the Phase-1 console UX (`math/wavecode-debug-console`) land without restructuring it: |
| `wavecode-codemirror-6` | draft | The score editor in wavecode is CodeMirror 6 with a custom extension for Strudel mini-notation (highlight + completions). |
| `wavecode-debug-console` | active | Three observable UI surfaces share one log backend (`logger` from `math/wavecode-log-pipeline`): |
| `wavecode-effect-ts-architecture` | draft | wavecode's architectural runtime is Effect-TS (3.x) with 4 layers (domain, application, infrastructure, presentation) and Dependency Injection through Effect-Layer. |
| `wavecode-llm-litellm-proxy` | draft | wavecode's LLM client connects to https://llm.kosov.online/v1 via the OpenAI-compatible API. |
| `wavecode-log-pipeline` | active | The log surface in wavecode is split into three pure pieces so the console UIs (ConsoleButton / ConsoleSheet / Toast) can read from a |
| `wavecode-logger-enhancements` | active | Three additive enhancements land on top of `math/wavecode-log-pipeline`'s L1 ring buffer without restructuring it: 1. **`fatal` level** — adds a new highest severity that promotes auto-popup … |
| `wavecode-piano-polyphony` | active | `PianoKeyboard` plays ONE note at a time. That was fine for tap-on / tap-off, but the moment a user holds two keys (chord) — or WebMIDI delivers a 3-note chord from a controller — the late… |
| `wavecode-preset-decode-race` | active | Two independent correctness defects collapse into "no sound" once one is fixed and the surface becomes audible: |
| `wavecode-quality-tooling` | active | Two invariants are now machine-enforced on every `git commit`: 1. **Layering invariant**: `console.*` calls are forbidden in `ui/src/domain/**` and `ui/src/application/**` (ESLint `no-console… |
| `wavecode-scope` | draft | wavecode is a pure-frontend browser SPA for live-coding music with an AI agent; it has no server components and does not depend on `~/Projects/Composer/`. |
| `wavecode-stack-performance` | draft | The UI layer of wavecode uses Solid.js 1.8 instead of React to achieve maximum performance and minimum resource usage (fine-grained reactivity, ~7 KB runtime vs ~45 KB for R… |
| `wavecode-static-spa-deployment` | draft | wavecode deploys as a static SPA: `pnpm build` → `ui/dist/` → any static host (Vercel, Cloudflare Pages, GitHub Pages, nginx). No Nix outputs, no containers, no server runtime… |
| `wavecode-strict-layering` | draft | Structural integrity of wavecode is enforced by ESLint (flat config, v9) with the `no-restricted-imports` rule per layer: domain cannot import solid-js / @strudel/* / idb-keyval, application — solid-js / @strudel / @ai-sdk / idb-keyval, … |
| `wavecode-strudel-in-browser` | active | Audio in wavecode is rendered in the browser via `@strudel/core` + `@strudel/webaudio` (webaudioRepl + evaluate), without a server-side TidalCycles+SuperDirt+Icecast. Pattern eval runs in the main thread (≤10 ms for a typical snippet), W… |
| `wavecode-test-strategy` | draft | wavecode's test strategy is a pyramid: many unit tests on domain and application (vitest, no mocks), moderate coverage on infrastructure (vitest with mocked Layers), and a small set of e2e tests on Playwright for the critical user-… |
<!-- END decisions-table -->

> **Full list (88 decisions):** `ls decisions/*.yaml` or `python3 scripts/build-readme-decisions.py`. About `draft`/`active` states — see [math-coding AGENTS.md](../math-coding/AGENTS.md): in 3.3, `state: active` is assigned explicitly, migrated v1.0 packets remain `draft` until the next revision. This does **not** mean they don't apply — all of them are applied in code and backed by attestations.

---

## Code quality

| Metric | Value | Where |
|---|---|---|
| TypeScript strict | `strict: true` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax` | `ui/tsconfig.json` |
| ESLint per-layer | `no-restricted-imports` for domain / application / infrastructure / presentation | `ui/eslint.config.js` |
| `no-console` in domain/application | enforced lint rule | `ui/eslint.config.js:47,76` |
| Unit tests | 56 vitest files, ~5 sec warm | `ui/src/**/*.test.ts` |
| E2E tests | 11 Playwright files | `ui/tests/e2e/` |
| Pre-commit hook | typecheck + vitest + lint:no-console + validate:presets | `scripts/pre-commit` |
| CI | GitHub Actions: typecheck + vitest + lint + build | `.github/workflows/ci.yml` |
| Deployment CI | GitVerse Actions → SSH to angara-1 | `.gitverse/workflows/deploy.yml` |

**Layered architecture:** `ui/src/{domain,application,infrastructure,presentation}/` — each layer has explicit import contracts, enforced by eslint. Domain is pure functions (no `fetch` / `AudioContext` / `solid-js`), application is Effect-typed use-cases, infrastructure implements `LLMClient` / `AudioEngine` / `Repo`, presentation is Solid components.

**We deliberately do NOT use:** React, Monaco Editor, Tidal+SuperDirt+Icecast, backend services, Nix outputs, Docker. Rationales live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the individual `decisions/wavecode-*.yaml` files.

---

## Repository layout

```
wavecode/
├── README.md              this file (EN) — translation
├── README.en.md           this file
├── AGENTS.md              AI-agent protocol (math-coding, kanban, git)
├── LICENSE                Apache-2.0
├── NOTICE                 third-party attributions
├── CONTRIBUTING.md        how to contribute
├── CHANGELOG.md           release history
├── SECURITY.md            vulnerability policy
├── .github/               GitHub-specific: workflows, issue/PR templates, CODEOWNERS
├── .gitverse/             GitVerse Actions workflows (deploy, math-coding gate)
├── bin/                   deploy.sh, check-llm-key.sh
├── decisions/             88 architectural decisions (math-coding 3.3 schema)
├── attestations/          evidence store for math-coding self-check
├── schemas/               JSON-schema for math-coding 3.3
├── scripts/               utilities: pre-commit, validate:presets, build-readme-decisions
├── docs/                  ARCHITECTURE.md, design.md, PLAN.md (internal)
└── ui/                    browser SPA
    ├── ARCHITECTURE.md    duplicate of docs/ARCHITECTURE.md (transitional, see issue #TBD)
    ├── package.json
    ├── tsconfig.json
    ├── eslint.config.js
    ├── vite.config.ts
    ├── playwright.config.ts
    └── src/
        ├── domain/        pure types, schemas, functions
        ├── application/   use-cases: llmEdit, editScore, evalWithTransport
        ├── infrastructure/ llm/, audio/, log/, repo/, haptics, composition
        └── presentation/  Solid components, state, panels
```

---

## Relationship to Composer

**None.** [`Composer`](https://github.com/11111000000/Composer) is a separate backend project in a different development thread. wavecode does not import its flake, does not use its API, and has no server-side components. This is explicitly captured in [decisions/wavecode-scope.yaml](decisions/wavecode-scope.yaml).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — short flow:

1. **Fork** → branch `feat/<slug>` / `fix/<slug>` / `docs/<slug>` / `refactor/<slug>`
2. **Before commit:** `bash scripts/pre-commit` (or `npm run precommit:install` to install the git hook)
3. **Every architectural decision** — file in `decisions/<id>.yaml` per the math-coding 3.3 schema
4. **PR** — describe *what* and *why*, not *how*. CI runs typecheck + vitest + lint.

Issue templates: [bug report](.github/ISSUE_TEMPLATE/bug.yml) · [feature request](.github/ISSUE_TEMPLATE/feature.yml).

## License

[Apache License 2.0](LICENSE) — Copyright © 2026 Petr Kosov and contributors. Full text in [LICENSE](LICENSE). Third-party attributions in [NOTICE](NOTICE).

## Contact

- **Live demo:** <https://wavecode.kosov.online/>
- **Tailscale:** <https://wavecode.tail347ae6.ts.net/>
- **Issues:** [github.com/11111000000/wavecode/issues](https://github.com/11111000000/wavecode/issues)
- **GitVerse mirror (canonical):** [gitverse.ru/b11111000000/wavecode](https://gitverse.ru/b11111000000/wavecode)

---

<p align="center">
  <sub><a href="README.md">README.md (RU)</a> · README.en.md (EN, this file) · <a href="CHANGELOG.md">CHANGELOG</a> · <a href="CONTRIBUTING.md">CONTRIBUTING</a> · <a href="docs/ARCHITECTURE.md">ARCHITECTURE</a></sub>
</p>
