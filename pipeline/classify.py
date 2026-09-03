#!/usr/bin/env python
"""Tag problems with categories using board features (rule based).

    uv run classify.py ../data/problems.json --log features.jsonl
    uv run classify.py in.json -o out.json --merge

Rewrites ``categories`` (and a compact ``features`` map) on every problem. ``--merge`` keeps
existing categories and adds the computed ones. ``--log`` appends one JSON line per problem
with every feature and the resulting tags, for tuning the rules in bgpipeline/classify.py.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bgpipeline.classify import CATEGORIES, apply_classification  # noqa: E402
from bgpipeline.problems import load_problem_set, write_problem_set  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("problems", type=Path, help="ProblemSet JSON")
    ap.add_argument("-o", "--out", type=Path, help="output path (default: rewrite in place)")
    ap.add_argument("--merge", action="store_true", help="keep existing categories, add computed ones")
    ap.add_argument("--log", type=Path, help="append features + tags as JSON lines")
    ap.add_argument("--dry-run", action="store_true", help="print tags, write nothing")
    args = ap.parse_args(argv)

    ps = load_problem_set(args.problems)
    counts: Counter[str] = Counter()
    log = args.log.open("a", encoding="utf-8") if args.log and not args.dry_run else None
    for p in ps["problems"]:
        feats = apply_classification(p, merge=args.merge)
        counts.update(p["categories"])
        print(f"{p['id']:>12}  {', '.join(p['categories'])}")
        if log:
            log.write(json.dumps({"id": p["id"], "xgid": p["xgid"], "categories": p["categories"], **feats}) + "\n")
    if log:
        log.close()
    if not args.dry_run:
        write_problem_set(args.out or args.problems, ps)
    print("\n".join(f"{c:16} {counts[c]}" for c in CATEGORIES if counts[c]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
