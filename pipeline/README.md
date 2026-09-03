# Pipeline (Phase 2)

Offline tools that produce `data/*.json` problem sets for the app. Python 3.10+, managed
with [uv](https://docs.astral.sh/uv/); GNU Backgammon 1.08 for analysis.

## Setup

```bash
winget install --id astral-sh.uv -e
winget install --id GNU.gnubg -e --location C:\gnubg
cd pipeline
uv sync --all-extras
uv run pytest
```

Install gnubg to an ASCII path such as `C:\gnubg`: its 32-bit build cannot open its data
files under a folder with non-ASCII characters. `analyze.py` looks for `gnubg-cli.exe` in
`C:\gnubg`, on `PATH`, or at `--gnubg PATH` / `$BG_GNUBG`.

## analyze.py: XGIDs to problems

```bash
uv run analyze.py positions.txt -o ../data/my-set.json --plies 2
uv run analyze.py positions.txt --merge-into ../data/problems.json --reclassify
```

`positions.txt` has one XGID per line (with or without `XGID=`), optionally followed by an
id; `#` starts a comment. See `examples/seed.txt`.

For every position gnubg gives:

- checker plays: the ranked moves with cubeful equity, equity loss and win / gammon /
  backgammon probabilities (`--max-answers`, default 6);
- cube decisions (dice `00`, or `D` for an offered double): no double / double-take /
  double-pass equities and gnubg's proper cube action, turned into the joint answers the
  quiz uses; the loss of a wrong answer is gnubg's own error size (a wrong doubling decision
  costs `|min(DT, DP) - ND|`, a wrong take/pass claim costs `|DT - DP|`);
- the position class (contact / race / crashed / bearoff).

`--plies` sets the evaluation depth (2 is fast and solid; 3 takes a few seconds per
position). Match equities are shown as normalised money equity (`set output mwc off`).

How it drives gnubg: a first run executes `bgpipeline/gnubg_inner.py` inside gnubg
(`gnubg-cli -t -q -p`) and uses the Python API for structured chequer hints; gnubg's Python
API has no cube hints, so a second run feeds a command file (`-c`) and parses the text of
`hint`. Both approaches are borrowed from xgid2anki and AnkiGammon.

## classify.py: category tags

```bash
uv run classify.py ../data/problems.json --log features.jsonl
uv run classify.py in.json -o out.json --merge --dry-run
```

Rule-based tagging into the Robertie-style taxonomy from board features computed in
`bgpipeline/features.py` (anchors, primes in front of the back checkers, checkers back and
on the bar, pip difference, home-board strength, contact vs race, whether a hit is available,
whether an anchor can be broken, cube state). Rules live in `bgpipeline/classify.py`. The
`--log` file has one JSON line per problem with all features and the tags, for tuning.
`analyze.py` tags new problems automatically (`--no-classify` to skip).

## explain.py: explanations with Claude

```bash
uv run explain.py ../data/problems.json --dry-run            # print the prompts, no API call
uv run explain.py ../data/problems.json                      # fill empty explanations
uv run explain.py ../data/problems.json --only seed-003 --force --model claude-opus-5
```

For each problem without an explanation the prompt carries the question, the position from
Blue's side, the ranked answers with equities, losses and win / gammon rates, and the
classifier's features; Claude answers with 3-5 sentences of plain prose that are stored in
`explanation` with `explanationMeta` (model, date). The file is rewritten after every
problem. The API key is read from `ANTHROPIC_API_KEY` or a git-ignored `.env` (repo root
or `pipeline/`) and never stored. Default model `claude-opus-5`; `--effort` tunes thinking.

## import_forum.py: positions from forum threads

```bash
uv sync --all-extras
uv run import_forum.py urls.txt -o positions.txt --answers answers.json
```

Discourse forums (URLs like `/t/slug/123`, e.g. backgammonforums.com) are read through their
JSON API, so every reply comes with its like count; other pages are scanned for `XGID=`
strings. `positions.txt` feeds `analyze.py`; `answers.json` keeps the replies following each
position, most-liked first, as raw material for explanations.

## Layout

```
analyze.py / classify.py / explain.py / import_forum.py   command-line entry points
bgpipeline/xgid.py        XGID parse/format, perspective views (mirrors src/lib in the app)
bgpipeline/moves.py       legal-play generator + notation (mirrors src/lib/moves.ts)
bgpipeline/gnubg_runner.py, gnubg_inner.py   run gnubg
bgpipeline/gnubg_parse.py  gnubg output -> Problem entries
bgpipeline/features.py, classify.py          features and tagging rules
bgpipeline/explain.py     prompt building + Anthropic SDK call for explanations
bgpipeline/problems.py    ProblemSet JSON read / write / merge
tests/                    pytest (fixtures recorded from gnubg 1.08.003)
```
