#!/usr/bin/env bash
#
# The voice store: the send queue, the failure kind, the mic release.
#
# Run by `mathc verify` (the `scripts/*` verifier scheme) as the
# executable evidence for the `send-queue-is-not-a-no-op`,
# `failure-kind-is-data`, `mic-released-at-capture-close` and
# `composer-survives-an-empty-transcript` obligations of
# `decisions/wavecode-voice-minimal-dock.yaml`.
set -euo pipefail

cd "$(dirname "$0")/../.."

# vitest resolves the `~/` alias through `ui/vite.config.ts`, so it has
# to run FROM the ui directory.
cd ui

exec npx vitest run \
  src/presentation/state/voiceAIStore.test.ts
