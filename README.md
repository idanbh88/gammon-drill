# gammon-drill

Backgammon position trainer.

Practice backgammon checker plays and cube decisions from XGID positions, quiz style,
with mistakes tracked locally. Built with Next.js, TypeScript and Tailwind; problem
analysis will come from GNU Backgammon through a Python pipeline (Phase 2).

Specification, data model and decision log: [docs/SPEC.md](docs/SPEC.md). Session guide for
Claude Code: [CLAUDE.md](CLAUDE.md).

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000. Keys: `1`–`4` pick an answer, `Enter` or `N` for the next problem.
`/stats` shows per-category accuracy, what is due, and recent mistakes.

```bash
npm test          # vitest: XGID parser, board/pip counts, legal-play generator, data files
npm run typecheck
npm run lint
npm run build
```

## Layout

```
data/                 problem sets (*.json), see data/README.md
src/app/              Next.js app router (page.tsx quiz, stats/ progress, board/ all positions)
src/components/       Board.tsx (SVG), Quiz.tsx, FilterPanel.tsx, AnswerReveal.tsx, CategoryStats.tsx
src/lib/xgid.ts       parseXgid / toXgid
src/lib/board.ts      perspective flip, pip counts, acting player, question text
src/lib/moves.ts      legal-play generator + move notation
src/lib/validate.ts   semantic checks for problems (used by the loader and tests)
src/lib/problems.ts   server-side loader for data/*.json
src/lib/storage.ts    attempt log in localStorage
src/lib/filters.ts    category / type / difficulty filters
src/lib/scheduler.ts  spaced repetition + per-category stats from the attempt log
src/types/problem.ts  Problem / Answer / ProblemSet types + zod schemas
pipeline/             Phase 2: gnubg analysis, classifier, forum import (Python, uv)
```

## Conventions

- The board is always drawn from the side of the player who has to act ("Blue", bottom,
  moving counter-clockwise, home board bottom-right). For take/pass positions (dice `D`)
  that is the opponent of the player who doubled.
- Pip counts on the board are computed from the XGID; a mismatch between what is drawn
  and the numbers is a bug.
- Progress is stored in `localStorage` under `bg-trainer/attempts/v1` as an attempt log.

## Pipeline (Phase 2)

Positions are analysed offline with GNU Backgammon and written straight into `data/`:

```bash
cd pipeline
uv sync --all-extras
uv run analyze.py examples/seed.txt --merge-into ../data/problems.json --reclassify
uv run classify.py ../data/problems.json --log features.jsonl
uv run pytest
```

Needs `uv` and gnubg installed at an ASCII path (`winget install GNU.gnubg --location C:gnubg`).
See [pipeline/README.md](pipeline/README.md) for the details, including how cube answers are scored
and how the classifier's features are logged for tuning.

## Studying (Phase 3)

- **Filters** (panel above the board): category, checker play vs cube, and difficulty. Difficulty is
  the equity gap between the best and second-best answer: hard below 0.03, medium below 0.10,
  easy otherwise. Filters are remembered in `localStorage`.
- **Spaced repetition**: the next problem is chosen from the attempt log. A problem answered wrong
  comes back after 5 minutes ("Again"); each consecutive correct answer pushes it out further
  (1, 3, 7, 14, 30 days, "Review"); never-seen problems ("New") come after due reviews. When nothing
  is due the problem due soonest is shown ("Ahead of schedule"). Logic in `src/lib/scheduler.ts`.
- **Explanations**: generated offline by `pipeline/explain.py` (Claude through the Anthropic SDK)
  and cached in the data files, with the model and date in `explanationMeta`:

```bash
cd pipeline
uv run explain.py ../data/problems.json --dry-run     # show the prompts
uv run explain.py ../data/problems.json               # needs ANTHROPIC_API_KEY
```

  Put the key in the environment or in a git-ignored `.env` (see `.env.example`); it is never
  written to the data files.

## Roadmap

1. **Phase 1** (done): board renderer, quiz shell, seed problems, session stats.
2. **Phase 2** (done): `pipeline/analyze.py` (gnubg batch analysis → problem sets),
   `pipeline/classify.py` (rule-based category tagging with logged features),
   `pipeline/import_forum.py` (XGIDs and liked replies from forum threads).
3. **Phase 3** (done): filters by category / type / difficulty, spaced repetition with
   per-category accuracy, `pipeline/explain.py` for Claude-generated explanations.
