import { describe, expect, it } from "vitest";
import { newMatch, type GameState } from "@/lib/game";
import { toMatchDecision } from "@/lib/matches";
import type { LogEntry, PlayEvent } from "@/lib/play-service";
import { eventLines, isNotable, lastTurnLines, marksFor, positionAfter, promptText, scoreLine, verdict } from "@/lib/play-ui";
import type { DecisionRow } from "@/lib/store";
import { parseXgid, toXgid } from "@/lib/xgid";
import type { Answer } from "@/types/problem";

const OPENING_31 = "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:5:10";

function row(over: Partial<DecisionRow>): DecisionRow {
  return {
    id: 1,
    matchId: 2,
    gameId: 1,
    decisionId: "play-2-g1-m1-checker",
    gameNumber: 1,
    moveNumber: 1,
    player: 1,
    kind: "checker",
    xgid: OPENING_31,
    dice: "31",
    played: "8/5 6/5",
    playedAnswerId: "8/5 6/5",
    bestAnswerId: "8/5 6/5",
    bestEquity: 0.2,
    playedEquity: 0.2,
    loss: 0,
    forced: false,
    positionClass: "contact",
    categories: ["opening"],
    features: null,
    answers: [
      { id: "8/5 6/5", label: "8/5 6/5", equity: 0.2, equityLoss: 0 },
      { id: "24/23 13/10", label: "24/23 13/10", equity: 0.0, equityLoss: 0.2 },
    ],
    plies: 2,
    analysedAt: "2026-09-24",
    ...over,
  };
}

const cube = (nd: number, dt: number, dp = 1): Answer[] => [
  { id: "no-double", label: "No double, take", equity: nd, equityLoss: 0 },
  { id: "double-take", label: "Double, take", equity: dt, equityLoss: 0.1 },
  { id: "double-pass", label: "Double, pass", equity: dp, equityLoss: 0.5 },
  { id: "too-good", label: "No double, pass (too good)", equity: nd, equityLoss: 0.6 },
];

describe("event lines", () => {
  it("pairs a roll with its play and names both players", () => {
    const events: PlayEvent[] = [
      { type: "opening", game: 1, dice: [3, 5], first: 2 },
      { type: "move", player: 2, play: "13/8 13/10", forced: false, xgid: "x" },
      { type: "roll", player: 1, dice: [6, 4] },
      { type: "no-move", player: 1, dice: [6, 4] },
      { type: "double", player: 2, cube: 2 },
      { type: "take", player: 1 },
      { type: "double", player: 1, cube: 4 },
      { type: "pass", player: 2 },
      { type: "game-over", winner: 1, points: 2, how: "pass", matchOver: false },
      { type: "roll", player: 2, dice: [2, 1] },
      { type: "move", player: 2, play: "6/4 6/5", forced: true, xgid: "x" },
    ];
    expect(eventLines(events)).toEqual([
      "Game 1: you rolled 3, gnubg 5; gnubg starts with 53.",
      "gnubg played 13/8 13/10.",
      "You rolled 64 and cannot move.",
      "gnubg doubles to 2.",
      "You take.",
      "You double to 4.",
      "gnubg passes.",
      "You win 2 points, on a pass.",
      "gnubg rolled 21: 6/4 6/5 (forced).",
    ]);
  });

  it("recovers gnubg's last turn from the log", () => {
    const log: LogEntry[] = [
      { decisionId: "a", player: 1, move: 1, kind: "checker", dice: "31", played: "8/5 6/5", forced: false, loss: 0 },
      { decisionId: "b", player: 2, move: 1, kind: "cube", dice: null, played: "no-double", forced: false, loss: 0 },
      { decisionId: "c", player: 2, move: 1, kind: "checker", dice: "64", played: "24/18 13/9", forced: false, loss: 0 },
    ];
    expect(lastTurnLines(log)).toEqual(["gnubg rolled 64: 24/18 13/9."]);
    expect(lastTurnLines(log.slice(0, 1))).toEqual([]);
    expect(lastTurnLines([{ ...log[2], played: "" }])).toEqual(["gnubg rolled 64 and cannot move."]);
  });
});

