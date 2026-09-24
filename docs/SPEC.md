# Backgammon Trainer — specification and decision log

Last updated 2026-09-24. Repository: https://github.com/idanbh88/gammon-drill (branch `main`). `CLAUDE.md` is the short operational guide; this is the reference.

## 1. Goal

A web app for practising backgammon positions (checker plays and cube decisions), in the
spirit of Robertie's *501 Essential Backgammon Problems*, on an open data pipeline: positions
come in as XGIDs, GNU Backgammon evaluates them, the app quizzes the user and tracks mistakes.
Problem sets are JSON files and progress lives in the browser's `localStorage`; explanations
written by Claude (in English, each with a Hebrew translation shown under it) and the user's
imported matches (Backgammon Galaxy `.mat` exports, replayed and analysed by gnubg) live in
`data/store.sqlite`, a SQLite file the app and the pipeline share. Backgammon Galaxy quiz sets (picture-based multiple choice) can be imported as lessons;
they live, with their pictures, in a separate git-ignored database under `data/lessons/`.
The user can also play matches against gnubg in the app: gnubg (one long-lived process) plays
its best move, grades each of the user's decisions as it is made, and every error joins the
quiz as one of "My mistakes". PR (XG style) is shown for both sides per game and per match.

Stack: Next.js 16, TypeScript, Tailwind 4, Vitest, zod for the app; Python 3.10 with uv for
the offline pipeline; GNU Backgammon 1.08 as the engine.

## 2. Status

| Phase | Scope | State |
|---|---|---|
| 1 | SVG board, quiz shell, five seed problems, session stats | done 2026-09-02 |
| 2 | `analyze.py` (gnubg), `classify.py` (rule-based tags), `import_forum.py` | done 2026-09-03; forum import not yet tried on a live forum |
| 3 | filters, spaced repetition with per-category accuracy, explanations | done 2026-09-03; explanations moved from a batch script to on-demand generation in the app with a SQLite store the same day (§ 5, § 6) |
| 4 | match review: upload a Backgammon Galaxy `.mat` export, replay it, evaluate the user's decisions with gnubg, list the errors with explanations on demand | done 2026-09-04 (§ 5 match store, § 6 Matches, § 8 `import_match.py`); no Galaxy export with cube actions seen yet |
| 5 | lessons: import Backgammon Galaxy quiz sets (picture-based multiple choice) with all their pictures, play each set in order with the author's analysis, score and retry mistakes | done 2026-09-11 (§ 5 lesson store, § 6 Lessons, § 8 `import_lessons.py`); 24 sets, 423 problems imported; the positions are pictures only (§ 9 item 9) |
| 6 | play gnubg: matches or money sessions against gnubg at 2-ply (best move, with the cube), click-to-move board, gnubg's verdict after every decision, PR for both sides, every error automatically in the quiz ("My mistakes") with the move played always offered | done 2026-09-24 (§ 5 play store, PR, mistakes; § 6 Play; § 8 `gnubg_server.py`) |
| 7 | study extras chosen 2026-09-24: where I lose equity (PR trend, loss by category / cube error), try again before the answer, play on from any position | planned (§ 9 items 11–13) |

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

