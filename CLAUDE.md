# Backgammon Trainer — guide for Claude Code sessions

Read `docs/SPEC.md` for the product spec, data model, scoring rules and the decision log.
This file is the short operational guide. Keep both current when behaviour changes.

## What this is

A quiz app for backgammon checker plays and cube decisions. Positions are XGIDs, GNU
Backgammon evaluates them offline (`pipeline/`, Python + uv), the Next.js app quizzes the user
and tracks mistakes in `localStorage`. Phases 1–3 of the original brief are built; see
`docs/SPEC.md` § Status for what is still open.

## Commands

App (repo root, Node 24):

```bash
npm run dev        # http://localhost:3000 (quiz), /stats (progress), /board (all positions)
npm test           # vitest: xgid, board, moves, data, filters, scheduler
npm run typecheck
npm run lint
npm run build
```

Pipeline (`cd pipeline`, run from PowerShell, see quirks below):

```bash
uv sync --all-extras
uv run pytest
uv run analyze.py examples/seed.txt --merge-into ../data/problems.json --reclassify
uv run classify.py ../data/problems.json --log features.jsonl
uv run explain.py ../data/problems.json --dry-run
```

Browser preview: `.claude/launch.json` has the `dev` server. Verify UI changes there.

## Layout

```
data/*.json                 problem sets (ProblemSet JSON), data/README.md documents the format
src/app/                    page.tsx quiz, stats/ progress, board/ every position rendered
src/components/             Board.tsx (SVG), Quiz.tsx, FilterPanel.tsx, AnswerReveal.tsx, CategoryStats.tsx
src/lib/xgid.ts, board.ts   XGID parse/format, perspective flip, pip counts, question text
src/lib/moves.ts            legal-play generator + gnubg-style notation
src/lib/validate.ts         semantic checks on problems (loader and data test use it)
src/lib/filters.ts          category / type / difficulty filters
src/lib/scheduler.ts        spaced repetition + per-category stats from the attempt log
src/lib/storage.ts          attempt log in localStorage
src/types/problem.ts        Problem / Answer / ProblemSet types + zod schemas
pipeline/analyze.py         XGIDs -> gnubg -> problem set JSON
pipeline/classify.py        rule-based category tags + feature log
pipeline/explain.py         Claude-written explanations cached into the JSON
pipeline/import_forum.py    XGIDs and liked replies from forum threads
pipeline/bgpipeline/        xgid.py, moves.py (ports of src/lib), gnubg_*.py, features.py, classify.py, explain.py
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
- `src/lib/xgid.ts` + `moves.ts` and `pipeline/bgpipeline/xgid.py` + `moves.py` are ports of
  each other; change both and mirror the tests.
- `localStorage` keys: `bg-trainer/attempts/v1`, `bg-trainer/filters/v1`. Changing the attempt
  shape needs a new version key plus a migration.

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
  `[IO.File]::WriteAllText(path, text, [Text.UTF8Encoding]::new($false))`.
- Stay on ESLint 9 (`eslint-config-next` 16 breaks on ESLint 10). Next 16 lint rules forbid
  `setState` inside effects and JSX inside try/catch.
- `create-next-app` refuses the directory name (capital letters); the scaffold is hand-written.
  npm 8.11 with Node 24 works; ignore engine warnings.
- gnubg's Python API has no cube hints; cube decisions come from a text-mode `hint` pass.
  Move filters must be set explicitly or `hint` silently stays at 0-ply.

## Working agreement

- Work in the phases of `docs/SPEC.md`; stop for review at the end of each phase.
- Before coding a new phase, show the proposed file structure and types and wait for an OK.
- Parser, move generator and data validation tests stay green before touching rendering.
- Fake or placeholder data is fine for scaffolding, but say so; real numbers come from gnubg.
