#!/usr/bin/env python3
"""
Bulk-fix the 87 decisions/`<id>.yaml` files that have `intent:|`,
`commitment:|`, `counterexample:|`, or `antithesis:|` (no space
after the colon) to the canonical form `intent: |` (with space).

The math-coding OCaml kernel accepts both forms, but strict YAML
parsers (PyYAML safe_load, yamllint, IDE schema validators) reject
the unspaced form. The 87 unspaced decisions in wavecode's live
tree are the only blocker for roundtripping decisions through
any external YAML tool.

The fix changes only the four lines, then recomputes body_sha and
yaml_sha. The semantic content of every decision is unchanged.
This script is idempotent — re-running is a no-op.
"""
from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

WORKTREE = Path(__file__).resolve().parent.parent
DECISIONS_DIR = WORKTREE / "decisions"

PATTERN = re.compile(
    r"^(intent|commitment|counterexample|antithesis):\|",
    flags=re.MULTILINE,
)
PLACEHOLDER = "sha256:" + "0" * 64


def fix_file(path: Path) -> tuple[bool, str]:
    """Fix one decision file. Returns (changed, message)."""
    text = path.read_text(encoding="utf-8")
    new_text, n_substitutions = PATTERN.subn(r"\1: |", text)
    if n_substitutions == 0:
        return False, "no change"
    if new_text == text:
        return False, "no change (regex match but no diff)"
    # Recompute body_sha and yaml_sha
    body_for_hash = re.sub(
        r'body_sha: "sha256:[0-9a-f]{64}"', f'body_sha: "{PLACEHOLDER}"', new_text
    )
    body_for_hash = re.sub(
        r'yaml_sha: "sha256:[0-9a-f]{64}"', f'yaml_sha: "{PLACEHOLDER}"', body_for_hash
    )
    new_digest = hashlib.sha256(body_for_hash.encode("utf-8")).hexdigest()
    final_text = new_text.replace(PLACEHOLDER, f"sha256:{new_digest}")
    path.write_text(final_text, encoding="utf-8")
    return True, f"{n_substitutions} substitution(s), digest={new_digest[:12]}..."


def main() -> int:
    if not DECISIONS_DIR.exists():
        print(f"error: {DECISIONS_DIR} does not exist", file=sys.stderr)
        return 1
    changed = 0
    unchanged = 0
    for path in sorted(DECISIONS_DIR.glob("*.yaml")):
        was_changed, msg = fix_file(path)
        marker = "*" if was_changed else " "
        print(f"  {marker} {path.name}: {msg}")
        if was_changed:
            changed += 1
        else:
            unchanged += 1
    print(f"\nchanged: {changed}, unchanged: {unchanged}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