The play screen is the one exception: the user (always player 1) stays Blue at the bottom
while gnubg acts, and gnubg's moves are written in its own numbering, as backgammon sites do.
A graded decision of the user is shown with the user acting, so the rule holds there.

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
  explanation: string;           // hand-written fallback; generated text is overlaid from the store
  explanationMeta?: { id?: number; model: string; generatedAt: string; effort?: string };   // set from the store row (id = explanations.id)
  explanationHebrew?: { explanationId: number; text: string; model: string; generatedAt: string };   // newest translation of that row (never in JSON)
  source?: string;
  analysis?: { engine: "gnubg" | "manual"; plies?; positionClass?; analysedAt? };
  features?: Record<string, number | boolean | string>;   // classifier features
  origin?: { site; matchId; opponent; playedAt; played; loss };   // one of the user's own decisions (never in JSON)
}
```

Validation (`src/lib/validate.ts`, run by the loader and the data test): the XGID parses, the
type matches the dice, answers are ranked with the best at loss 0, ids are unique, every
checker answer is a legal play, cube answer ids come from the right set.

### Explanation store

`data/store.sqlite` (schema in `src/lib/store-schema.ts`, `meta.schema_version` = 5) holds every
explanation ever generated, in table `explanations`: xgid, problem id (a quiz problem id or a
match decision id), requested and served model, prompt version and SHA-256 of the full prompt,
the cleaned text and the model's raw text, generation time, token counts, request id,
whether a server-side fallback served it, and the effort level it was asked for (`effort`, since
schema v4; NULL for older rows). Rows are inserted, never updated or deleted, so
regenerating keeps the old text. Table `translations` (schema v5) holds the Hebrew
translations the same way: the explanation row translated (`explanation_id`), `language`
(`he`), the text and raw text, and the same provenance columns (models, prompt version and
hash, time, tokens, request id, fallback, effort); appended, never updated or deleted. The
loader (`src/lib/problems.ts`) overlays the newest row per XGID onto `explanation` /
`explanationMeta` (with the row id) and the newest Hebrew translation of that same row onto
`explanationHebrew`, so a regenerated explanation never shows the old text's translation; the
JSON field stays as a hand-written fallback, and the match review and the play screen show the
same newest-per-XGID text. The app opens the file with Node's built-in `node:sqlite`; Python
uses the standard library and reads `SCHEMA_VERSION` / `SCHEMA_SQL` / `ADDED_COLUMNS` out of the
TypeScript file (`pipeline/bgpipeline/store.py`), so the schema has one home. Every schema
version so far is additive: a writable open (app or importer) runs the DDL, adds the
`ADDED_COLUMNS` a table lacks (`ALTER TABLE ... ADD COLUMN`; CREATE TABLE IF NOT EXISTS leaves
an older table as it was) and bumps `meta.schema_version`; a read-only open accepts an older
file (the app then reads a missing column as NULL, and a file before v5 as having no
translations).

### Match store

The importer (`pipeline/import_match.py`, run by the app's upload route or by hand) writes
three more tables:

- `matches`: site, site match id (unique together), player names, match length (0 = money),
  played-at, file name and SHA-256, the raw `.mat` text, the analysed player (1), engine and
  plies, import time.
- `games`: number, score at the start, Crawford flag, winner and points.
- `decisions`: one row per decision of the analysed player, `decision_id` =
  `match-<site match id>-g<game>-m<move>-<kind>` (kind `checker`, `cube` or `take`), the XGID
  before the decision (the analysed player is the acting player), dice, what was played
  (canonical notation, or `double` / `no-double` / `take` / `pass`), the matching answer id, best
  and played equity, the loss, `forced`, position class, categories, features and the ranked
  answers as JSON, plies and date.

Match rows are reproducible engine output, so re-importing a match with `--replace` (the
"analyse again" checkbox) deletes and rewrites its games and decisions; explanations are keyed
by XGID and are never touched. Matches played against gnubg share these tables (below) but are
written by the app and never deleted. Summaries and PR are computed per player; lists and the
error counts are the analysed player's (the user's).

### Match decision scoring

The replay (`bgpipeline/mat.py`, `replay.py`) follows gnubg's `.mat` importer rules and applies
every play with the legal-play generator, so each decision has an exact XGID. For the analysed
player it records: every roll (0 or 1 legal plays → `forced`, not evaluated), the pre-roll cube
decision whenever the cube was live for them (not Crawford, centred or theirs, below the limit,
and `score + cube < match length`), their doubles, and their takes or passes (dice `D`). gnubg
evaluates the distinct XGIDs through the same two passes as `analyze.py`. The played checker
move is found in gnubg's complete candidate list by resulting position (the file may write
`13/10 10/7` for `13/7`); loss = best equity − played equity, and the played move is kept in
the stored answers even when it falls outside the top six. Cube decisions charge only the half
the player decided: a double is the cheaper of `double-take` / `double-pass`, a non-double the
cheaper of `no-double` / `too-good`, a take or pass itself. Thresholds are XG-style: loss ≥ 0.02
is an error, ≥ 0.08 a blunder (`src/lib/matches.ts`). A played move missing from gnubg's list
gives an unscored decision, never a failed import.

### Games against gnubg (play store)

A match played in the app is written as it goes into the same tables, by the app: a `matches`
row with site `gnubg` (`site_match_id` = the row id, player 1 "You", player 2 "gnubg", no file,
`analysed_player` 1), one `games` row per game (winner and points filled in when it ends) and a
`decisions` row for every decision of both players, recorded like the importer records them
(`src/lib/game.ts`: the XGID before the decision, canonical notation, `forced` for 0 or 1 legal
plays, a pre-roll cube decision whenever the cube is available). Ids are
`play-<match id>-g<game>-m<move>-<kind>`, gnubg's with `-p2`; the move number is .mat style
(each of player 1's turns starts a new one). Table `play_state` (schema v3) holds the match in
progress: settings and the rules state as JSON, `status` (`playing` / `finished`), a `version`
that every save bumps (a stale one is refused: two tabs, a double click) and the time. Dates
are local time without a zone, like the imported matches'. These rows are never deleted.

Rules (`game.ts`, pure, dice passed in): the opening roll (each side one die, ties rolled
again, the higher die moves first with both), the cube available when `replay.cube_live` says
so (not Crawford, centred or owned, below 1024, and in a match the doubler's score plus the cube
short of the length), double / take (the taker owns the cube at twice the value) / pass (the
doubler wins the cube's value), gammon (the loser has none off) and backgammon (and still has a
checker on the bar or in the winner's home board) at 2× and 3×, the Jacoby rule in money (an
unturned cube counts single), the Crawford game (the first game with exactly one side at
length − 1) and the match end. No beavers, no resignations.

One request = one action of the user (`play-service.ts`): the rules check it, the engine grades
it, then gnubg plays until the user decides again (gnubg's cube decision when the cube is
available to it, its roll, its move, its answer to a double) together with the user's automatic
steps (a roll when the cube is not the user's to turn, forced plays, dances). All engine calls
come first; everything is then written in one short transaction.

### Performance rating (PR)

`src/lib/pr.ts`, XG style: PR = 500 × the equity lost per counted decision, in the normalised
equity the store holds (EMG in match play). Counted decisions follow gnubg's statistics: a
checker play with a choice (forced plays and dances never count), every double, take and pass,
and a no-double when doubling was close (it would have lost less than 0.16: `max(ND, min(DT,
DP)) − min(DT, DP) < 0.16`) or was right (a missed double). Shown overall and split into checker
and cube PR, with gnubg's rating word for the overall figure (its `errorrating` thresholds per
decision, 0.002 … 0.035, i.e. PR < 1 Supernatural, < 2.5 World class, < 4 Expert, < 6 Advanced,
< 9 Intermediate, < 13 Casual player, < 17.5 Beginner, else Awful). gnubg at full strength is
graded by its own 2-ply analysis, so its PR is 0.0 by construction; a real opponent PR needs the
opponent's decisions analysed (Galaxy imports analyse the user only, § 9 item 14).

### My mistakes

`src/lib/mistakes.ts`: every decision of the user (the match's analysed player; games against
gnubg and imported matches) that is scored, not forced and lost at least 0.02 is in the quiz on
its own. Table `quiz_picks` (schema v3; one row per decision, `included` 1 / 0, updated in place)
holds the user's overrides: a pick adds any other decision of theirs, or takes a mistake out.
Such a problem is the decision (`decisionProblem`), id = the decision id (so spaced repetition
keys on it), with `origin` { site, match id, opponent, date, the answer played, its loss }. The
quiz always offers the move played in the game among its four choices (in place of the
lowest-ranked one when it is not in the top four). A mistake that fails `validateProblem` is
left out rather than breaking the quiz.

### Lesson store

Backgammon Galaxy quiz sets (the JSON behind a finished quiz: problems as pictures, two to four
choices as Galaxy writes them with Galaxy's equity text, the correct choice and, in most sets,
the author's analysis) are imported by `pipeline/import_lessons.py` into a separate database,
`data/lessons/lessons.sqlite` (schema in `src/lib/lesson-store-schema.ts`, its own
`meta.schema_version` = 1, read by Python the same way as the main schema). Everything under
`data/lessons/` is git-ignored: the database, each set's file as received
(`<quiz id>/quiz.json`) and its pictures (`<quiz id>/images/pNN.png` for problem NN's position,
`pNN-cM.png` for the position after its choice M; ~290 KB each, ~430 MB for the first 24 sets).
The repository is public and the lessons are Galaxy's material.

- `lesson_sets`: site (`BackgammonGalaxy`) and Galaxy quiz id (unique together; the id is also
  the URL `/lessons/<id>` and the folder name), name, author, collection (the single word
  before " - " in the export's file name: "Medium", "Hard"), problem count, file name and
  SHA-256, import time.
- `lesson_problems`: `problem_id` = `lesson-<galaxy problem id>` (the progress key), number
  (file order, which is also the play order), kind (`checker` when every choice is a play,
  `cube` when every choice is a cube action; a mix is refused), position picture, analysis
  (NULL when there is none).
- `lesson_choices`: number (file order = display order), Galaxy's choice id, the answer and the
  description exactly as written, `correct`, `loss`, and the after-play picture (NULL for cube
  choices and for sets without them).
- `lesson_images`: path, CDN URL, MD5, size in bytes, width and height of every picture.

Keys are Galaxy's ids, so progress survives a re-import or a rebuilt database. These positions
have no XGID, so §§ 3–4 do not apply: no board, pip counts, gnubg, categories or explanations
(§ 9 item 9).

`loss` is read from Galaxy's text only where it is unambiguous: 0 for the correct choice; the
difference in parentheses, "(-0.062)" → 0.062; a bare "-0.049" only in a problem whose correct
choice reads "0.000" (one set writes differences that way; elsewhere a bare number is an
equity); NULL for anything else ("Wrong", "(", a positive "(+0.392)"), with an importer warning.
A wrong choice can lose 0.000 (Lesson 9, problem 22), so the verdict always comes from
`correct`, never from the loss. The user's Galaxy session (`userSession`, `level`,
`selectedAnswerId`, `isCorrect`) is not imported; it stays in `quiz.json`.

Pictures come from `https://cdn-quizzes.backgammongalaxy.com/` only (URLs used as given; they
are already percent-encoded), must be complete PNGs whose MD5 matches the CDN's ETag, and are
written through a temporary file. Rows are written only when every picture of the set is on
disk. Re-importing with `--replace` deletes and rewrites one set's rows (the only delete in this
database) and reuses the pictures that still match their row.

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
  costs `|DT − DP|`. gnubg reports the probabilities for the doubler; take/pass answers carry
  them from the responder's side (win = 1 − the doubler's win, gammons swapped).

