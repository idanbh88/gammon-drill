# Backgammon Trainer — guide for Claude Code sessions

Read `docs/SPEC.md` for the product spec, data model, scoring rules and the decision log.
This file is the short operational guide. Keep both current when behaviour changes.

## What this is

A quiz app for backgammon checker plays and cube decisions. Positions are XGIDs, GNU
Backgammon evaluates them offline (`pipeline/`, Python + uv), the Next.js app quizzes the user,
tracks mistakes in `localStorage`, and writes Claude explanations on demand into
`data/store.sqlite`. The user's own Backgammon Galaxy matches (`.mat` exports) can be uploaded
at `/matches`: the app runs the Python importer, which replays the match, has gnubg evaluate
the user's decisions and stores them in the same SQLite file; the match page lists the errors
with the same explanation panel. Backgammon Galaxy quiz sets (JSON exports, picture-based
multiple choice) are lessons at `/lessons`: `import_lessons.py` downloads every picture and
writes `data/lessons/lessons.sqlite`, a separate, git-ignored database. At `/play` the user plays
matches against gnubg: one long-lived gnubg process (`src/lib/engine.ts` +
`pipeline/bgpipeline/gnubg_server.py`) plays its best 2-ply move and grades each of the user's
decisions as it is made; the games go into the same match tables, PR is shown for both sides,
and every error of the user (games and imports) is in the quiz as "My mistakes". Phases 1–6 are
built; phase 7 is planned; see `docs/SPEC.md` § Status for what is still open.

Repository: https://github.com/idanbh88/gammon-drill, branch `main`. Commit or push only when asked.

## Commands

App (repo root, Node 24):

```bash
npm run dev        # http://localhost:3000 (quiz), /play (gnubg), /lessons (Galaxy lessons), /stats (progress), /board (all positions), /matches (imported and played matches)
npm test           # vitest: xgid, board, moves, move-input, game, play-service, play-ui, pr, mistakes, engine (live when gnubg is installed), data, filters, scheduler, store, matches, explain, lessons, lesson-*, pipeline-process, ndjson
npm run typecheck
npm run lint
npm run build
```

Explanations need `ANTHROPIC_API_KEY` in a git-ignored `.env` at the repo root (copy
`.env.example`); the dev server loads it, the browser never sees it. Generation happens only
from the button under the answer reveal (quiz) or under a match decision. `GET
/api/explain?problemId=seed-001` (or a decision id such as `match-45552673-g1-m3-checker`) shows
the prompt without calling the API. The match upload (`POST /api/matches/import`) needs `uv` on
the dev server's PATH (or `BG_UV`) and gnubg at `C:\gnubg`; the lesson upload
(`POST /api/lessons/import`) needs `uv` and network access to Galaxy's picture CDN. Playing
(`POST /api/play`, `GET|POST /api/play/<id>`) needs gnubg only (found like the pipeline does:
`BG_GNUBG`, PATH, `C:\gnubg`); no uv, no network. `POST /api/quiz-picks` adds a decision to
the quiz or takes it out.

Pipeline (`cd pipeline`, run from PowerShell, see quirks below):

```bash
uv sync --all-extras
uv run pytest
uv run analyze.py examples/seed.txt --merge-into ../data/problems.json --reclassify
uv run classify.py ../data/problems.json --log features.jsonl
uv run import_match.py "C:\Users\<me>\Downloads\*.mat"       # what the upload button runs; --replace to analyse again
uv run import_lessons.py "C:\Temp\bg\*.json"                  # Galaxy quiz exports -> data/lessons/ (the lessons upload runs it); --replace to import again
```

Browser preview: `.claude/launch.json` has the `dev` server. Verify UI changes there.

## Layout

