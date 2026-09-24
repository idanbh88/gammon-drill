# Problem data

Every `*.json` file in this folder is one **problem set** and is loaded automatically.
Drop in another file to add problems; ids must be unique across all files. `store.sqlite` is not a
problem set: it holds the explanations generated from the app and the imported matches (see
below). `matches/` keeps the uploaded `.mat` files as received. `lessons/` (git-ignored) holds
the imported Backgammon Galaxy lessons; never put a Galaxy quiz export in this folder itself,
the loader would read it as a problem set and fail.

```jsonc
{
  "name": "seed",                 // set name, shown nowhere yet but used in errors
  "source": "where it came from", // optional
  "problems": [
    {
      "id": "seed-001",           // stable slug; progress in localStorage is keyed on it
      "xgid": "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10",  // no "XGID=" prefix
      "type": "checker",          // "checker" (dice rolled) or "cube" (dice 00 or D)
      "categories": ["opening"],  // one or more of the taxonomy below
      "explanation": "",          // optional hand-written text; generated text lives in store.sqlite
      "source": "handwritten",    // optional
      "analysis": { "engine": "manual" },          // optional provenance (Phase 2 fills it)
      "answers": [                // ranked best first, at least two
        { "id": "8/5 6/5", "label": "8/5 6/5", "equity": 0.15, "equityLoss": 0 },
        { "id": "24/23 13/10", "label": "24/23 13/10", "equity": 0.03, "equityLoss": 0.12 }
      ]
    }
  ]
}
```

## Explanations

The quiz generates explanations on demand (button under the answer reveal, model of your
choice) and inserts each one into `store.sqlite` (table `explanations`, schema in
`src/lib/store-schema.ts`). Rows are never updated or deleted; the loader shows the newest row
for a position's XGID and falls back to the JSON `explanation` field when there is none. Python
can read the file with the standard library `sqlite3`.

## Matches

`/matches` uploads a Backgammon Galaxy `.mat` export (you must be Player 1, the left column).
The file is saved under `matches/` and `pipeline/import_match.py` writes the match into
`store.sqlite`: table `matches` (site, match id, players, length, file, raw text), `games`
(score, Crawford, winner, points) and `decisions` (one row per decision of yours: XGID before
it, dice, what you played, gnubg's ranked answers as JSON, the loss, `forced` for rolls with
no choice). Re-importing with "analyse again" rewrites a match's games and decisions;
explanations are keyed by XGID and stay. Decision ids look like `match-45552673-g1-m3-checker`
and appear as `problem_id` on explanations generated from the match page.

## Games against gnubg

`/play` starts a match against gnubg (the app runs one gnubg process, see
`pipeline/bgpipeline/gnubg_server.py`). It is stored as it is played in the same tables: a
`matches` row with site `gnubg` (no file), a `games` row per game, and a `decisions` row for
every decision of both players, yours as player 1 and gnubg's as player 2
(`play-<match id>-g<game>-m<move>-<kind>`, gnubg's with `-p2`). The game in progress (the rules
state as JSON, a version number against double submits) is in table `play_state`. These rows
are never deleted.

## My mistakes

The quiz also draws from your own decisions: every one of yours (games against gnubg and
imported matches) that lost 0.02 or more, as a problem whose id is the decision id. Table
`quiz_picks` holds your overrides, one row per decision: `included = 0` takes a mistake out,
`1` adds any other decision of yours. Such problems carry an `origin` (where it was played, what
you played) that never appears in the JSON files.

## Lessons (git-ignored)

`/lessons` imports Backgammon Galaxy quiz exports (the JSON of a finished quiz) with
`pipeline/import_lessons.py`. They are Galaxy's material, and this repository is public, so the
whole `lessons/` folder stays on this machine:

```
lessons/lessons.sqlite                     sets, problems, choices, pictures (schema: src/lib/lesson-store-schema.ts)
lessons/<galaxy quiz id>/quiz.json         the export as received (it also holds your Galaxy session, not imported)
lessons/<galaxy quiz id>/images/p01.png    problem 1's position
lessons/<galaxy quiz id>/images/p01-c2.png the position after problem 1's choice 2 (checker plays)
```

The positions exist only as these pictures (no XGIDs). Choices, Galaxy's equity text and the
author's analysis are stored exactly as written. If the folder is lost, re-import the exports
(the pictures come back from Galaxy's CDN); your lesson progress lives in the browser
(`bg-trainer/lessons/v1`), keyed on Galaxy's ids, so it survives a rebuild.

## Answers

- `equityLoss` is `>= 0`, `0` for the best answer, and non-decreasing down the list.
- **Checker answers**: `id` is gnubg-style notation from the acting player's side
  (`bar/21* 24/21`, `6/4(2)`, `24/18*/13`). Every answer is checked against the legal-play
  generator when the data loads; equivalent notations (`13/10 10/7` = `13/7`) are accepted.
- **Cube answers** (dice `00`, the doubler decides): ids `no-double`, `double-take`,
  `double-pass`, `too-good`.
- **Take/pass answers** (dice `D`, the opponent of the turn player decides): ids `take`, `pass`.
- The quiz shows the top four answers as buttons in random order.

## Categories

`opening`, `early-game`, `blitz`, `holding-game`, `priming-game`, `back-game`,
`connectivity`, `hit-or-not`, `breaking-anchor`, `crunch`, `bearing-in`, `bearing-off`,
`racing-cube`, `contact-cube`, `containment`, `ace-point-game`.

## XGID cheat sheet

`<26-char position>:<cube log2>:<owner 1|0|-1>:<turn 1|-1>:<dice>:<score1>:<score2>:<crawford/jacoby>:<match length>:<max cube log2>`

Position index 0 is player 2's bar, 1–24 are points from player 1's side (1 = player 1's ace
point), 25 is player 1's bar. Uppercase letters are player 1's checkers, lowercase player 2's
(`A`/`a` = 1 … `P`/`p` = 16). Borne-off checkers are implied.