Labels say "Redouble" when the cube is not centred.

### Checker answer scoring

`equityLoss = best.equity − equity` from gnubg's ranked list; up to six answers are stored,
the quiz offers the top four in random order.

## 6. App behaviour

- **Quiz** (`/`): board, question ("Blue to play 31", "Blue on roll. Cube action?",
  "White doubles to 2. Take or pass?"), up to four answer buttons in random order. After
  answering: verdict, the full ranked list with equity and loss (own pick marked, unoffered
  answers muted), explanation panel, when the problem comes back, "Next problem". Keys 1–4
  answer, Enter or N advances (not while a button has focus: it handles Enter itself).
- **Explanations** (panel under the reveal, `src/components/ExplanationPanel.tsx`): nothing is
  generated on its own. A model picker (`claude-opus-5` by default, `claude-opus-5-5`,
  `claude-fable-5-1` preselected for the hard band, `claude-sonnet-5`), an effort picker (low,
  medium, high, extra high, max; the model's own default preselected and marked, again whenever
  the model changes: Opus 5.5 medium, the others high) and a button generate one through
  `POST /api/explain`, or regenerate an existing one; the result is inserted into the store and
  shown at once. Under the text: "Generated by <model> at <effort> effort on <date>" (no effort
  for explanations written before it was recorded) and, when the audit
  (`src/lib/explain-audit.ts`) finds a number or move that is not in the problem's data,
  "Not found in the data: …". Errors (no key, refusal, network) show in the panel.
