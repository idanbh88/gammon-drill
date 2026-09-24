import { describe, expect, it } from "vitest";
import {
  BLUNDER_THRESHOLD,
  decisionProblem,
  ERROR_THRESHOLD,
  errorLevel,
  formatLoss,
  formatPlayedAt,
  groupByGame,
  matchResult,
  playedText,
  summarize,
  toMatchDecision,
} from "@/lib/matches";
import type { DecisionRow, GameRow } from "@/lib/store";

const XGID = "-b----E-C---eE---c-e----B-:0:0:1:41:0:0:0:1:10";

function row(over: Partial<DecisionRow> = {}): DecisionRow {
  return {
    id: 1,
    matchId: 7,
    gameId: 3,
    decisionId: "match-45552673-g1-m1-checker",
    gameNumber: 1,
    moveNumber: 1,
    player: 1,
    kind: "checker",
    xgid: XGID,
    dice: "41",
    played: "24/23 13/9",
    playedAnswerId: "24/23 13/9",
    bestAnswerId: "24/20 13/9",
    bestEquity: 0.1,
    playedEquity: 0.05,
    loss: 0.05,
    forced: false,
    positionClass: "contact",
    categories: ["opening", "not-a-category"],
    features: { pips_me: 167, can_hit: false },
    answers: [
      { id: "24/20 13/9", label: "24/20 13/9", equity: 0.1, equityLoss: 0 },
      { id: "24/23 13/9", label: "24/23 13/9", equity: 0.05, equityLoss: 0.05 },
      { id: "13/8", label: "13/8", equity: -0.1, equityLoss: 0.2 },
    ],
    plies: 2,
    analysedAt: "2026-09-04",
    ...over,
  };
}

describe("thresholds", () => {
  it("classifies losses XG-style", () => {
    expect(errorLevel(null)).toBe("ok");
    expect(errorLevel(0)).toBe("ok");
    expect(errorLevel(ERROR_THRESHOLD - 0.001)).toBe("ok");
    expect(errorLevel(ERROR_THRESHOLD)).toBe("error");
    expect(errorLevel(BLUNDER_THRESHOLD - 0.001)).toBe("error");
    expect(errorLevel(BLUNDER_THRESHOLD)).toBe("blunder");
  });
});

describe("decisionProblem", () => {
  it("builds a problem the quiz components understand", () => {
    const p = decisionProblem(row());
    expect(p).toMatchObject({
      id: "match-45552673-g1-m1-checker",
      xgid: XGID,
      type: "checker",
      categories: ["opening"],
      explanation: "",
      source: "match",
      analysis: { engine: "gnubg", plies: 2, positionClass: "contact", analysedAt: "2026-09-04" },
      features: { pips_me: 167, can_hit: false },
    });
    expect(p.answers).toHaveLength(3);
    expect(p.explanationMeta).toBeUndefined();
  });

  it("maps cube kinds and overlays the stored explanation by XGID", () => {
    const explanations = new Map([[XGID, { explanation: "Text.", model: "claude-opus-5", generatedAt: "2026-09-04T10:00:00.000Z" }]]);
    const cube = decisionProblem(row({ kind: "cube", dice: null, played: "no-double", positionClass: "weird", features: null }), explanations);
    expect(cube.type).toBe("cube");
    expect(cube.analysis?.positionClass).toBeUndefined();
    expect(cube.features).toBeUndefined();
    expect(cube.explanation).toBe("Text.");
    expect(cube.explanationMeta).toEqual({ model: "claude-opus-5", generatedAt: "2026-09-04" });
    expect(decisionProblem(row({ kind: "take", played: "pass" })).type).toBe("cube");
  });
});

describe("toMatchDecision", () => {
  it("pairs the problem with what was played", () => {
    const d = toMatchDecision(row());
    expect(d.played).toEqual({ id: "24/23 13/9", label: "24/23 13/9", equity: 0.05, loss: 0.05 });
    expect(d).toMatchObject({ game: 1, move: 1, kind: "checker", dice: "41", forced: false, playedText: "24/23 13/9", level: "error" });
  });

  it("handles forced, unscored and cube decisions", () => {
    const forced = toMatchDecision(row({ forced: true, loss: null, playedAnswerId: null, played: "", answers: [] }));
    expect(forced.played).toBeNull();
    expect(forced.playedText).toBe("no legal move");
    expect(forced.level).toBe("ok");
    const unscored = toMatchDecision(row({ loss: null, playedAnswerId: null }));
    expect(unscored.played).toBeNull();
    expect(playedText({ kind: "cube", played: "double", forced: false })).toBe("Double");
    expect(playedText({ kind: "cube", played: "no-double", forced: false })).toBe("No double");
    expect(playedText({ kind: "take", played: "take", forced: false })).toBe("Take");
    expect(playedText({ kind: "take", played: "pass", forced: false })).toBe("Pass");
  });
});

describe("summaries", () => {
  it("counts evaluated decisions, errors, blunders and the total loss", () => {
    const decisions = [
      toMatchDecision(row({ decisionId: "a", moveNumber: 1, loss: 0.05 })),
      toMatchDecision(row({ decisionId: "b", moveNumber: 2, loss: 0.1, playedAnswerId: "13/8", playedEquity: -0.1 })),
      toMatchDecision(row({ decisionId: "c", moveNumber: 3, loss: 0, playedAnswerId: "24/20 13/9" })),
      toMatchDecision(row({ decisionId: "d", moveNumber: 4, forced: true, loss: null, playedAnswerId: null, answers: [] })),
      toMatchDecision(row({ decisionId: "e", moveNumber: 5, loss: null, playedAnswerId: null })),
      toMatchDecision(row({ decisionId: "f", gameNumber: 2, moveNumber: 1, loss: 0.01 })),
    ];
    expect(summarize(decisions)).toEqual({ decisions: 5, forced: 1, errors: 2, blunders: 1, totalLoss: 0.16, unscored: 1 });
    const grouped = groupByGame(decisions);
    expect([...grouped.keys()]).toEqual([1, 2]);
    expect(grouped.get(1)).toHaveLength(5);
  });

  it("derives the match result from the games", () => {
    const games: GameRow[] = [
      { id: 1, matchId: 1, number: 1, score1: 0, score2: 0, crawford: false, winner: 2, points: 2 },
      { id: 2, matchId: 1, number: 2, score1: 0, score2: 2, crawford: false, winner: 1, points: 1 },
      { id: 3, matchId: 1, number: 3, score1: 1, score2: 2, crawford: false, winner: 2, points: 1 },
    ];
    expect(matchResult({ matchLength: 3 }, games)).toEqual({ score1: 1, score2: 3, winner: 2 });
    expect(matchResult({ matchLength: 5 }, games)).toEqual({ score1: 1, score2: 3, winner: null });
    expect(matchResult({ matchLength: 0 }, games)).toEqual({ score1: 1, score2: 3, winner: null });
    expect(matchResult({ matchLength: 5 }, [])).toEqual({ score1: 0, score2: 0, winner: null });
  });

  it("formats losses and dates", () => {
    expect(formatLoss(0)).toBe("—");
    expect(formatLoss(0.045)).toBe("−0.045");
    expect(formatPlayedAt("2026-09-03T18:37:00")).toBe("2026-09-03 18:37");
    expect(formatPlayedAt(null)).toBe("");
  });
});