```
data/*.json                 problem sets (ProblemSet JSON), data/README.md documents the format
data/store.sqlite           explanations (append-only, with the effort asked for) + matches / games / decisions + play_state, quiz_picks (schema v4 in src/lib/store-schema.ts)
data/matches/               uploaded .mat files, as received
data/lessons/               GIT-IGNORED Galaxy lessons: lessons.sqlite, <quiz id>/quiz.json (as received), <quiz id>/images/pNN[-cM].png
src/app/                    page.tsx quiz, play/ new match + [id]/ game, lessons/ list + [id]/ player, stats/ progress, board/ every position rendered, matches/ list + [id]/ review
src/app/api/play/           route.ts (new match), [id]/route.ts (state, one user action -> graded + gnubg's turn)
src/app/api/quiz-picks/     route.ts: add a decision of the user to the quiz or take it out
src/app/api/explain/        route.ts: builds the prompt, calls the Anthropic SDK, inserts the store row
src/app/api/matches/import/ route.ts: saves the upload, spawns uv run import_match.py, streams its NDJSON progress
src/app/api/lessons/        import/route.ts (runs import_lessons.py like the match upload), images/[quizId]/[file]/route.ts (serves pictures)
src/components/             Board.tsx (SVG, hook-free; optional play props: highlights, dice, hidden checkers, overlay, pointer
                            handlers, last-move marks), Quiz.tsx, ExplanationPanel.tsx, FilterPanel.tsx, AnswerReveal.tsx,
                            CategoryStats.tsx, PlayGame.tsx (the game screen, client-only via PlayLoader), PlayBoard.tsx (tap / drag
                            / dice input, animation frames), FlyingChecker.tsx (Web Animations glide), DecisionFeedback.tsx (verdict +
                            ranking + quiz toggle + explanation), NewMatchForm.tsx,
                            UploadMatch.tsx (file input + progress log), MatchReview.tsx (errors per game, PR, both sides),
                            Lesson.tsx (lesson player), LessonList.tsx (sets + progress), UploadLessons.tsx, *Loader.tsx (ssr: false)
src/lib/xgid.ts, board.ts   XGID parse/format, perspective flip (+ withState inverse), pip counts, question text
src/lib/moves.ts            legal-play generator (+ legalSequences, every entry order) + gnubg-style notation
src/lib/move-input.ts       move entry, Galaxy style: dice in tap order (swap), tap = first die that works, drag destinations, undo
src/lib/board-geometry.ts   board layout in SVG units: checker slots per point / bar / tray, point under a coordinate
src/lib/board-animation.ts  animation frames: gnubg's turn from the server's events, the user's taps / drops, speeds
src/lib/play-settings.ts    animation speed (localStorage) and the new match's events handed to the game page (sessionStorage)
src/lib/game.ts             match rules for play (turns, cube, gammons, Jacoby, Crawford, score); pure, dice passed in
src/lib/engine.ts           the live gnubg process (singleton on globalThis, JSON lines, queue, restart, idle stop)
src/lib/play-service.ts     one user action: rules, grading, gnubg's turn, one transaction; play-store.ts: its SQL;
                            play-server.ts: store + engine + dice for routes; play-ui.ts: texts, verdicts, previews, marks
src/lib/pr.ts               PR per player (500 × loss per counted decision), gnubg's close-cube rule and rating words
src/lib/mistakes.ts         "My mistakes": the automatic rule (loss >= 0.02), quiz picks, decision -> problem with origin
src/lib/validate.ts         semantic checks on problems (loader and data test use it)
src/lib/filters.ts          category / type / difficulty filters
src/lib/scheduler.ts        spaced repetition + per-category stats from the attempt log
src/lib/storage.ts          attempt log in localStorage
src/lib/store.ts            node:sqlite access to data/store.sqlite (explanations insert / select, match tables select)
src/lib/matches.ts          decision row -> Problem + played move, error thresholds, lossClass, summaries (client-safe)
src/lib/explain.ts          prompt builder + text cleaning; explain-models.ts picker; explain-audit.ts number/move check
src/lib/lesson-store.ts     node:sqlite reads of data/lessons/lessons.sqlite (schema in lesson-store-schema.ts), image paths
src/lib/lessons.ts          lesson view types, grouping, image URLs, choice colours (client-safe)
src/lib/lesson-progress.ts  lesson answers + runs in localStorage, per-set progress; lesson-player.ts: the player's reducer
src/lib/pipeline-process.ts findUv + spawn a Python importer and stream its NDJSON (both upload routes); ndjson.ts: client reader
src/types/problem.ts        Problem / Answer / ProblemSet types + zod schemas
pipeline/analyze.py         XGIDs -> gnubg -> problem set JSON
pipeline/classify.py        rule-based category tags + feature log
pipeline/import_forum.py    XGIDs and liked replies from forum threads
pipeline/import_match.py    .mat -> replay -> gnubg -> match tables in data/store.sqlite (CLI and the app's upload)
pipeline/import_lessons.py  Galaxy quiz JSON -> pictures + data/lessons/lessons.sqlite (CLI and the app's upload)
pipeline/bgpipeline/gnubg_server.py  runs inside the app's gnubg: JSON request per stdin line -> "@@BG " answers (hint / cfevaluate + pipeline scoring)
pipeline/bgpipeline/        xgid.py, moves.py (ports of src/lib), gnubg_*.py, features.py, classify.py,
                            mat.py (.mat parser), replay.py (decisions + XGIDs), match_score.py, store.py (sqlite, schema from the .ts),
                            cli.py (expand_paths, NDJSON emit), galaxy_quiz.py (export parser), image_fetch.py, lesson_store.py
```