- **Hebrew translation** (same panel, asked for by the user, who reads Hebrew more easily):
  every explanation is shown in English with its Hebrew translation under it, right to left.
  Right after a new explanation arrives the panel asks `POST /api/explain/translate` for its
  translation, with the model picked in the panel and effort `low` (`TRANSLATION_EFFORT`);
  "מתרגם לעברית…" shows meanwhile, and the result is inserted into `translations` and shown.
  An explanation stored without one (every explanation written before 2026-09-24, or one
  whose translation failed) gets a "Translate to Hebrew" button instead: nothing is translated
  on page load. The prompt (`src/lib/translate.ts`, `TRANSLATION_PROMPT_VERSION` he-v1) asks for
  a faithful translation in natural Hebrew that copies moves in notation and every number
  exactly, calls Blue כחול and White לבן, and adds the English term in parentheses the first
  time a term is usually said in English. The text is cleaned like an explanation, plus echoed
  tags, a leading "תרגום:" label and invisible marks (bidi controls, soft hyphens; the display
  drops them too, for rows stored earlier). The Hebrew paragraph is `dir="rtl"`;
  `src/lib/rtl.ts` isolates each run of moves ("13/7 8/7", "bar/21* 24/21") and each signed
  number ("−0.045") in `<bdi dir="ltr">`, because the bidi algorithm would otherwise reorder
  them ("8/7 13/7", "*21/bar"). Under it: "Hebrew translation by <model> on <date>" and, when
  its numbers or moves differ from the English (`translationMismatches`), "The Hebrew differs
  from the English in: …". `GET /api/explain/translate?explanationId=` shows the prompt
  without calling the API.
- **My mistakes in the quiz**: the quiz draws from the problem sets and the user's own mistakes
  (§ 5 My mistakes). A mistake is marked "My mistake"; after answering, the reveal tags the move
  played in the game ("in your game"), a line says where it was played and what it cost, and a
  button takes it out of the quiz (or puts it back).
- **Filters** (panel above the board, remembered in `localStorage`): source (all, problem sets,
  my mistakes), category (any of the selected), type, difficulty band. Changing filters re-picks
  when the current problem no longer matches or was already answered.
- **Play** (`/play`): start a match against gnubg (1 to 25 points, or a money session with the
  Jacoby rule on or off) or go back to one (list with score, state, the user's PR and errors).
  gnubg starts in the background when the page opens. A match (`/play/<id>`): the board with the
  user always Blue at the bottom and gnubg's last play marked (a dot where each checker left, a
  ring where it landed); the prompt; what just happened ("gnubg rolled 64: 24/18 13/9", or
  gnubg's last turn from the log after a reload); buttons Roll / Double (or Redouble) when the
  cube is available (otherwise the roll is automatic), Take / Pass, Play / Undo / Clear while
  moving, Next game / End session. Moving, Backgammon Galaxy style (`move-input.ts`,
  `PlayBoard.tsx`): the user's dice sit on the board in tap order, the higher first; a tap on a
  checker (the movable ones are lit) moves it by the first die that works for it (the other die
  when the first cannot be used by that checker); pressing the dice swaps their order; a drag
  lights the points the checker can reach (one die, or several moving it on) and drops it there,
  or it slides back when dropped anywhere else (a path goes round a blot rather than hitting it on
  the way; move one die at a time to hit and continue); used dice are dimmed; when every die is
  used the dice read "tap to play" and pressing them plays (as do Play and Enter); the play can
  also be typed in notation. Every checker glides to its point. After the user's action gnubg's
  turn is replayed on the board (`board-animation.ts`): its dice tumble in with a caption
  ("gnubg rolled 64: 24/18 13/9."), each checker glides from its stack to where it lands, a hit
  checker glides to the bar, a double, take or pass holds for a moment, and the user's own
  automatic rolls and plays show too; the same for the opening roll of a game (both dice) and,
  for a match started from `/play`, gnubg's opening move (the new-match form hands its events to
  the page in sessionStorage). A click on the board, Space or "Skip" ends the replay. Speed:
  slow, normal (a second or two per gnubg move), fast or off, remembered in `bg-trainer/play/v1`.
  After each of the user's decisions, gnubg's verdict: the play or
  cube action with its loss (best, close < 0.02, error, blunder), gnubg's ranking with the pick
  marked, "Show your play" / "Show best play" on the board, the quiz toggle and the explanation
  panel. A no-double gets a card only when it counts for PR. Below: PR for the user this game
  and match and for gnubg, the game log, and at the end of a game the user's errors in it.
  Keys: R roll, D double, T take, P pass, Space swap the dice (or skip gnubg's replay), Enter
  play, U / Backspace undo, Esc, N next game.
- **Scheduler** (`src/lib/scheduler.ts`): state per problem is derived from the attempt log.
  A wrong answer makes it due again after 5 minutes; consecutive correct answers use 1, 3, 7,
  14, 30 days. Next pick order: lapsed and due ("Again"), then due reviews most overdue first
  ("Review"), then never-seen ("New"); when nothing is due, the problem due soonest
  ("Ahead of schedule"). The previous problem is not repeated unless it is the only candidate.
- **Stats** (`/stats`): overall accuracy and average loss, per-category table (problems, due,
  attempts, accuracy, average loss), last ten mistakes, reset.
- **Positions** (`/board`): every problem rendered, for eyeballing the board renderer.
- **Matches** (`/matches`): upload a Backgammon Galaxy `.mat` export (the user must be Player 1,
  the left column). `POST /api/matches/import` saves it under `data/matches/`, runs
  `uv run import_match.py <file> --json --player 1` in `pipeline/` and streams the importer's
  NDJSON events back, which the page shows as a progress log; the list (opponent, length,
  result, decisions, errors, blunders, total loss, plies) refreshes when it finishes. A match
  page (`/matches/<id>`) shows, game by game, every error: the board before the decision (Blue
  = the user), the question, "You played … −loss · best …", gnubg's ranking with the played
  move marked, and the same explanation panel as the quiz, with the prompt naming the played
  move. "All decisions" also lists forced plays, dances and correct plays. Nothing is
  explained until the button is clicked. The list also shows matches played against gnubg
  ("gnubg (played here)") and the user's PR per match; a match page shows PR (overall, checker,
  cube) for the user and, where their decisions were analysed, the opponent, a You / opponent
  switch for games against gnubg, and on each of the user's decisions the quiz toggle.
