#!/usr/bin/env bash
#
# Two structural checks on the voice cluster that a plain grep over the
# whole file cannot express:
#
#   1. The dock is anchored by the MEASURED cluster token, never by a
#      literal pixel offset. The old offset overshot the real cluster
#      height by ~44px and, once the panel grew tall enough, slid its
#      buttons under `.app-transport-bar` — whose z-index beats the
#      panel's, so the buttons became unclickable.
#
#   2. No recording subsystem that was never mounted came back: the
#      files are gone, so no name may survive anywhere in the tree.
#
# Run by `mathc verify` (the `scripts/*` verifier scheme) as the
# executable evidence for the `panel-css-has-no-magic-offset` and
# `no-dead-recording-subsystems` obligations of
# `decisions/wavecode-voice-minimal-dock.yaml`.
set -euo pipefail

cd "$(dirname "$0")/../.."

if rg -q 'calc\(var\(--tabbar-h\) \+ [0-9]+px' ui/src/styles/components.css; then
  echo "voice CSS: a literal pixel offset is back" >&2
  rg -n 'calc\(var\(--tabbar-h\) \+ [0-9]+px' ui/src/styles/components.css >&2
  exit 1
fi

if ! rg -q 'bottom: var\(--voice-fab-cluster-h\)' ui/src/styles/components.css; then
  echo "voice CSS: the dock is not anchored by --voice-fab-cluster-h" >&2
  exit 1
fi

if rg -q 'RecordButton|LoopRecorderPanel|recorderStore|WhisperSTTStub|WakeWordDetector' ui/src; then
  echo "a recording subsystem that was never mounted is referenced again" >&2
  rg -n 'RecordButton|LoopRecorderPanel|recorderStore|WhisperSTTStub|WakeWordDetector' ui/src >&2
  exit 1
fi
