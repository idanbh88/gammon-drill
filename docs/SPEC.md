# Backgammon Trainer — specification and decision log

Last updated 2026-09-03. Repository: https://github.com/idanbh88/gammon-drill (branch `main`). `CLAUDE.md` is the short operational guide; this is the reference.

## 1. Goal

A web app for practising backgammon positions (checker plays and cube decisions), in the
spirit of Robertie's *501 Essential Backgammon Problems*, on an open data pipeline: positions
come in as XGIDs, GNU Backgammon evaluates them, the app quizzes the user and tracks mistakes.
No database: problem sets are JSON files, progress lives in the browser's `localStorage`.

Stack: Next.js 16, TypeScript, Tailwind 4, Vitest, zod for the app; Python 3.10 with uv for
the offline pipeline; GNU Backgammon 1.08 as the engine.

## 2. Status

| Phase | Scope | State |
|---|---|---|
| 1 | SVG board, quiz shell, five seed problems, session stats | done 2026-09-02 |
| 2 | `analyze.py` (gnubg), `classify.py` (rule-based tags), `import_forum.py` | done 2026-09-03; forum import not yet tried on a live forum |
| 3 | filters, spaced repetition with per-category accuracy, `explain.py` | done 2026-09-03; explanations not generated yet (no API key on the machine) |

Open items are listed in § 9.

## 3. XGID

`[XGID=]<pos>:<cube>:<owner>:<turn>:<dice>:<score1>:<score2>:<cj>:<len>:<maxcube>`

