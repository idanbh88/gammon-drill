# Original brief (2026-09-02)

The starting prompt for the project, kept verbatim so later sessions can check intent
against it. `docs/SPEC.md` records what was actually built and where it deviates.

---

I want to build a web app for practicing backgammon positions (checker plays and cube
decisions), similar in spirit to Robertie's "501 Essential Backgammon Problems" but built on an
open data pipeline: positions come in as XGIDs, GNU Backgammon (gnubg) evaluates them, the app
quizzes me and tracks my mistakes.

I'm on Windows (PowerShell). Use Next.js + TypeScript + Tailwind for the app, and Python (uv)
for the offline data pipeline. Keep it simple; no database in v1 — a JSON file of problems
plus localStorage for my progress.

## Core concepts

- Position = an XGID string (26-char board + cube/turn/dice/score fields). Write a robust
  `parseXgid()` and `toXgid()` with unit tests.
- Problem = position + question type (`checker` = pick the best move, `cube` = double/no-double
  or take/pass) + ranked candidate answers with equities + category tags + explanation text
  (empty for now).
- Category taxonomy (borrowed from Robertie's chapter structure, public): opening, early game,
  blitz, holding game, priming game, back game, connectivity, hit-or-not, breaking anchor,
  crunch positions, bearing in, bearing off, racing cube, contact cube, containment,
  ace-point game.

## Phases — do them in order, stop after each and let me review

### Phase 1 — Board renderer + quiz shell

1. SVG board component that renders any XGID: 24 points, bar, bear-off tray, cube (value +
   owner), dice, pip counts for both sides, score/match length. Always show the position from
   the perspective of the player on roll (bottom, moving counter-clockwise).
2. Quiz page: shows a problem, the question ("Blue to play 31" / "Blue on roll, cube
   action?"), 3–4 answer buttons in random order. After answering: reveal the ranked answers
   with equity loss for each, mark mine, show explanation area.
3. Seed `data/problems.json` with 5 hand-written problems (use these XGIDs:
   `-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10`,
   `-b----E-C---eE---c-e----B-:0:0:1:63:0:0:0:7:10`, and three more you make up that are legal
   positions with 15 checkers per side). Fake equities are fine in this phase.
4. Basic session stats: answered / correct / average equity loss, stored in localStorage.

No drag-and-drop of checkers in v1. Answers are buttons only.

### Phase 2 — gnubg pipeline (Python)

1. Script `pipeline/analyze.py`: takes a text file with one XGID per line, runs gnubg CLI
   (Windows build) in batch mode, and for each position extracts: ranked moves (or cube
   decision) with equities, win/gammon/backgammon percentages, gnubg's position class
   (contact/race/crashed/bearoff). Output: `problems.json` entries. Look at how `xgid2anki` and
   `AnkiGammon` (both open source, GitHub) drive gnubg and reuse the approach — don't reinvent it.
2. Script `pipeline/classify.py`: rule-based tagging of each position into the category
   taxonomy above, using features computed from the board (anchors held, prime length,
   checkers back, pip difference, checkers on bar, contact vs race, home-board strength, cube
   state). Log the features so I can tune rules later.
3. Script `pipeline/import_forum.py` (later): scrape XGIDs + top-voted answers from a list of
   forum thread URLs I provide.

### Phase 3 — Study features

1. Filter by category, by question type, by difficulty (difficulty = equity gap between best
   and second-best answer; smaller gap = harder).
2. Simple spaced repetition: problems I got wrong reappear sooner; track per-category accuracy.
3. Explanation generator: for each problem, call the Anthropic API with the gnubg data (ranked
   answers, equities, gammon rates, position features) and ask for a 3–5 sentence explanation
   of why the best play wins and what each alternative costs. Cache results into
   `problems.json`. Read the API key from an env var, never commit it.

## Constraints

- Tests for the XGID parser, the legal-move generator (needed to validate that candidate moves
  are legal from the position), and the classifier.
- Board must be correct before anything else: verify with the pip counts — a rendered position
  whose pip count doesn't match the XGID's implied count is a bug.
- Keep problem data separate from code so I can drop in additional problem sets later.

Start with Phase 1. Before writing code, show me the proposed file structure and the `Problem`
TypeScript type, then wait for my OK.
