# Changelog

All notable changes to wavecode are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Russian version:** [CHANGELOG.ru.md](CHANGELOG.ru.md) (planned, see issue #TBD).
> For now, this file is bilingual — section headers in English, content in English.

## [Unreleased]

### Added
- Apache-2.0 LICENSE file (`LICENSE`, `NOTICE`)
- Dual-language README: `README.md` (RU, primary) and `README.en.md` (EN)
- `scripts/build-readme-decisions.py` — auto-generate the decisions table from `decisions/*.yaml`
- GitHub Actions CI workflow: typecheck + vitest + lint + build (`.github/workflows/ci.yml`)
- GitHub issue templates: bug report, feature request (`.github/ISSUE_TEMPLATE/`)
- Pull request template (`.github/PULL_REQUEST_TEMPLATE.md`)
- CODEOWNERS, Dependabot config
- `CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md`

### Changed
- `README.md` — full rewrite with badges, demo link, screenshot, decision table, layered architecture description
- `.gitignore` — added `.ruff_cache/`

### Known issues (not part of this release)
- `decisions/*.yaml` (87 of 88) have duplicated `antithesis:`/`counterexample:` fields from the v1.0→3.3 migration. **Syntactically valid** YAML, but a fix is planned (PR #TBD: `fix(decisions): dedup migration duplicates`).
- `ui/ARCHITECTURE.md` is a duplicate of `docs/ARCHITECTURE.md`; consolidation planned.
- `ui/ARCHITECTURE.md` still has a "Composer UI" title in line 1 (stale from pre-2026 refactor); rename planned.
- `docs/PLAN.md`, `docs/SUBAGENT-PLAN.md` are internal working documents; moving to `docs/internal/` planned.

## [0.0.0] — pre-release

The project was tracked as `0.0.0` (no released version) before the GitHub-quality
pass. All work was committed to `master` directly. For a per-commit history, see
`git log --oneline`. The first properly versioned release will be **0.1.0**.

---

## Versioning

- **MAJOR** — breaking changes to public API (`ui/src/domain/types.ts`, exported
  services in `infrastructure/`).
- **MINOR** — new features, non-breaking.
- **PATCH** — bug fixes, non-breaking.

The version is currently a placeholder (`0.0.0` in both `package.json` and
`ui/package.json`). The first tagged release will happen after the
`feat/release-0.1.0` branch lands.

## How to read this

- **Added** — new features
- **Changed** — changes in existing functionality
- **Deprecated** — soon-to-be removed features
- **Removed** — now-removed features
- **Fixed** — bug fixes
- **Security** — vulnerability fixes (also see `SECURITY.md`)
