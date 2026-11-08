#!/usr/bin/env bash
#
# Voice cluster: the floating control and the dock.
#
# Run by `mathc verify` (the `scripts/*` verifier scheme) as the
# executable evidence for the `one-floating-voice-control` and
# `dock-has-three-rows` obligations of
# `decisions/wavecode-voice-minimal-dock.yaml`.
#
# It is also a plain script: `bash scripts/verify/voice-cluster-tests.sh`
# works from the repository root.
set -euo pipefail

cd "$(dirname "$0")/../.."

# vitest resolves the `~/` alias through `ui/vite.config.ts`, so it has
# to run FROM the ui directory.
cd ui

exec npx vitest run \
  src/presentation/components/VoiceFAB.test.tsx \
  src/presentation/components/RecordingPanel.test.tsx \
  src/presentation/components/VoiceAIMiniFAB.test.tsx