- **Lessons** (`/lessons`): the imported sets grouped by collection (Medium, Hard, then others;
  names in natural order, "Lesson 2" before "Lesson 10") with author, problem count, whether
  the set has analysis, and this browser's progress; an upload form for more exports
  (`POST /api/lessons/import` saves the file under `data/lessons/.incoming/`, runs
  `uv run import_lessons.py <file> --json --source-name=<original name>` and streams its
  progress; "Import again" adds `--replace`); a reset button for all lesson progress. A set
  (`/lessons/<quiz id>`) plays in file order from the first problem not answered in the current
  run: the picture (`GET /api/lessons/images/<quiz id>/<file>`, only names the importer writes),
  "Find the best play." or "What is the right cube action?", the choices in file order (keys
  1–4). After answering: the verdict, every choice with Galaxy's text coloured by loss (grey when
  unknown, lime for a wrong choice that loses nothing), the author's analysis, and "Show" on
  each play that has an after-play picture (keys 1–4 show one, 0 or Esc the position). A strip
  of numbers shows each problem's status (right, wrong, fixed, not answered); an answered one
  opens for review (nothing recorded), an unanswered one is played next. The end of a run shows
  the score, the mistakes, "Retry my mistakes" and "Start over".
- **Storage**: `bg-trainer/attempts/v1` holds `{ problemId, answerId, equityLoss, correct, at }`
  entries (a mistake's problem id is its decision id); `bg-trainer/play/v1` holds the play
  screen's animation speed; `bg-trainer/filters/v2` holds the filters
  (v1 had no source and is carried over on first load); `bg-trainer/lessons/v1` holds
  `{ attempts: [{ setKey, problemId, choiceId, correct, loss, retry, at }], runs: { <quiz id>:
  <start of the current run> } }`. A lesson score counts the first answer to each problem in the
  current run; answers in a "retry my mistakes" round (`retry`) can mark a mistake fixed but do
  not change the score; "Start over" moves the run marker and deletes nothing. All reads are
  wrapped in try/catch and the pages work without storage.

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
- **Explanations** are no longer a pipeline step (`explain.py` existed until 2026-09-03).
  `src/app/api/explain/route.ts` builds the prompt (`src/lib/explain.ts`: question, position
  from Blue's side, ranked answers with equities / losses / probabilities, features;
  `PROMPT_VERSION` v3 asks for 3–5 sentences of about 120 words and, for a match decision,
  adds a paragraph naming the move that was played and its loss), calls the Anthropic
  TypeScript SDK (`src/lib/claude.ts`, shared with the Hebrew translation route, which uses the
  same request shape at effort `low`), streamed (`max_tokens` 16000, 64000 at xhigh and max,
  where the thinking can run long; no `thinking` parameter; `output_config.effort` always sent,
  the chosen level or the model's default from `explain-models.ts`; `fallbacks: "default"` with
  the `server-side-fallback-2026-07-01` beta for Opus 5, Opus 5.5 and Fable 5.1; only text
  blocks are read, thinking blocks are ignored), checks `stop_reason`, cleans the text, inserts
  the store row and returns it (with its row id, which the panel then asks a translation for)
  and the audit. `GET /api/explain?problemId=` shows the prompt without calling the API. The
  key comes from `.env` at the repo root, loaded by Next.js into the server process only.
- **import_forum.py**: Discourse threads through their JSON API (with like counts), other
  pages by regex; outputs a positions file for `analyze.py` and a JSON of candidate replies.
- **import_match.py**: `.mat` files, folders or globs (expanded by the script, PowerShell does
  not); parses (`bgpipeline/mat.py`), replays (`replay.py`), evaluates the analysed player's
  decisions with one `run_gnubg` batch, scores them (`match_score.py`) and writes the match
  store tables (`store.py`). Skips matches already in the store unless `--replace`. `--json`
  prints NDJSON progress events (`start`, `parsed`, `gnubg`, `warning`, `done`, `skipped`,
  `error`) for the app; `--raw-out` / `--raw-in` record and reuse gnubg's raw output (the
  offline tests use `tests/fixtures/match_gnubg_plies0.json`). Exit codes: 2 no gnubg, 3 gnubg
  failed, 4 a file could not be read or replayed, 5 store error.
