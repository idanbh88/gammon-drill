# Problem data

Every `*.json` file in this folder is one **problem set** and is loaded automatically.
Drop in another file to add problems; ids must be unique across all files.

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
      "explanation": "",          // 3-5 sentences, written by pipeline/explain.py
      "explanationMeta": { "model": "claude-opus-5", "generatedAt": "2026-09-03" }, // optional
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