describe("prompts", () => {
  const s = newMatch({ matchLength: 5, jacoby: false }, [3, 1]);
  it("says what the user has to do", () => {
    expect(promptText({ state: s, status: "playing" })).toBe("Your move: 31.");
    const preRoll: GameState = { ...s, phase: { kind: "pre-roll", player: 1 } };
    expect(promptText({ state: preRoll, status: "playing" })).toBe("Your turn: roll, or double.");
    const take: GameState = { ...s, position: parseXgid("-b----E-C---eE---c-e----B-:1:1:-1:D:0:0:0:5:10"), phase: { kind: "take", player: 1 } };
    expect(promptText({ state: take, status: "playing" })).toBe("gnubg redoubles to 4. Take or pass?");
    const over: GameState = { ...s, phase: { kind: "game-over", winner: 2, points: 2, how: "gammon", matchOver: true } };
    expect(promptText({ state: over, status: "finished" })).toBe("gnubg won the match.");
    expect(promptText({ state: { ...s, phase: { kind: "move", player: 2 } }, status: "playing" })).toBe("gnubg is thinking…");
    expect(scoreLine({ ...s, score: [4, 2], crawford: true })).toBe("5-point match · game 1 · you 4 – gnubg 2 · Crawford");
  });
});

describe("verdicts", () => {
  it("describes plays by how much they lost", () => {
    expect(verdict(toMatchDecision(row({})))).toEqual({ tone: "best", text: "8/5 6/5: gnubg's best play." });
    const bad = toMatchDecision(row({ played: "24/23 13/10", playedAnswerId: "24/23 13/10", loss: 0.2 }));
    expect(verdict(bad)).toEqual({ tone: "blunder", text: "Blunder −0.200: you played 24/23 13/10, gnubg plays 8/5 6/5." });
    const close = toMatchDecision(row({ played: "24/23 13/10", playedAnswerId: "24/23 13/10", loss: 0.01 }));
    expect(verdict(close).tone).toBe("fine");
    expect(verdict(toMatchDecision(row({ playedAnswerId: null, loss: null }))).tone).toBe("unscored");
  });

  it("describes cube actions", () => {
    const missed = toMatchDecision(row({ kind: "cube", played: "no-double", playedAnswerId: "no-double", loss: 0.04, answers: [cube(0.75, 0.79)[1], cube(0.75, 0.79)[0]] }));
    expect(verdict(missed)).toEqual({ tone: "error", text: "Missed double −0.040: gnubg says Double, take." });
    const pass = toMatchDecision(row({ kind: "take", played: "pass", playedAnswerId: "pass", loss: 0.2, answers: [
      { id: "take", label: "Take", equity: -0.8, equityLoss: 0 },
      { id: "pass", label: "Pass", equity: -1, equityLoss: 0.2 },
    ] }));
    expect(verdict(pass).text).toBe("Wrong pass −0.200: gnubg would take.");
  });

  it("shows a card for plays and cube actions, and for a no-double only when it matters", () => {
    expect(isNotable(toMatchDecision(row({})))).toBe(true);
    const routine = toMatchDecision(row({ kind: "cube", played: "no-double", playedAnswerId: "no-double", loss: 0, answers: cube(0.1, -0.17) }));
    expect(isNotable(routine)).toBe(false);
    const close = toMatchDecision(row({ kind: "cube", played: "no-double", playedAnswerId: "no-double", loss: 0, answers: cube(0.5, 0.45) }));
    expect(isNotable(close)).toBe(true);
    expect(isNotable(toMatchDecision(row({ kind: "cube", played: "double", playedAnswerId: "double-take", loss: 0.3, answers: cube(0.1, -0.17) })))).toBe(true);
  });
});

describe("board helpers", () => {
  it("builds the position after a play, the other side to roll", () => {
    const after = positionAfter(OPENING_31, "8/5 6/5", 1)!;
    expect(toXgid(after)).toBe("-b---BD-B---eE---c-e----B-:0:0:-1:00:0:0:0:5:10");
    expect(positionAfter(OPENING_31, "6/2", 1)).not.toBeNull();
    expect(positionAfter(OPENING_31, "8/1", 1)).toBeNull(); // the ace point is held
    expect(positionAfter(OPENING_31, "nonsense", 1)).toBeNull();
  });

  it("marks the last play from the mover's side", () => {
    expect(marksFor({ player: 2, play: "24/21 13/11", xgid: "x" })).toEqual([
      { side: "them", from: 24, to: 21 },
      { side: "them", from: 13, to: 11 },
    ]);
    expect(marksFor({ player: 1, play: "8/5(2)", xgid: "x" })).toHaveLength(2);
    expect(marksFor(null)).toEqual([]);
  });
});