- **import_lessons.py**: Galaxy quiz exports (`.json` files, folders or globs). Parses and checks
  them (`bgpipeline/galaxy_quiz.py`: refuses unknown shapes, ids that are not Galaxy ids, image
  hosts other than Galaxy's CDN, and a file with fewer problems than the quiz); skips a set
  that is already imported without touching the network unless `--replace`; downloads the
  pictures with 8 workers (`image_fetch.py`; a picture on disk is reused when it has no row yet
  or its row has the same URL and MD5); keeps the file as `quiz.json`; writes the rows in one
  transaction (`lesson_store.py`). `--source-name` carries an upload's original name (for the
  collection). `--json` prints NDJSON events (`start`, `parsed`, `warning`, `images`, `skipped`,
  `done`, `error`). Exit codes: 4 a file could not be read or is not a quiz, 5 store error
  (including a problem already in another set), 6 a picture could not be downloaded. The first
  24 sets (1,494 pictures) took 45 s.
- **gnubg_server.py** (the app's live engine, not a command): runs inside one long-lived
  `gnubg-cli -t -q -p` that `src/lib/engine.ts` starts on first use (the script is copied to an
  ASCII folder, the pipeline is imported from `BG_PIPELINE_DIR`). One JSON request per stdin line
  (`analyse` an XGID, scoring `played` or gnubg's own choice), one `@@BG `-prefixed JSON line per
  answer; checker plays from `hint()`, cube decisions from `cfevaluate` + `evaluate` (equal to
  the text `hint`), everything else through `build_problem`, `score_decision` and the classifier,
  so a live decision looks exactly like an imported one. About 2 s to start, 0.05–0.2 s per
  2-ply checker analysis, 0.03 s per cube decision; the process stops after 15 idle minutes and
  exits when the server does (its stdin closes).

## 9. Backlog

Proposed order; reorder freely. Each item has a "done when" so a session can pick one up
without further briefing. The original brief is in `docs/BRIEF.md`.

1. **Judge the explanations on a bigger set.** Done so far (2026-09-03): generation moved into
   the app on demand with a model picker, prompt v2 asks for shorter prose, every generated
   text is kept in `data/store.sqlite` (the five Python-era v1 texts included, for comparison),
   and the panel flags quoted numbers or moves that are not in the data. First v2 samples
   (seed-001 on Opus 5, seed-002 on Fable 5.1) came out at 775–873 characters, 135–150 words,
   all numbers verified; if that still reads long, lower the word cap in `SYSTEM_PROMPT` and
   bump `PROMPT_VERSION`. Still open: generate and read 20 explanations from a real set
   (item 2) and note what the prompt gets wrong.
2. **A real problem set.** Pick a source (forum threads via `import_forum.py`, exported XG /
   gnubg games, or hand-picked XGIDs), analyse at 2-ply into a second file
   `data/<set>.json`, classify, spot-check 20 tags by hand. Done when the app shows 50+
   problems across several categories and `npm test` is green.
3. **Classifier tuning.** Use the feature log from item 2 to adjust rules in
   `bgpipeline/classify.py`; add a regression test per corrected case. Done when the
   spot-checked tags are right and no problem falls back to the default tag.
4. **Take/pass problems end to end.** The seeds have no dice `D` position. Add one real one,
   confirm the question text, `take`/`pass` answers, scoring and the flipped board. Done
   when it is in a data file with a passing data test and rendered correctly in `/board`.
5. **Mobile layout.** Board and answer buttons on a phone-width screen; keyboard hints hidden
   on touch devices. Done when the quiz is usable at 375 px wide in the browser preview.
6. **Progress export / import.** Download the attempt log as JSON and restore it, since
   `localStorage` is per browser. Done when a round trip preserves the stats page.
7. **Deeper analysis for hard problems.** Re-analyse problems with gap < 0.03 at 3-ply (or a
   gnubg rollout) and record `plies` in `analysis`. Done when the pipeline can re-run a
   subset by id and merge results without touching explanations.
8. **Match import, cube actions.** The Galaxy `.mat` importer is done (2026-09-04) but the only
   export seen so far is a 1-point match without cube actions; the parser follows gnubg's rules
   for `Doubles => N` / `Takes` / `Drops` and refuses unknown records. Done when a longer Galaxy
   export with a double has been imported and added to `pipeline/tests/fixtures/`.
9. **Lesson positions as XGIDs.** Lesson pictures are XG-style diagrams with a fixed layout, so
   an image reader could recover each position (checkers per point, bar, borne off, cube,
   dice, score). That would give lessons the board, pip counts, gnubg analysis, categories and
   the Explain button, and let lesson mistakes join the quiz. Check every reading against the
   pip counts printed on the picture, the legality of each listed play and the after-play
   pictures. Done when every problem of the imported sets has an XGID that passes those checks,
   stored in a new additive lesson schema version.
10. **Later ideas** (not scheduled): drag-and-drop move entry (click-to-move exists since
   phase 6), choosing a problem set in the UI, match-score-aware explanations, difficulty
   calibration from real error rates (the matches now provide them). Turning match errors into
   quiz problems is done (phase 6, automatic, § 5 My mistakes).
11. **Phase 7: where I lose equity.** A section on `/stats` from the store: the user's PR per
   match over time (games against gnubg and imports, oldest to newest), checker vs cube PR, the
   equity lost by category (the decisions' classifier tags) and by position class, and the cube
   errors by type (missed double, wrong double, wrong take, wrong pass), each with a link that
   opens the quiz filtered to that category among "My mistakes". Done when the numbers match
   `pr.ts` on the stored decisions (tested), and the page renders with real matches in the
   browser preview.
12. **Phase 7: try again before the answer.** A play-screen setting: when a decision loses 0.02
   or more, gnubg's verdict and ranking stay hidden, the board goes back to the position and the
   user looks for a better play (or cube action); then everything is revealed. The first choice
   is the one recorded and counted for PR; the game goes on with the final one (like gnubg's
   tutor). Done when both choices are stored (the retry in a new additive column or table),
   PR uses the first, tested in `play-service`, and checked in the browser.
13. **Phase 7: play on from any position.** "Play gnubg from here" on a quiz problem, one of the
   user's mistakes or a match decision: a money session (or the position's match score) that
   starts from that XGID with the dice as given, then continues as a normal game. Done when a
   started position plays to the end with correct rules (tests with scripted dice) and the
   buttons work in the browser.
14. **Opponent PR on Galaxy matches** (asked 2026-09-24, not chosen for phase 7): analyse
   player 2 too (`import_match.py --player both`, ids with `-p2` as for gnubg, about twice the
   gnubg time), show their PR next to the user's and compare it with the PR Galaxy shows for
   the same match. Done when a re-imported match shows both PRs and the ids of player 1 are
   unchanged.
15. **More study ideas** (not scheduled): a luck report per game (the equity each roll gained
   against the average roll, both sides), so bad dice are not mistaken for bad play; a Claude
   debrief of a whole match (on a button, like explanations: the themes behind the errors);
   weaker gnubg levels (it sometimes picks a slightly worse move from its ranking, so its PR is
   real); a pip-count drill (pip counts hidden, the user states them at race cube decisions);
   `.mat` export of games against gnubg for rollouts in gnubg or XG; the batch runner could use
   `cfevaluate` too and drop its text pass for cube decisions.

Known gaps: `import_forum.py` has not been tried on a live forum; Robertie's own positions are
copyrighted, so sets must come from own play, forums, or engine-found positions. The Galaxy
lessons are licensed material for the user's own study: they stay in the git-ignored
`data/lessons/` and must never be committed (a Galaxy export placed in `data/` itself would
also break the quiz loader, which reads every top-level `data/*.json` as a problem set).

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
| 2026-09-03 | Explanations default to `claude-opus-5`, prose only, shown with model and date | provenance is visible in the app; regeneration is explicit |
| 2026-09-03 | Explanations are generated on demand from the quiz, never in batch | the user chooses when, and with which model, an explanation is written |
| 2026-09-03 | `data/store.sqlite` from the start (node:sqlite in the app, stdlib sqlite3 in Python), rows never updated or deleted | a match importer is next and a JSONL log would have had to be migrated; nothing generated is ever overwritten |
| 2026-09-03 | Python `explain.py` removed | one prompt implementation; the app is the only caller of the Anthropic API |
| 2026-09-03 | Fable 5.1 preselected for the hard band (gap < 0.03), Opus 5 otherwise | the hardest positions get the strongest model; the user still clicks |
| 2026-09-04 | Matches are uploaded in the app; the route spawns the Python importer and streams its progress | no terminal needed; gnubg and the replay stay in the pipeline, the importer also works as a CLI |
| 2026-09-04 | Only Player 1's decisions are analysed (the user is always Player 1 in Galaxy exports) | halves gnubg time; `--player 2` exists for other files |
| 2026-09-04 | Own `.mat` parser and replay (gnubg's importer rules, the existing move generator) instead of gnubg's `import mat` + `analyse match` | every XGID is exact and testable offline; gnubg is only asked the questions `analyze.py` already asks |
| 2026-09-04 | Checker plays and cube decisions are evaluated, including the pre-roll "should I double?" whenever the cube is live | missed doubles are errors too; dead cubes are skipped so gnubg never reports a missing cube analysis |
| 2026-09-04 | Error thresholds 0.02 / 0.08 (XG style) | the familiar error / blunder scale; the page defaults to errors only |
| 2026-09-04 | Match rows may be replaced on re-import; explanations stay append-only | engine output is reproducible, generated text is not |
| 2026-09-04 | Prompt v3 names the played move for match decisions | the explanation addresses the actual mistake, not only the ranking |
| 2026-09-04 | Schema v2 is additive and single-sourced from `store-schema.ts`; Python reads it by regex | app and importer cannot drift; older files upgrade on the first write |
| 2026-09-11 | Galaxy quiz sets become lessons: picture-based multiple choice, played in file order, answers and Galaxy's equity text shown as written | the exports have no XGIDs; the analyses refer back to earlier positions |
| 2026-09-11 | Lessons live in their own git-ignored database with their pictures (`data/lessons/`), schema in `lesson-store-schema.ts` | the repository is public and the material is Galaxy's; `store.sqlite` stays committed and small |
| 2026-09-11 | Lesson keys are Galaxy's ids (`/lessons/<quiz id>`, `lesson-<problem id>`) | progress survives a re-import or a rebuilt database |
| 2026-09-11 | Lesson progress under its own `localStorage` key; the score counts first answers in a run, retries only mark mistakes fixed | a score that means what you knew the first time; no mixing with the quiz's spaced repetition |
| 2026-09-11 | The user's Galaxy session answers are not imported | the sessions were click-throughs to unlock the answers |
| 2026-09-11 | Lesson loss parsed only where Galaxy's text is unambiguous; the verdict comes from `correct` | the text mixes equities and differences, and one wrong play loses 0.000 |
| 2026-09-11 | Lesson rows are written only after every picture is on disk; a skip never touches the network, `--replace` repairs | the database never points at a missing file; re-uploading many sets is instant |
| 2026-09-11 | Lesson pictures are served from disk by a route handler and shown with a plain `<img>` | `next/image` refuses the `?v=` cache buster and the files need no resizing |
| 2026-09-11 | One helper runs the Python importers for both upload routes (`pipeline-process.ts`), one reads their NDJSON (`ndjson.ts`) | the match and lesson uploads share the spawn, stream and UTF-8 handling |
| 2026-09-24 | Play against gnubg in the app, at 2-ply, always its best move, with the cube | the user's goal is decision making under game conditions; gnubg is already installed and trusted |
| 2026-09-24 | One long-lived gnubg process with a JSON-lines script inside (`gnubg_server.py`), started by the server on first use | 2 s start once, then 0.05–0.2 s per decision; spawning gnubg per move would cost 2 s each |
| 2026-09-24 | Cube decisions in the live engine from `gnubg.cfevaluate` | equal to the text `hint` on every position checked, no text parsing, 0.03 s |
| 2026-09-24 | The live engine imports the pipeline (`build_problem`, `score_decision`, classifier) | a played decision is ranked, scored and tagged exactly like an imported one; no TypeScript port of the scoring rules |
| 2026-09-24 | Games against gnubg go into the existing `matches` / `games` / `decisions` tables (site `gnubg`, both players), the game in progress into `play_state`; the app writes them | one review page, one PR function, one mistake source; the importer's tables fit apart from the file columns |
| 2026-09-24 | The server rolls the dice (`crypto.randomInt`) and keeps the rules state; each request is one user action, engine calls first, one transaction at the end | a reload or a second tab cannot reroll or fork a game; the store is never locked while gnubg thinks |
| 2026-09-24 | Feedback after every decision; the game waits only after an error; a no-double gets a card only when it counts for PR | the user asked for feedback on every move; routine no-doubles would be noise |
| 2026-09-24 | Click-to-move: pick a checker, then a lit landing point; one click when there is only one; typed notation as well | no drag-and-drop needed; legality comes from the move generator's step sequences, so an entry can never get stuck |
| 2026-09-24 | PR = 500 × loss per counted decision, gnubg's rule for which cube decisions count | the XG / Galaxy scale the user knows; gnubg's close-cube rule is documented and reproducible from stored answers |
| 2026-09-24 | gnubg stays at full strength; its PR shows 0.0 with a note | chosen by the user; a meaningful opponent PR comes from Galaxy opponents (backlog 14) or weaker levels (backlog 15) |
| 2026-09-24 | Every error of the user (≥ 0.02, games and imports) joins the quiz automatically; `quiz_picks` adds or removes single decisions | chosen by the user; spaced repetition over one's own errors, keyed on decision ids |
| 2026-09-24 | The quiz always offers the move played in the game | the tempting wrong answer is the one worth practising against |
| 2026-09-24 | Take/pass answers carry the responder's probabilities | gnubg reports the doubler's; the flip applies to the pipeline too (no stored data had take decisions yet) |
| 2026-09-24 | Filters moved to `bg-trainer/filters/v2` (adds the source), v1 carried over on first load | the storage convention: a shape change gets a new key and a migration |
| 2026-09-24 | Claude Opus 5.5 added to the explanation picker (not the default), with `fallbacks: "default"` and effort `medium` set explicitly | asked by the user; $4 / $20 per M tokens against Opus 5's $5 / $25; its API default effort is `medium` (Opus 5: `high`) and it runs broader safety classifiers, so the fallback opt-in stays on |
| 2026-09-24 | gnubg's turn is replayed on the board from the server's events (dice, each checker gliding, hits to the bar, cube actions), at a speed the user picks, and can be skipped | asked by the user: see how the computer plays, at the pace of a human opponent; the server stays one request per action |
| 2026-09-24 | Moving as on Backgammon Galaxy: a tap moves a checker by the first die (the higher unless the dice are swapped by pressing them), drag and drop for any other landing point, the complete play confirmed by pressing the dice | asked by the user; replaces pick-a-checker-then-a-point; entry stays constrained to prefixes of legal plays, now with the die of each step |
| 2026-09-24 | Animations are pure frame lists (`board-animation.ts`) drawn by the static Board plus a Web Animations overlay; the Board stays hook-free | testable without a browser, and the quiz, review and `/board` pages keep rendering the same board on the server |
| 2026-09-24 | The explanation panel offers an effort level beside the model (default: the model's own), sent as `output_config.effort` and recorded in `explanations.effort` (schema v4, added to older files by `ADDED_COLUMNS` on both sides) | asked by the user; effort is the main cost / depth control on the current models, and provenance should say how an explanation was produced |
| 2026-09-24 | Explanation requests are streamed; `max_tokens` 64000 at xhigh and max | thinking counts toward `max_tokens`, and the SDK refuses non-streamed requests above about 21K tokens |
| 2026-09-24 | Every explanation is shown in English with a Hebrew translation under it: a second request right after a new explanation (same model as picked, effort `low`), older ones from a "Translate to Hebrew" button; translations are appended to their own table `translations`, keyed by the explanation row (schema v5) | asked by the user, who reads Hebrew more easily; translating the stored English keeps the English prompt, its audit and every earlier text as they were, works for the explanations already stored, and a failed translation never loses the explanation; nothing is generated on page load, as for explanations |
| 2026-09-24 | The Hebrew is drawn right to left with moves and signed numbers isolated left to right (`rtl.ts`), and checked against the English for numbers and moves | the Unicode bidi algorithm scrambles notation inside Hebrew ("*21/bar"); a translation that changes a number would mislead exactly where the user relies on it |
