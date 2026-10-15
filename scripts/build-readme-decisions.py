#!/usr/bin/env python3
"""build-readme-decisions.py — generate a markdown table of architectural
decisions from `decisions/*.yaml` for inclusion in README.md / README.en.md.

Usage:
    python3 scripts/build-readme-decisions.py           # writes to stdout
    python3 scripts/build-readme-decisions.py --out TABLE.md

Output format (markdown table, 3 cols):
    | id | state | intent (first 2 lines, ≤150 chars) |
    |---|---|---|
    | wavecode-scope | active | ... |

Filtering:
    - All decisions/*.yaml are included by default
    - Use --ids wavecode-scope,wavecode-stack-performance to restrict
      to a curated subset (used by the top-level README, where 16
      foundational decisions are highlighted out of 88 total).

YAML handling: we do NOT pull in PyYAML on purpose — most fields in the
math-coding 3.3 schema use `|` block-scalar, and a hand-written state
machine (below) handles id/state/intent/header without needing a parser.
If the schema grows, swap to `import yaml` and `yaml.safe_load`.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

DECISIONS_DIR = Path(__file__).resolve().parent.parent / "decisions"
MAX_INTENT_CHARS = 150
INTENT_LINES = 2


def parse_decision(path: Path) -> dict:
    """Pull the fields we need out of a single decisions/<id>.yaml.

    The schema (math-coding 3.3) puts id/state at the top level, then
    `intent: |` followed by an indented block scalar. We grab the
    first INTENT_LINES non-empty lines of that block.
    """
    text = path.read_text(encoding="utf-8")
    out: dict = {"id": None, "state": "draft", "intent": ""}
    in_intent = False
    intent_lines: list[str] = []
    for raw in text.splitlines():
        stripped = raw.rstrip()
        if not in_intent:
            if stripped.startswith("id:"):
                out["id"] = stripped.split(":", 1)[1].strip()
            elif stripped.startswith("state:"):
                out["state"] = stripped.split(":", 1)[1].strip() or "draft"
            elif stripped.startswith(("intent: |", "intent: |-")):
                in_intent = True
        else:
            # End of block scalar: any non-indented, non-empty line that
            # starts with a yaml key (alphanumeric + colon) terminates it.
            if stripped and not raw.startswith((" ", "\t")) and ":" in stripped:
                in_intent = False
                continue
            if stripped:
                intent_lines.append(stripped.lstrip())
                if len(intent_lines) >= INTENT_LINES:
                    break
    intent = " ".join(intent_lines)
    if len(intent) > MAX_INTENT_CHARS:
        intent = intent[: MAX_INTENT_CHARS - 1].rstrip() + "…"
    out["intent"] = intent
    return out


def list_decisions(filter_ids: list[str] | None) -> list[dict]:
    paths = sorted(DECISIONS_DIR.glob("*.yaml"))
    out = [parse_decision(p) for p in paths]
    if filter_ids:
        wanted = set(filter_ids)
        out = [d for d in out if d["id"] in wanted]
    return out


def render_table(decisions: list[dict]) -> str:
    lines = [
        "| Решение | Статус | Резюме |",
        "|---|---|---|",
    ]
    for d in decisions:
        if not d["id"]:
            continue
        # escape pipe in intent (rare in our data, but cheap to be safe)
        intent = d["intent"].replace("|", "\\|")
        lines.append(f"| `{d['id']}` | {d['state']} | {intent} |")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument(
        "--ids",
        default=None,
        help="comma-separated decision ids to include (default: all)",
    )
    p.add_argument("--out", default=None, help="write to file instead of stdout")
    args = p.parse_args(argv)

    filter_ids = [s.strip() for s in args.ids.split(",")] if args.ids else None
    decisions = list_decisions(filter_ids)
    if not decisions:
        print("error: no decisions matched", file=sys.stderr)
        return 1
    table = render_table(decisions)
    if args.out:
        Path(args.out).write_text(table, encoding="utf-8")
        print(f"wrote {args.out} ({len(decisions)} rows)", file=sys.stderr)
    else:
        sys.stdout.write(table)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
