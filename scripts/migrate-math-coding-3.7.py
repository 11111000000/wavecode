#!/usr/bin/env python3
"""
Mechanical part of the wavecode math-coding 3.7 upgrade.

The math-coding KERNEL moved to 3.7.x (tool release 3.7.4). The
DECISION FILE FORMAT did not move: the schema family accepted by
the 3.7 kernel is still `math-coding/3.3` — upstream's own
`mathc new-decision` scaffold still emits `schema: math-coding/3.3`,
and upstream's own corpus (251 decisions in the 3.7.4 tree) is
118× `math-coding/3.3` + 127× `math-coding/3.2`. So the `schema:`
string in `decisions/*.yaml` MUST NOT be bumped — it identifies the
file format, not the tool.

What the 3.7 kernel DOES flag, and what this script fixes:

  1. MC-UNPARSED-TAIL — a decision file whose last line is a second
     `---` document marker. The 3.7 loader reads the front-matter
     between the first and the second `---` and treats everything
     after the second marker as an unread tail. 92 of wavecode's
     118 decision files carried that trailing marker (it was
     emitted by `scripts/migrate-v1-packets.py`); the 3.3-era
     kernel did not warn about it.

  2. MC-DUPLICATE-KEY — a mapping key declared twice in the same
     scope. The kernel reads the FIRST occurrence and the second
     block is unreachable: that content never reaches the gate.
     `scripts/migrate-v1-packets.py` emitted the
     `counterexample:`/`antithesis:` pair TWICE per migrated packet
     (its renderer appended the commitment lines a second time and
     then repeated the pair), so 87 of the 118 decision files carry
     a dead second copy — 175 duplicate-key warnings in total. The
     generator is fixed in the same commit; this script deletes the
     dead copies from the tree.

  3. MC-VERIFIER-SCHEME-UNKNOWN — an acceptance verifier whose
     scheme token (the first whitespace-delimited word) is outside
     the canonical allowlist. Two of wavecode's schemes are renamed
     here, following the remediation documented upstream in
     `decisions/verifier-scheme-convention-2026-11.yaml` ("migrate
     to `mathc` + a subcommand arg" for identifier-shaped schemes):
       * `attestation-store-has-subject` -> `mathc self-check`
         (the kernel command that walks the attestation store and
         reports per-subject verdicts)
       * `mathc-validate` -> `mathc validate`
     The remaining non-canonical schemes (`vitest-run-*`,
     `pnpm-ui-*`, `playwright*`, `grep-*`, `bundle-size-*`, ...) are
     identifier-shaped labels whose real command cannot be
     recovered from the string without guessing. Upstream defers
     the same migration in its own corpus (35 of 251 upstream
     decisions carry non-canonical schemes), so the debt is recorded
     as a follow-up obligation in
     `decisions/wavecode-math-coding-3.7.yaml` rather than
     papered over with a prefix that would make the string a lie.

Digests are NOT recomputed here: `mathc rehash --write` is the
kernel's own tool for that (it verifies each stamped file is a
fixed point before writing). Run it after this script.

This script is idempotent: re-running it is a no-op.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

WORKTREE = Path(__file__).resolve().parent.parent
DECISIONS_DIR = WORKTREE / "decisions"

# scheme token -> canonical replacement (whole verifier string).
VERIFIER_RENAMES: dict[str, str] = {
    "attestation-store-has-subject": "mathc self-check",
    "mathc-validate": "mathc validate",
}

VERIFIER_LINE = re.compile(
    r"^(?P<indent>\s*-\s*verifier:\s*)(?P<quote>[\"']?)(?P<body>.*?)(?P=quote)\s*$"
)


def strip_tail_marker(text: str) -> tuple[str, bool]:
    """Drop a trailing standalone `---` document marker.

    The marker must be the last line of the file: the text has to end
    with `---` (with or without a trailing newline), and the character
    before it has to be a newline (otherwise it is a suffix of a longer
    line, not a marker).
    """
    if text.endswith("---\n"):
        head = text[: -len("---\n")]
    elif text.endswith("---"):
        head = text[: -len("---")]
    else:
        return text, False
    if not head.endswith("\n"):
        return text, False
    return head.rstrip("\n") + "\n", True


def rename_verifiers(text: str) -> tuple[str, int]:
    out: list[str] = []
    changed = 0
    for line in text.split("\n"):
        m = VERIFIER_LINE.match(line)
        if m is not None:
            body = m.group("body")
            scheme = body.split(" ")[0] if body else ""
            if scheme in VERIFIER_RENAMES:
                new_body = VERIFIER_RENAMES[scheme]
                quote = m.group("quote")
                line = f"{m.group('indent')}{quote}{new_body}{quote}"
                changed += 1
        out.append(line)
    return "\n".join(out), changed


KEY_LINE = re.compile(r"^(?P<indent> *)(?P<key>[A-Za-z_][A-Za-z0-9_.-]*):(?P<rest>.*)$")


def _mapping_entries(lines: list[str]) -> list[tuple[int, str, int]]:
    """(indent, key, line index) for every mapping entry in the file."""
    out: list[tuple[int, str, int]] = []
    for i, line in enumerate(lines):
        m = KEY_LINE.match(line)
        if m is not None:
            out.append((len(m.group("indent")), m.group("key"), i))
    return out


def _block_end(lines: list[str], start: int, indent: int) -> int:
    """End (exclusive) of the block that starts at line `start`.

    A mapping entry owns every following line that is more indented
    than the key; the first non-blank line at the same indent (or
    less) closes the block.
    """
    end = len(lines)
    for j in range(start + 1, len(lines)):
        line = lines[j]
        if not line.strip():
            continue
        cur = len(line) - len(line.lstrip(" "))
        if cur <= indent:
            end = j
            break
    return end


def _same_scope(lines: list[str], a: int, b: int, indent: int) -> bool:
    """True when no line between a and b has a smaller indent."""
    for line in lines[a + 1 : b]:
        stripped = line.strip()
        if not stripped:
            continue
        if len(line) - len(line.lstrip(" ")) < indent:
            return False
    return True


def dedupe_duplicate_keys(text: str) -> tuple[str, int]:
    """Delete unreachable duplicate mapping keys.

    Two occurrences of the same key in one scope: the kernel reads the
    FIRST and the second block is dead content. When both blocks carry
    the same body, the later one is deleted. When they differ, the
    earlier one is deleted only if it is the known generator artifact
    (the first `antithesis:` block swallowed a second copy of the
    commitment text — the generator emitted the pair twice); anything
    else is left alone rather than guessed at.
    """
    lines = text.split("\n")
    entries = _mapping_entries(lines)
    # Group by (scope, key): two entries are in the same scope when
    # they share the indent and no smaller-indent line separates them.
    removals: list[tuple[int, int]] = []
    seen: dict[tuple[int, str], int] = {}
    for idx, (indent, key, start) in enumerate(entries):
        prev = seen.get((indent, key))
        if prev is not None and _same_scope(lines, entries[prev][2], start, indent):
            prev_start = entries[prev][2]
            prev_body = "\n".join(lines[prev_start : _block_end(lines, prev_start, indent)]).strip()
            cur_body = "\n".join(lines[start:_block_end(lines, start, indent)]).strip()
            if prev_body == cur_body:
                removals.append((start, _block_end(lines, start, indent)))
            elif key == "antithesis" and _ends_with_commitment(lines, prev_body):
                removals.append((prev_start, _block_end(lines, prev_start, indent)))
            else:
                print(f"    note: divergent duplicate '{key}' left untouched")
        else:
            seen[(indent, key)] = idx
    if not removals:
        return text, 0
    drop: set[int] = set()
    for start, end in removals:
        drop.update(range(start, end))
    kept = [line for i, line in enumerate(lines) if i not in drop]
    return "\n".join(kept), len(removals)


def _ends_with_commitment(lines: list[str], body: str) -> bool:
    """True when a block body ends with the file's commitment text.

    That is the fingerprint of the `migrate-v1-packets.py` artifact:
    the renderer appended the commitment lines after the first
    `antithesis:` block, so the first antithesis ends with a copy of
    the commitment that is still present in its own key.
    """
    commitment = ""
    for i, line in enumerate(lines):
        if line.startswith("commitment:"):
            for j in range(i + 1, len(lines)):
                nxt = KEY_LINE.match(lines[j])
                if nxt is not None and len(nxt.group("indent")) == 0:
                    break
                commitment += lines[j].strip() + "\n"
            break
    commitment = commitment.strip()
    if not commitment:
        return False
    tail = [l.strip() for l in body.split("\n") if l.strip()]
    ctail = [l.strip() for l in commitment.split("\n") if l.strip()]
    if not ctail:
        return False
    return tail[-len(ctail):] == ctail


def fix_file(path: Path) -> tuple[bool, str]:
    text = path.read_text(encoding="utf-8")
    new_text, tail = strip_tail_marker(text)
    new_text, dedupes = dedupe_duplicate_keys(new_text)
    new_text, renames = rename_verifiers(new_text)
    if new_text == text:
        return False, "no change"
    path.write_text(new_text, encoding="utf-8")
    notes = []
    if tail:
        notes.append("tail marker dropped")
    if dedupes:
        notes.append(f"{dedupes} duplicate key block(s) dropped")
    if renames:
        notes.append(f"{renames} verifier scheme(s) renamed")
    return True, ", ".join(notes)


def main() -> int:
    files = sorted(DECISIONS_DIR.glob("*.yaml"))
    changed = 0
    for path in files:
        ok, note = fix_file(path)
        if ok:
            changed += 1
            print(f"  {path.name}: {note}")
    print(f"migrate-math-coding-3.7: {changed} of {len(files)} decision files changed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