## Conventions that must not drift

- **Blue** is the player who has to act and is always drawn at the bottom, moving
  counter-clockwise with the home board bottom-right. For dice `D` (a double was offered) the
  acting player is the opponent of the turn player.
- **XGID**: index 0 = player 2's bar, 1–24 from player 1's side (1 = player 1's ace point),
  25 = player 1's bar; uppercase = player 1; cube and max-cube fields are log2; owner 1/0/−1;
  turn 1/−1; dice `00`, two digits, `D`, `B`, `R`. Details in `docs/SPEC.md`.
- **Moves** are gnubg-style notation in Blue's numbering (bar = 25, off = 0). Legality is
  judged by the resulting position, so `13/10 10/7` equals `13/7`. Every checker answer in
  `data/` must pass `validateProblem`; the data test enforces it.
- **Pip counts** drawn on the board are computed from the XGID; the opening position must
  show 167 / 167. A rendering that disagrees with the numbers is a bug.
- **Cube answers** use joint ids (`no-double`, `double-take`, `double-pass`, `too-good`) or
  `take` / `pass` for dice `D`. The loss rule is in `docs/SPEC.md` § Cube answer scoring.
- **Data stays separate from code**: problem sets are `data/*.json`, all loaded automatically,
  ids unique across files. Never commit `.env`.
- **Explanations** are generated only from the quiz's button (never in batch, never on load)
  and inserted into `data/store.sqlite`; rows are never updated or deleted, the loader shows the
  newest row per XGID, and the JSON `explanation` field is only a hand-written fallback. The
  schema lives in `src/lib/store-schema.ts` with its version in table `meta`; Python reads the
  same file with the standard library `sqlite3`. Bump `PROMPT_VERSION` in `src/lib/explain.ts`
  when the prompt changes.
- **Matches**: the user is always Player 1 (the `[Player 1 …]` header, the left column) and
  only Player 1's decisions are analysed. The `.mat` parser follows gnubg's importer rules and
  refuses unknown records (no Galaxy sample with cube actions exists yet). Decision ids are
  `match-<site match id>-g<game>-m<move>-<kind>` and explanations for them are stored like any
  other (keyed by XGID, `problem_id` = decision id). Loss ≥ 0.02 is an error, ≥ 0.08 a blunder
  (`src/lib/matches.ts`). Re-importing with `--replace` rewrites a match's games and decisions;
  that is the one allowed delete in the store. Schema changes go in `src/lib/store-schema.ts`
  only (Python reads it by regex) and must stay additive or come with a migration on both sides.
  A new column goes in its CREATE TABLE and in `ADDED_COLUMNS` (both openers ALTER older files);
  reads of a file opened read-only must tolerate the column being missing (`hasColumn`).
- **Playing gnubg**: the user is player 1 and stays Blue at the bottom on the play screen (the one
  exception to "Blue = the acting player"). The app writes these matches (site `gnubg`) into the
  match tables as they are played, with decisions of both players (ids
  `play-<match>-g<game>-m<move>-<kind>`, gnubg's with `-p2`) and the game in progress in
  `play_state` (a `version` guards double submits); they are never deleted. The rules live in
  `game.ts` only (pure, dice passed in; tests script games); the server rolls the dice. gnubg is
  graded by its own analysis, so its PR is 0.0. Engine calls happen before the one transaction
  that stores a request's rows. The live engine imports the pipeline, so scoring stays in
  Python (`match_score.score_decision`); do not port it to TypeScript.
- **PR** is `src/lib/pr.ts` only: 500 × equity lost per counted decision, gnubg's rule for
  which no-doubles count (close within 0.16, or a missed double). **My mistakes**: every scored,
  unforced decision of the user losing >= 0.02 is a quiz problem (id = decision id) unless
  `quiz_picks` says otherwise; the quiz always offers the move played.
- **Lessons** (Galaxy quiz sets) are pictures, not XGIDs: none of the board, `validateProblem` or
  cube-id rules apply. Keys are Galaxy's ids: a set is its quiz id (`/lessons/<id>`, folder
  `data/lessons/<id>`), a problem `lesson-<galaxy problem id>`. Answers and Galaxy's equity text
  are shown exactly as written, `loss` only where the text is unambiguous, and the verdict comes
  from `correct` (one wrong play loses 0.000). Everything under `data/lessons/` is git-ignored
  (the repo is public, the material is Galaxy's): never commit it, and never drop an export into
  `data/` itself (the quiz loader would reject it). The lesson schema is
  `src/lib/lesson-store-schema.ts` (same regex rules as the main one); `--replace` rewrites one
  set's rows, the only delete there, and reuses pictures that still match.
- `src/lib/xgid.ts` + `moves.ts` (+ `withState` in `board.ts`) and `pipeline/bgpipeline/xgid.py`
  + `moves.py` are ports of each other; change both and mirror the tests.
- `localStorage` keys: `bg-trainer/attempts/v1`, `bg-trainer/filters/v2` (v1 is migrated on
  load), `bg-trainer/lessons/v1` (lesson answers and runs, separate from the quiz),
  `bg-trainer/play/v1` (animation speed). Changing a shape needs a new version key plus a
  migration. sessionStorage `bg-trainer/play-start/<match>` is a one-time hand-off, removed on read.
- **Play screen input and animation**: `Board.tsx` stays a hook-free picture (server pages render
  it); everything interactive is `PlayBoard` + `FlyingChecker` passing props in. Animations are
  frame lists from `board-animation.ts` (pure, tested); positions for flights come from
  `board-geometry.ts`, never from DOM measurements. Entry always goes through `move-input.ts`, so
  a tap or drop can only continue a legal play.

## Machine quirks (this Windows box)

- The user's home path contains Hebrew. gnubg must live at `C:\gnubg` (the installer default
  under the profile breaks its file loading); `gnubg_runner.py` hands gnubg an 8.3 short path
  for the script. Python 3.10 fails to start when a `.pth` file holds the path, so `pipeline/`
  is `[tool.uv] package = false`; never make it an editable install.
- `uv` runs from PowerShell only; Git Bash cannot execute it, and `python` in Git Bash is the
  Microsoft Store stub. Use `uv run python` or `py`.
- Bash heredocs above roughly 8 KB fail with "unexpected EOF"; write large files with the
  Write tool and keep Bash heredocs small.
- PowerShell 5.1 `Set-Content` / `Out-File` add a BOM; write files with
  `[IO.File]::WriteAllText(path, text, [Text.UTF8Encoding]::new($false))`, and give `[IO.File]`
  absolute paths: .NET's working directory ignores `Set-Location`.
- `pipeline/tests/fixtures/hint_cube.txt` is not UTF-8 (gnubg's code page); read it with
  `errors="replace"`.
- Stay on ESLint 9 (`eslint-config-next` 16 breaks on ESLint 10). Next 16 lint rules forbid
  `setState` inside effects and JSX inside try/catch.
- `create-next-app` refuses the directory name (capital letters); the scaffold is hand-written.
  npm 8.11 with Node 24 works; ignore engine warnings.
- gnubg's Python `hint()` refuses cube decisions, so the batch runner uses a text-mode `hint`
  pass; `gnubg.cfevaluate(gnubg.board(), gnubg.cubeinfo(), gnubg.evalcontext())` does return
  (optimal, ND, DT, DP, code, "Double, take") with the same numbers, and the live engine uses it
  (`gnubg.evalcontext()` takes no tuple). gnubg prints a board after every `set xgid`, so the
  live engine's answers are the lines starting `@@BG `. Move filters must be set explicitly or
  `hint` silently stays at 0-ply.
- The live engine copies `gnubg_server.py` to `os.tmpdir()` (here the ASCII 8.3 path
  `C:\Users\62C9~1\...`) because gnubg opens `-p` scripts with the ANSI code page; the Python
  inside gnubg imports the pipeline from the Unicode path in `BG_PIPELINE_DIR` without trouble.
- On 2026-09-24 a freshly started dev server answered 404 (Next's HTML not-found page) for every
  `/api/*` route while pages worked; the route manifest listed them. A restart fixed it, cause
  unknown: when an API route 404s with HTML, restart the dev server before debugging.
- Next 16 allows one `next dev` per folder (a second one exits with "Another next dev server is
  already running"); `.claude/launch.json` has `autoPort`, but when another session holds the
  folder the new server dies at once: navigate the Browser pane to the running one on
  `localhost:3000` instead (same files, HMR picks up edits). `node:sqlite` bundles fine in route
  handlers; Node prints one ExperimentalWarning for it. The upload routes spawn `uv.exe` found on
  the dev server's PATH (`BG_UV` overrides) with `cwd` = `pipeline/` (`src/lib/pipeline-process.ts`;
  Node cannot spawn a `uv.cmd` shim without a shell). They set `PYTHONIOENCODING=utf-8`, and the
  importers keep their NDJSON ASCII (`json.dumps`), because a piped stdout on Windows uses the
  ANSI code page.
- PowerShell 5.1 strips double quotes inside an argument passed to a native program, so
  `uv run python -c "..."` breaks: put the snippet in a file. `Get-Content` / `Get-ChildItem`
  read `[` `]` as wildcards: use `-LiteralPath` for the app's `[id]` folders.

## Working agreement

- Work in the phases of `docs/SPEC.md`; stop for review at the end of each phase.
- Before coding a new phase, show the proposed file structure and types and wait for an OK.
- Parser, move generator and data validation tests stay green before touching rendering.
- Fake or placeholder data is fine for scaffolding, but say so; real numbers come from gnubg.
- Pick work from `docs/SPEC.md` § 9 (backlog, each item has a "done when"); check `docs/BRIEF.md`
  when intent is unclear.
- Definition of done for any change: `npm test`, `npm run typecheck`, `npm run lint` (and
  `uv run pytest` for pipeline changes) green, UI changes checked in the browser preview, and
  `docs/SPEC.md` / `CLAUDE.md` updated when behaviour or conventions change.
