#!/usr/bin/env python
"""Write 3-5 sentence explanations for problems with Claude and cache them in the JSON.

    uv run explain.py ../data/problems.json
    uv run explain.py ../data/problems.json --only seed-003,seed-004 --force
    uv run explain.py ../data/problems.json --dry-run          # print the prompts, no API call

Skips problems that already have an explanation unless --force. The file is rewritten after
every generated explanation, so an interrupted run keeps what it produced. The API key is
read from ANTHROPIC_API_KEY (or a git-ignored .env in the repo root or pipeline/); nothing
about it is stored.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bgpipeline.explain import (  # noqa: E402
    DEFAULT_MODEL,
    ExplainError,
    build_prompt,
    explain_problems,
    load_dotenv,
    make_generator,
)
from bgpipeline.problems import load_problem_set, write_problem_set  # noqa: E402

HERE = Path(__file__).resolve().parent


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("problems", type=Path, help="ProblemSet JSON")
    ap.add_argument("-o", "--out", type=Path, help="output path (default: rewrite in place)")
    ap.add_argument("--only", help="comma-separated problem ids")
    ap.add_argument("--force", action="store_true", help="regenerate existing explanations")
    ap.add_argument("--limit", type=int, help="stop after N explanations")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--effort", choices=["low", "medium", "high", "xhigh", "max"], help="thinking effort (default: the API default)")
    ap.add_argument("--dry-run", action="store_true", help="print the prompts and exit without calling the API")
    args = ap.parse_args(argv)

    ps = load_problem_set(args.problems)
    only = set(args.only.split(",")) if args.only else None
    dest = args.out or args.problems

    if args.dry_run:
        for p in ps["problems"]:
            if only and p["id"] not in only:
                continue
            if p.get("explanation") and not args.force:
                continue
            print(f"===== {p['id']}\n{build_prompt(p)}\n")
        return 0

    load_dotenv([HERE.parent / ".env", HERE / ".env"])
    import anthropic  # noqa: E402  (after .env so the client sees the key)

    try:
        generate = make_generator(args.model, effort=args.effort)
    except anthropic.AnthropicError as e:
        print(f"could not create the client: {e}", file=sys.stderr)
        return 2

    def on_done(p: dict, meta: dict) -> None:
        write_problem_set(dest, ps)
        cached = meta.get("cache_read_input_tokens") or 0
        print(f"{p['id']:>12}  {meta['input_tokens']} in ({cached} cached) / {meta['output_tokens']} out  {p['explanation'][:90]}...")

    try:
        n = explain_problems(ps["problems"], generate, force=args.force, only=only, limit=args.limit, on_done=on_done)
    except anthropic.AuthenticationError:
        print("authentication failed: set ANTHROPIC_API_KEY (or put it in a git-ignored .env) or run `ant auth login`", file=sys.stderr)
        return 2
    except anthropic.RateLimitError as e:
        print(f"rate limited, try again later: {e}", file=sys.stderr)
        return 3
    except anthropic.APIStatusError as e:
        print(f"API error {e.status_code}: {e.message}", file=sys.stderr)
        return 3
    except anthropic.APIConnectionError as e:
        print(f"network error: {e}", file=sys.stderr)
        return 3
    except ExplainError as e:
        print(f"generation failed: {e}", file=sys.stderr)
        return 4
    print(f"generated {n} explanation(s) into {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
