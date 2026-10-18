# Changelog

All notable changes to wavecode are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Russian version:** [CHANGELOG.ru.md](CHANGELOG.ru.md) (planned, see issue #TBD).
> For now, this file is bilingual — section headers in English, content in English.

## [0.1.0] — 2026-10-18

First properly versioned release. Built on the `fix/v0.1.0-release-prep`
branch (merged into `master` via `--no-ff`). Verified end-to-end:
typecheck clean, 1345 unit tests pass (77 files), lint:no-console
clean, all 15 built-in presets validate, production build
succeeds.

### Added
- Apache-2.0 LICENSE file (`LICENSE`, `NOTICE`)
- Dual-language README: `README.md` (RU, primary) and `README.en.md` (EN)
- `scripts/build-readme-decisions.py` — auto-generate the decisions table from `decisions/*.yaml`
- GitHub Actions CI workflow: typecheck + vitest + lint + build (`.github/workflows/ci.yml`)
- GitHub issue templates: bug report, feature request (`.github/ISSUE_TEMPLATE/`)
- Pull request template (`.github/PULL_REQUEST_TEMPLATE.md`)
- CODEOWNERS, Dependabot config
- `CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md`
- Canonical `docs/ARCHITECTURE.md` (renamed from the legacy `ui/ARCHITECTURE.md`
  title that still said «Composer UI — Architecture»)

### Changed
- `README.md` / `README.en.md` — count corrections: 15 built-in presets
  (was «8» in both READMEs, with two names — Für Elise, Smoke on the
  Water — that did not exist in `BUILTIN_PRESETS`); 97 architectural
  decisions in `decisions/` (was 88); 78 unit-test files / 19 e2e
  test files (was 56 / 11). Six broken `docs/ARCHITECTURE.md`
  hyperlinks in each README now resolve.
- Landing «Микшер» card now describes the actual mixer surface
  (mute / solo / gain per track) instead of pan / reverb / echo
  features that were not implemented.
- `application/useCases/llmEdit.ts` SYSTEM_PROMPT's `bd/sd/hh/oh/cp`
  warning was rewritten to accurately describe the available
  sounds (synth: `sawtooth/sine/square/triangle/white/brown` + `sbd`;
  sample-based: `bd/sd/hh/oh/cp` and the `drums_*` bank prefix that
  SampleLoader auto-registers). The previous wording forbade the
  very names the built-in presets are written in.
- `application/reducer.ts`: the `commitHistoryCheckpoint` event type
  was renamed to `coalesceLatestHistoryEntry` — the new name
  matches the actual reducer behaviour (drop the most recent
  history entry, do not push a new checkpoint).

### Fixed
- **`domain/strudel/parser.ts` `unescape` was a one-liner
  `s.replace(/\\(.)/g, '$1')` that collapsed `s("a\nb")` (literal
  backslash + n) into `s("anb")` on round-trip.** Replaced with a
  `JSON.parse` wrapper that handles `\\n`, `\\t`, `\\"`, `\\\\`,
  `\\uXXXX` correctly (the same semantics the Strudel runtime
  uses when it eventually evals the string). Falls back to the
  old naive unescape on JSON-rejected escapes so the parser
  contract (never throws) is preserved. 5 regression tests added.
- `application/state/appStore.ts`: `dispatch` no longer wraps the
  pure `reduceAppEvent` in a `produce + Object.assign` dance.
  The old pattern went through the mutable-Proxy for no benefit
  since `reduceAppEvent` never touched the draft in place. The
  flat `setAppStore((prev) => reduceAppEvent(prev, event))` is
  the idiomatic Solid store path and gives the same fine-grained
  reactivity on nested fields.
- `application/useCases/llmEdit.ts` `applyEditWithContext` no
  longer hand-rolls its own reader loop and silently ignores
  `callbacks.onToken`. It now reuses the private `readStream`
  helper and accepts the same `ApplyEditCallbacks` shape as
  `applyEditStream` — so the focused-context flow streams tokens
  the same way as the standard flow.
- `application/useCases/llmEdit.ts` `__wavecodeLastRaw` is no
  longer written to `window`. The diagnostic accessor
  `getLastRawLLMResponse` now reads a module-scope variable
  via a private `setLastRawLLMResponse` helper. Removes the
  DevTools-visible global and the cross-module race risk on a
  shared window property.

### Removed
- `ui/package.json` — `@strudel/serial` (zero usages across `ui/src`)
  and `@effect/typeclass` (zero usages) removed. Lockfiles are
  not pruned in this commit; the next `pnpm install` will
  reconcile.
- `ui/src/presentation/components/pianoSynth.ts` — exported
  helper with no production caller, removed.
- `ui/src/infrastructure/audio/PianoSampleLoader.{ts,test.ts}` —
  back-compat re-export shim with no production caller and a
  self-referential test, removed together.
- Stale `math/<name>/packet.md` comments throughout `ui/src`
  (21 locations across 16 files) replaced with the
  `decisions/<id>.yaml` paths the math-3.3 migration
  standardised on.
- Stale `Subagent N` comments (14 occurrences in 9 files) — the
  parallel-split worker numbers from `docs/SUBAGENT-PLAN.md`
  that the migration left behind — replaced with neutral
  `see decisions/<id>.yaml` pointers.

### Performance
- `infrastructure/log/logger.ts` ring buffer: the array-based
  log sink used `buffer.shift()` (O(n)) on every push. Under
  10 entries/sec at the 500-entry cap, that's ~5000 ops/sec of
  head-removal work. The new ring (head pointer + fixed storage
  + size counter) makes every push O(1). The errors-only ring
  is also a ring. `getBuffer()` and `materialiseErrors()`
  reconstruct the chronological view on demand. The `prepend()`
  path stays a materialise+merge+slice because it must do a
  chronological splice — only ever called on boot restore, so
  the O(cap) cost is fine.
- `infrastructure/audio/LiveAudioEngine.ts`: the 25-line bodies
  of `setLayerMix` and `setScore` were duplicated verbatim.
  Extracted into a shared `hotSwapPattern` helper plus a
  `silentRollback` catch factory. The two callers are now
  ~6 lines each and the contract lives in one place.

### Known issues (not part of this release)
- `decisions/*.yaml` (most of the 97) have duplicated
  `antithesis:` / `counterexample:` fields from the v1.0→3.3
  migration. **Syntactically valid** YAML; a dedup sweep is
  planned in a follow-up decision.
- `ui/ARCHITECTURE.md` is a transitional duplicate of
  `docs/ARCHITECTURE.md`; the legacy title `Composer UI —
  Architecture` is fixed at the source-of-truth file; the
  `ui/` copy will be removed in the next minor.
- `docs/PLAN.md`, `docs/SUBAGENT-PLAN.md` are internal working
  documents; moving to `docs/internal/` planned.
- `getActiveHaps` re-transpiles the score on every 50 ms
  poll for piano FOLLOW mode. Debounced to 20 Hz at the call
  site; a scheduler-cached re-query would reduce CPU further.
  Tracked as a follow-up packet.

## [0.0.0] — pre-release

The project was tracked as `0.0.0` (no released version) before the
GitHub-quality pass. All work was committed to `master` directly.
For a per-commit history, see `git log --oneline`.

---

## Versioning

- **MAJOR** — breaking changes to public API (`ui/src/domain/types.ts`, exported
  services in `infrastructure/`).
- **MINOR** — new features, non-breaking.
- **PATCH** — bug fixes, non-breaking.

## How to read this

- **Added** — new features
- **Changed** — changes in existing functionality
- **Deprecated** — soon-to-be removed features
- **Removed** — now-removed features
- **Fixed** — bug fixes
- **Security** — vulnerability fixes (also see `SECURITY.md`)
