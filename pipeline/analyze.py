#!/usr/bin/env python
"""Analyse backgammon positions with GNU Backgammon and write problem-set JSON for the app.

    uv run analyze.py positions.txt -o ../data/my-set.json --plies 2
    uv run analyze.py positions.txt --merge-into ../data/problems.json

Input: one XGID per line (with or without the ``XGID=`` prefix), optionally followed by an id
(``XGID... my-id``). Blank lines and ``#`` comments are ignored. Output: a ProblemSet JSON
(``{"name", "source", "problems": [...]}``) that the app loads from ``data/``. With
``--merge-into`` existing problems with the same XGID are updated in place (their id,
explanation and, unless ``--reclassify``, categories are kept) and new ones are appended.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bgpipeline.classify import apply_classification  # noqa: E402
from bgpipeline.gnubg_parse import ParseError, build_problem  # noqa: E402
from bgpipeline.gnubg_runner import GnubgError, find_gnubg, run_gnubg  # noqa: E402
from bgpipeline.problems import (  # noqa: E402
    load_problem_set,
    merge_problems,
    new_problem_set,
    next_id,
    write_problem_set,
)
from bgpipeline.xgid import XgidError, parse_xgid, strip_prefix  # noqa: E402


def read_positions(path: Path) -> list[tuple[str, str | None]]:
    out: list[tuple[str, str | None]] = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        s = line.split("#", 1)[0].strip()
        if not s:
            continue
        parts = s.split()
        xgid = strip_prefix(parts[0])
        try:
            parse_xgid(xgid)
        except XgidError as e:
            print(f"{path}:{lineno}: skipping invalid XGID ({e})", file=sys.stderr)
            continue
        out.append((xgid, parts[1] if len(parts) > 1 else None))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("positions", type=Path, help="text file with one XGID per line")
    ap.add_argument("-o", "--out", type=Path, help="write a new ProblemSet JSON here")
    ap.add_argument("--merge-into", type=Path, help="update/append into an existing ProblemSet JSON")
    ap.add_argument("--plies", type=int, default=2, help="chequer-play evaluation depth (default 2)")
    ap.add_argument("--cube-plies", type=int, default=None, help="cube evaluation depth (default: --plies)")
    ap.add_argument("--gnubg", help="path to gnubg-cli.exe (default: auto-detect, or $BG_GNUBG)")
    ap.add_argument("--name", default="gnubg", help="problem set name for --out")
    ap.add_argument("--source", default=None, help="source label stored on each problem")
    ap.add_argument("--id-prefix", default="gnubg", help="prefix for generated ids (gnubg-001, ...)")
    ap.add_argument("--max-answers", type=int, default=6, help="ranked answers to keep per problem")
    ap.add_argument("--no-classify", action="store_true", help="skip category tagging")
    ap.add_argument("--reclassify", action="store_true", help="with --merge-into: replace existing categories")
    ap.add_argument("--features-log", type=Path, help="append one JSON line of features per problem")
    ap.add_argument("--timeout", type=float, default=None, help="seconds before giving up on gnubg")
    args = ap.parse_args(argv)

    if not args.out and not args.merge_into:
        ap.error("give -o/--out or --merge-into")
    exe = find_gnubg(args.gnubg)
    if not exe:
        print("gnubg-cli.exe not found. Install GNU Backgammon (winget install GNU.gnubg --location C:\\gnubg)", file=sys.stderr)
        return 2

    positions = read_positions(args.positions)
    if not positions:
        print("no valid positions", file=sys.stderr)
        return 1

    target = load_problem_set(args.merge_into) if args.merge_into else new_problem_set(args.name, args.source)
    existing_ids = {p["id"] for p in target["problems"]}
    existing_by_xgid = {p["xgid"]: p for p in target["problems"]}

    try:
        raw = run_gnubg(
            [x for x, _ in positions],
            plies=args.plies,
            cube_plies=args.cube_plies,
            gnubg=exe,
            timeout=args.timeout,
            log=lambda m: print(m, file=sys.stderr),
        )
    except GnubgError as e:
        print(f"gnubg failed: {e}", file=sys.stderr)
        return 3

    problems: list[dict] = []
    failures = 0
    log_file = args.features_log.open("a", encoding="utf-8") if args.features_log else None
    for (xgid, given_id), rec in zip(positions, raw):
        pid = given_id or (existing_by_xgid[xgid]["id"] if xgid in existing_by_xgid else next_id(args.id_prefix, existing_ids))
        existing_ids.add(pid)
        try:
            problem = build_problem(rec, problem_id=pid, max_answers=args.max_answers, plies=args.plies, source=args.source)
        except ParseError as e:
            failures += 1
            print(f"{xgid}: {e}", file=sys.stderr)
            continue
        if not args.no_classify:
            feats = apply_classification(problem)
            if log_file:
                log_file.write(json.dumps({"id": pid, "xgid": xgid, "categories": problem["categories"], **feats}) + "\n")
        problems.append(problem)
    if log_file:
        log_file.close()

    if args.merge_into:
        merge_problems(target, problems, keep_categories=not args.reclassify)
        write_problem_set(args.merge_into, target)
        dest = args.merge_into
    else:
        target["problems"].extend(problems)
        write_problem_set(args.out, target)
        dest = args.out

    for p in problems:
        best = p["answers"][0]
        gap = p["answers"][1]["equityLoss"] if len(p["answers"]) > 1 else 0.0
        cls = p["analysis"].get("positionClass", "?")
        print(f"{p['id']:>12}  {p['type']:7} {cls:8} best={best['label']:<22} gap={gap:.3f}  [{', '.join(p['categories'])}]")
    print(f"wrote {len(problems)} problem(s) to {dest}" + (f", {failures} failed" if failures else ""))
    return 0 if not failures else 4


if __name__ == "__main__":
    sys.exit(main())
