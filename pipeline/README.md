# Pipeline

Offline tools that produce `data/*.json` problem sets for the app and import matches and
lessons. Python 3.10+, managed with [uv](https://docs.astral.sh/uv/); GNU Backgammon 1.08 for
analysis.

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
`hint()` refuses cube decisions, so a second run feeds a command file (`-c`) and parses the
text of `hint`. Both approaches are borrowed from xgid2anki and AnkiGammon. (The Python API's
`cfevaluate` does return the no double / double-take / double-pass equities, identical to the
text; the live engine below uses it. The batch runner still uses the text pass.)

## gnubg_server.py: the app's live engine

The play screen (`/play`) needs gnubg's opinion on every decision within a fraction of a
second, so the app keeps one gnubg process running (`src/lib/engine.ts`) with
`bgpipeline/gnubg_server.py` inside it. The script reads one JSON request per line on stdin
(`{"id", "op": "analyse", "xgid", "played"}`) and answers on stdout with lines starting `@@BG `
(gnubg prints boards on the same stream). It imports this package from `BG_PIPELINE_DIR`, so a
decision is ranked, scored and classified by the same code as the match importer
(`gnubg_parse.build_problem`, `match_score.score_decision`, `classify`); cube decisions come
from `gnubg.cfevaluate` and `gnubg.evaluate`. Without `played` it scores gnubg's own choice,
which is how gnubg picks its moves. Measured on this machine: about 2 s to start, 0.05-0.2 s
for a 2-ply checker analysis, 0.03 s for a cube decision. `tests/test_gnubg_server.py` runs the
request handling against a fake gnubg and one live round trip when gnubg is installed.

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

## Explanations

Explanations are not generated here. The app writes them on demand (a button under the
answer reveal, model of your choice) into `data/store.sqlite`, table `explanations`, schema in
`src/lib/store-schema.ts`. Rows are never updated or deleted. Read them from Python with the
standard library:

```python
import sqlite3
conn = sqlite3.connect("../data/store.sqlite")
for pid, model, text in conn.execute("SELECT problem_id, model, explanation FROM explanations ORDER BY id"):
    ...
```

The match importer adds the `matches`, `games` and `decisions` tables to the same file (below).

## import_match.py: Backgammon Galaxy matches

```bash
uv run import_match.py match.mat
uv run import_match.py "C:\Users\me\Downloads\*.mat" --replace
uv run import_match.py match.mat --json          # NDJSON progress, what the app's upload button runs
```

Reads Jellyfish-style `.mat` exports (files, folders or globs; PowerShell does not expand
globs, the script does), replays every game with the legal-play generator and collects the
decisions of one player (`--player`, default 1 = the left column, which is you in a Galaxy
export): every roll with a choice, the pre-roll cube decision whenever your cube was live,
your doubles, takes and passes. Forced plays and dances are stored but not evaluated. gnubg
evaluates the distinct positions in one batch (same two passes as `analyze.py`), the played
move is located in gnubg's full candidate list by resulting position, and its loss is the
best equity minus its equity; cube decisions charge only the half you decided. Everything is
written to `../data/store.sqlite`: `matches` (site, match id, players, length, file, raw
text), `games` (score, Crawford, winner, points) and `decisions` (decision id, XGID, dice,
played, played / best answer ids and equities, loss, forced, class, categories, features and
the ranked answers as JSON). A match already in the store is skipped unless `--replace`,
which rewrites its games and decisions; explanations are keyed by XGID and stay.

The parser follows gnubg's own `.mat` rules (two-colon split, otherwise a double space after
column 15; `Doubles => N`, `Takes`, `Drops`, `Wins N points`) and fails with the line number
on anything else. `--raw-out` / `--raw-in` record and reuse gnubg's raw output
(`tests/fixtures/match_gnubg_plies0.json` drives the offline tests). Exit codes: 2 no gnubg,
3 gnubg failed, 4 a file could not be read or replayed, 5 store error.

## import_lessons.py: Backgammon Galaxy quiz sets

```bash
uv run import_lessons.py "C:\Temp\bg\*.json"
uv run import_lessons.py "Medium - Lesson 1 - Double 5s Blitzes.json" --replace
uv run import_lessons.py copy.json --json --source-name "Medium - Lesson 1.json"   # what the app's upload runs
```

Reads Galaxy quiz exports (the JSON of a finished multiple-choice quiz; files, folders or
globs) and checks their shape (`bgpipeline/galaxy_quiz.py`): Galaxy ids, two to six choices, the
correct one among them, pictures on Galaxy's CDN only, and every problem of the quiz present.
Each choice is kept as written; `kind` is `checker` or `cube` from the answers, and `loss` is
taken from Galaxy's text where it is unambiguous (warnings list the rest). The pictures (the
position, and for checker plays the position after each play) are downloaded with 8 workers
and checked (complete PNG, MD5 equal to the CDN's ETag) by `bgpipeline/image_fetch.py`, then
the set goes into `../data/lessons/lessons.sqlite` (`bgpipeline/lesson_store.py`, schema read
from `src/lib/lesson-store-schema.ts`) with the file kept as `<quiz id>/quiz.json`. The text
before the first " - " of the file name ("Medium", "Hard") becomes the set's collection;
`--source-name` passes an upload's original name.

A set already imported is skipped without any download (missing pictures are counted);
`--replace` rewrites its rows, reusing pictures that still match and downloading only missing
or changed ones. Rows are written only when every picture is on disk. Everything under
`data/lessons/` is git-ignored. Exit codes: 4 a file could not be read or is not a quiz, 5 store
error, 6 a picture could not be downloaded.

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
analyze.py / classify.py / import_forum.py / import_match.py / import_lessons.py   command-line entry points
bgpipeline/cli.py         expand_paths (files, folders, globs), ImportError_, NDJSON emit: shared by the importers
bgpipeline/xgid.py        XGID parse/format, perspective views + with_state (mirrors src/lib in the app)
bgpipeline/moves.py       legal-play generator + notation (mirrors src/lib/moves.ts)
bgpipeline/gnubg_runner.py, gnubg_inner.py   run gnubg (batch)
bgpipeline/gnubg_server.py the app's live engine: runs inside one long-lived gnubg, JSON lines in and out
bgpipeline/gnubg_parse.py  gnubg output (text hint or cfevaluate) -> Problem entries
bgpipeline/features.py, classify.py          features and tagging rules
bgpipeline/problems.py    ProblemSet JSON read / write / merge
bgpipeline/mat.py         .mat match file parser (gnubg's rules)
bgpipeline/replay.py      replay a match, collect one player's decisions with exact XGIDs
bgpipeline/match_score.py score what was played against gnubg's ranking
bgpipeline/store.py       data/store.sqlite with the stdlib; schema read from src/lib/store-schema.ts
bgpipeline/galaxy_quiz.py Galaxy quiz export parser (kind, loss, collection, picture names)
bgpipeline/image_fetch.py picture download with PNG / ETag checks and retries
bgpipeline/lesson_store.py data/lessons/lessons.sqlite with the stdlib; schema read from src/lib/lesson-store-schema.ts
tests/                    pytest (fixtures recorded from gnubg 1.08.003; galaxy_45552673.mat is a real export;
                          galaxy_quiz_synthetic.json is invented, no Galaxy material)
```
