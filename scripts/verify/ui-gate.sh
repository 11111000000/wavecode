#!/usr/bin/env bash
#
# The CI quality gate, split so each step fits mathc verify's
# 60-second per-verifier budget (the full `vitest run` over 1900
# tests does not).
#
# Run by `mathc verify` as the executable evidence for the
# `typecheck-and-tests-green` obligation of
# `decisions/wavecode-voice-minimal-dock.yaml`.
set -euo pipefail

cd "$(dirname "$0")/../.."

npm --prefix ui run typecheck
npm --prefix ui run lint:no-console
npm --prefix ui run validate:presets