| Field | Meaning |
|---|---|
| pos | 26 chars. Index 0 = player 2's bar, 1–24 = points from player 1's side (1 = player 1's ace point), 25 = player 1's bar. `A`–`P` = 1–16 player-1 checkers, `a`–`p` = player-2 checkers, `-` empty. Borne-off checkers are implied (15 minus what is on the board). |
| cube | log2 of the cube value |
| owner | 1 = player 1, −1 = player 2, 0 = centred |
| turn | 1 = player 1 on roll, −1 = player 2 |
| dice | `00` not rolled (cube decision pending), two digits rolled, `D` the turn player has doubled and the opponent must take or pass, `B` / `R` beaver / raccoon (parsed, not quizzed) |
| score1 / score2 | absolute scores of player 1 / player 2 |
| cj | match play: 1 = Crawford game. Money (len 0): bit 0 = Jacoby, bit 1 = beavers |
| len | match length, 0 = money |
| maxcube | log2 of the maximum cube |

Player 1 pips = Σ count·point + 25·bar; player 2 pips = Σ count·(25 − point) + 25·bar.
The opening position `-b----E-C---eE---c-e----B-` gives 167 / 167.

Verified against the XG format references and the xgid2anki / AnkiGammon sources; gnubg's
`set xgid` accepts the string directly. For dice `D` gnubg steps back to the double decision
and reports the same three cube equities.

## 4. Perspective

The player who has to act is **Blue**, always drawn at the bottom moving counter-clockwise
(home board bottom-right, points labelled 1–24 from Blue's side). The opponent is **White**.
Acting player = turn player for checker plays and `00` cube decisions; the opponent of the
turn player for `D`. Internally the parser keeps the absolute player-1/player-2 model of the
XGID; `toPerspective()` (`board.ts`, `xgid.py`) re-numbers for rendering, move generation
and prompts.

## 5. Data model

Problem sets are `data/*.json`, each `{ name, source?, problems[] }`, all loaded automatically;
ids must be unique across files. The full JSON example is in `data/README.md`.

```ts
type QuestionType = "checker" | "cube";
type CubeAnswerId = "no-double" | "double-take" | "double-pass" | "too-good" | "take" | "pass";

interface Answer {
  id: string;          // checker: gnubg notation in Blue's numbering; cube: CubeAnswerId
  label: string;
  equity: number;      // cubeful equity (money) or normalised money equity (match), Blue's side
  equityLoss: number;  // >= 0, 0 for the best answer, non-decreasing down the list
  probs?: { win; winGammon; winBackgammon; loseGammon; loseBackgammon };
}

interface Problem {
  id: string;                    // stable slug; progress is keyed on it
  xgid: string;                  // without "XGID="
  type: QuestionType;
  answers: Answer[];             // ranked best first, at least two
  categories: Category[];        // at least one, from the taxonomy in § 7
  explanation: string;           // 3–5 sentences, "" until generated
  explanationMeta?: { model: string; generatedAt: string };
  source?: string;
  analysis?: { engine: "gnubg" | "manual"; plies?; positionClass?; analysedAt? };
  features?: Record<string, number | boolean | string>;   // classifier features
}
```

Validation (`src/lib/validate.ts`, run by the loader and the data test): the XGID parses, the
type matches the dice, answers are ranked with the best at loss 0, ids are unique, every
checker answer is a legal play, cube answer ids come from the right set.

### Difficulty

Derived, never stored: the equity gap between the best and the second-best answer
(`answers[1].equityLoss`). Bands: hard below 0.03, medium below 0.10, easy otherwise.

### Cube answer scoring

Given gnubg's cubeful equities ND (no double), DT (double/take) and DP (double/pass) from the
doubler's side, and gnubg's "proper cube action":

- joint answers (dice `00`): a wrong doubling decision costs `|min(DT, DP) − ND|`, a wrong
  take/pass claim costs `|DT − DP|`, both add up when both halves are wrong. `equity` is the
  equity of the outcome the answer describes (ND, DT, DP, ND).
- take/pass answers (dice `D`): the responder's equities are −DT and −DP; the wrong choice
  costs `|DT − DP|`.

Labels say "Redouble" when the cube is not centred.

### Checker answer scoring

`equityLoss = best.equity − equity` from gnubg's ranked list; up to six answers are stored,
the quiz offers the top four in random order.

## 6. App behaviour

- **Quiz** (`/`): board, question ("Blue to play 31", "Blue on roll. Cube action?",
  "White doubles to 2. Take or pass?"), up to four answer buttons in random order. After
  answering: verdict, the full ranked list with equity and loss (own pick marked, unoffered
  answers muted), explanation panel, when the problem comes back, "Next problem". Keys 1–4
  answer, Enter or N advances.
- **Filters** (panel above the board, remembered in `localStorage`): category (any of the
  selected), type, difficulty band. Changing filters re-picks when the current problem no
  longer matches or was already answered.
- **Scheduler** (`src/lib/scheduler.ts`): state per problem is derived from the attempt log.
  A wrong answer makes it due again after 5 minutes; consecutive correct answers use 1, 3, 7,
  14, 30 days. Next pick order: lapsed and due ("Again"), then due reviews most overdue first
  ("Review"), then never-seen ("New"); when nothing is due, the problem due soonest
  ("Ahead of schedule"). The previous problem is not repeated unless it is the only candidate.
- **Stats** (`/stats`): overall accuracy and average loss, per-category table (problems, due,
  attempts, accuracy, average loss), last ten mistakes, reset.
- **Positions** (`/board`): every problem rendered, for eyeballing the board renderer.
- **Storage**: `bg-trainer/attempts/v1` holds `{ problemId, answerId, equityLoss, correct, at }`
  entries; `bg-trainer/filters/v1` holds the filters. All reads are wrapped in try/catch and
  the page works without storage.

## 7. Categories and classifier

Taxonomy (Robertie's chapters): `opening`, `early-game`, `blitz`, `holding-game`,
`priming-game`, `back-game`, `connectivity`, `hit-or-not`, `breaking-anchor`, `crunch`,
`bearing-in`, `bearing-off`, `racing-cube`, `contact-cube`, `containment`, `ace-point-game`.

`pipeline/bgpipeline/features.py` computes, from Blue's side: contact, gnubg position class,
pips and pip difference, checkers back and on the bar, anchors in each home board, home-board
points, longest prime in front of the opponent's rearmost checker, deep/crunched checkers,
blots, outfield spread, and for checker plays whether any legal play hits (and whether all
do) and whether an anchor can be broken. `classify.py` turns them into tags with readable
rules; a problem can carry several tags and always gets at least one. The feature log
(`--log features.jsonl`) exists so the rules can be tuned on real sets.

## 8. Pipeline

- **analyze.py**: one XGID per line (optional id after whitespace). Two gnubg runs: the Python
  API inside gnubg (`gnubg-cli -t -q -p`) for structured chequer hints, position class and
  metadata; a command-file run (`-c`) whose text `hint` output is parsed for cube decisions,
  because gnubg's Python `hint()` refuses them. Move filters are set explicitly (level 0
  accepts all, later levels keep the top 10 + 4 within 0.16), otherwise `hint` stays at
  0-ply. `set output mwc off` gives normalised money equity in match play. Default 2-ply.
  `--merge-into` updates problems with the same XGID in place (keeping id, explanation and,
  unless `--reclassify`, categories) and appends new ones.
- **classify.py**: rewrites `categories` and a compact `features` map; `--merge` keeps
  existing tags.
- **explain.py**: for each problem without an explanation, sends the question, the position
  from Blue's side, ranked answers with equities / losses / probabilities and the features
  to Claude (Anthropic SDK, default `claude-opus-5`, system prompt cached) and stores 3–5
  sentences of plain prose plus `explanationMeta`. Writes after every problem. Key from
  `ANTHROPIC_API_KEY` or a git-ignored `.env`; `--dry-run` prints the prompts.
- **import_forum.py**: Discourse threads through their JSON API (with like counts), other
  pages by regex; outputs a positions file for `analyze.py` and a JSON of candidate replies.

## 9. Open items

- Generate explanations for the seed set (needs an API key) and judge the prompt on real output.
- Tune the classifier on a real problem set using the feature log; the rules are first cuts.
- Try `import_forum.py` on real threads; the Discourse path is untested against a live site.
- Deeper analysis for hard positions (`--plies 3`, or gnubg rollouts) once sets grow.
- Later ideas from the brief: drag-and-drop moves (explicitly out of v1), export/import of
  progress, more problem sets (Robertie's own positions are copyrighted; use own positions,
  forum threads, or engine-found positions).

## 10. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-09-02 | Blue = acting player, always at the bottom | one mental model for every question type; take/pass positions flip to the responder |
| 2026-09-02 | Cube problems use joint answers, `take`/`pass` only for dice `D` | matches Robertie's phrasing and gnubg's three cube equities |
| 2026-09-02 | Moves stored as gnubg notation, legality judged by resulting position | gnubg's output can be stored verbatim; equivalent notations are accepted |
| 2026-09-02 | Hand-written Next.js scaffold instead of `create-next-app` | the tool rejects the directory name and prompts interactively |
| 2026-09-02 | Attempt log rather than aggregate counters in `localStorage` | spaced repetition and per-category stats derive from it |
| 2026-09-03 | gnubg installed at `C:\gnubg` | its 32-bit build cannot open data files under the Hebrew profile path |
| 2026-09-03 | Python API pass + text pass for cube decisions | gnubg's Python `hint()` has no cube support |
| 2026-09-03 | `pipeline/` is not installed as a package | an editable install's `.pth` file breaks Python 3.10 on this path |
| 2026-09-03 | Cube loss = gnubg-style error components | keeps "loss" meaningful for both halves of a joint answer |
| 2026-09-03 | Scheduler intervals 5 min, 1, 3, 7, 14, 30 days; lapsed > review > new | simple, derived, no extra storage |
| 2026-09-03 | Difficulty bands 0.03 / 0.10 | rough "small error / blunder" thresholds; tune with data |
| 2026-09-03 | Explanations default to `claude-opus-5`, prose only, cached with model and date | provenance is visible in the app; regeneration is explicit (`--force`) |
