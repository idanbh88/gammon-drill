import { describe, expect, it } from "vitest";
import {
  applyAction,
  cubeAvailable,
  legalPlays,
  newMatch,
  nextGame,
  RuleError,
  scoreAfter,
  winKind,
  winPoints,
  type GameState,
  type MatchSettings,
  type Phase,
} from "@/lib/game";
import { parseXgid, toXgid } from "@/lib/xgid";

const MONEY: MatchSettings = { matchLength: 0, jacoby: true };
const M5: MatchSettings = { matchLength: 5, jacoby: false };
const OPENING = "-b----E-C---eE---c-e----B-";

/** A state with the given position and phase, otherwise from a fresh match. */
function at(settings: MatchSettings, xgid: string, phase: Phase, over: Partial<GameState> = {}): GameState {
  const pos = parseXgid(xgid);
  return { ...newMatch(settings, [5, 3]), position: pos, score: pos.score, crawford: pos.crawford, phase, ...over };
}

describe("opening roll", () => {
  it("lets the higher die start with both numbers", () => {
    const s = newMatch(M5, [5, 3]);
    expect(s.phase).toEqual({ kind: "move", player: 1 });
    expect(toXgid(s.position)).toBe(`${OPENING}:0:0:1:53:0:0:0:5:10`);
    expect([s.game, s.move, s.turns, s.opening]).toEqual([1, 1, 1, [5, 3]]);
    const t = newMatch(M5, [2, 6]);
    expect(t.phase).toEqual({ kind: "move", player: 2 });
    expect(toXgid(t.position)).toBe(`${OPENING}:0:0:-1:62:0:0:0:5:10`);
    expect(toXgid(newMatch(MONEY, [4, 1]).position)).toBe(`${OPENING}:0:0:1:41:0:0:1:0:10`);
  });

  it("refuses a tie", () => {
    expect(() => newMatch(M5, [4, 4])).toThrow(RuleError);
  });
});

describe("turns", () => {
  it("records a play in canonical notation and passes the turn", () => {
    const s = newMatch(MONEY, [5, 3]);
    const r = applyAction(s, { type: "move", play: "13/8 13/10" });
    expect(r.decision).toEqual({
      player: 1,
      kind: "checker",
      xgid: `${OPENING}:0:0:1:53:0:0:1:0:10`,
      dice: [5, 3],
      played: "13/10 13/8",
      forced: false,
      game: 1,
      move: 1,
    });
    expect(r.state.phase).toEqual({ kind: "pre-roll", player: 2 });
    expect(r.state.position.dice).toBeNull();
    expect(r.state.position.turn).toBe(2);
    expect([r.state.move, r.state.turns]).toEqual([1, 2]);

    // Player 2 may double (money, centred cube): rolling records a no-double.
    const rolled = applyAction(r.state, { type: "roll", dice: [6, 4] });
    expect(rolled.decision).toMatchObject({ player: 2, kind: "cube", played: "no-double", dice: null, move: 1 });
    expect(rolled.decision!.xgid).toMatch(/:0:0:-1:00:0:0:1:0:10$/);
    expect(rolled.state.phase).toEqual({ kind: "move", player: 2 });
    const moved = applyAction(rolled.state, { type: "move", play: "24/18 13/9" });
    expect(moved.decision).toMatchObject({ player: 2, played: "24/18 13/9", move: 1 });
    expect(moved.state.phase).toEqual({ kind: "pre-roll", player: 1 });
    expect(moved.state.move).toBe(2);
  });

  it("starts a new move number with each of player 1's turns when player 2 opened", () => {
    const s = newMatch(M5, [1, 3]);
    const r = applyAction(s, { type: "move", play: "8/5 6/5" });
    expect(r.decision).toMatchObject({ player: 2, move: 1 });
    expect(r.state.move).toBe(2);
  });

  it("refuses illegal plays and actions out of turn", () => {
    const s = newMatch(MONEY, [5, 3]);
    expect(() => applyAction(s, { type: "move", play: "13/7" })).toThrow(RuleError);
    expect(() => applyAction(s, { type: "move", play: "nonsense" })).toThrow(RuleError);
    expect(() => applyAction(s, { type: "double" })).toThrow(RuleError);
    expect(() => applyAction(s, { type: "roll", dice: [1, 2] })).toThrow(RuleError);
    const over: GameState = { ...s, phase: { kind: "game-over", winner: 1, points: 1, how: "single", matchOver: false } };
    expect(() => applyAction(over, { type: "move", play: "13/8 13/10" })).toThrow(RuleError);
  });

  it("records a dance as a forced play with no notation", () => {
    // Player 1 on the bar against a closed board.
    const s = at(MONEY, "------N-----------cbbbbbbA:0:0:1:64:0:0:1:0:10", { kind: "move", player: 1 });
    expect(legalPlays(s)).toEqual([]);
    expect(() => applyAction(s, { type: "move", play: "6/2" })).toThrow(RuleError);
    const r = applyAction(s, { type: "move", play: "" });
    expect(r.decision).toMatchObject({ kind: "checker", played: "", forced: true, dice: [6, 4] });
    expect(r.state.phase).toEqual({ kind: "pre-roll", player: 2 });
  });

  it("marks a single legal play as forced", () => {
    const s = at(MONEY, "-N----------------------o-:0:0:1:65:0:0:1:0:10", { kind: "move", player: 1 });
    expect(legalPlays(s)).toHaveLength(1);
    const r = applyAction(s, { type: "move", play: "1/off 1/off" });
    expect(r.decision).toMatchObject({ played: "1/off(2)", forced: true });
    expect(r.state.phase.kind).toBe("pre-roll");
  });
});

describe("the cube", () => {
  const preRoll = `${OPENING}:0:0:1:00:0:0:1:0:10`;

  it("double, then take: the taker owns the cube at twice the value", () => {
    const s = at(MONEY, preRoll, { kind: "pre-roll", player: 1 });
    const d = applyAction(s, { type: "double" });
    expect(d.decision).toMatchObject({ player: 1, kind: "cube", played: "double", xgid: preRoll });
    expect(d.state.phase).toEqual({ kind: "take", player: 2 });
    expect(toXgid(d.state.position)).toBe(`${OPENING}:0:0:1:D:0:0:1:0:10`);
    const t = applyAction(d.state, { type: "take" });
    expect(t.decision).toMatchObject({ player: 2, kind: "take", played: "take", xgid: `${OPENING}:0:0:1:D:0:0:1:0:10` });
    expect(t.state.phase).toEqual({ kind: "pre-roll", player: 1 });
    expect([t.state.position.cubeValue, t.state.position.cubeOwner]).toEqual([2, 2]);
    expect(cubeAvailable(t.state.position, 1)).toBe(false);
    expect(cubeAvailable(t.state.position, 2)).toBe(true);
    // Rolling without access to the cube is not a decision.
    expect(applyAction(t.state, { type: "roll", dice: [3, 1] }).decision).toBeUndefined();
  });

  it("double, then pass: the doubler wins the cube's value", () => {
    const s = at(MONEY, preRoll, { kind: "pre-roll", player: 1 });
    const d = applyAction(s, { type: "double" });
    const p = applyAction(d.state, { type: "pass" });
    expect(p.decision).toMatchObject({ player: 2, kind: "take", played: "pass" });
    expect(p.state.phase).toEqual({ kind: "game-over", winner: 1, points: 1, how: "pass", matchOver: false });
    expect(scoreAfter(p.state)).toEqual([1, 0]);
  });

  it("is available only when a double could matter", () => {
    const base = parseXgid(`${OPENING}:0:0:1:00:0:0:0:5:10`);
    expect(cubeAvailable(base, 1)).toBe(true);
    expect(cubeAvailable({ ...base, crawford: true }, 1)).toBe(false);
    expect(cubeAvailable({ ...base, score: [4, 2] }, 1)).toBe(false);
    expect(cubeAvailable({ ...base, score: [4, 2] }, 2)).toBe(true);
    expect(cubeAvailable({ ...base, cubeValue: 2, cubeOwner: 2 }, 1)).toBe(false);
    expect(cubeAvailable({ ...base, cubeValue: 1024 }, 1)).toBe(false);
    expect(() => applyAction(at(M5, `${OPENING}:0:0:1:00:4:2:0:5:10`, { kind: "pre-roll", player: 1 }), { type: "double" })).toThrow(RuleError);
  });
});

describe("the end of a game", () => {
  it("counts single, gammon and backgammon wins", () => {
    const single = at(M5, "-A----------------------c-:0:0:1:21:0:0:0:5:10", { kind: "move", player: 1 });
    const r = applyAction(single, { type: "move", play: "1/off" });
    expect(r.decision).toMatchObject({ forced: true });
    expect(r.state.phase).toEqual({ kind: "game-over", winner: 1, points: 1, how: "single", matchOver: false });

    const gammon = at(M5, "-A----------------------o-:0:0:1:21:0:0:0:5:10", { kind: "move", player: 1 });
    expect(applyAction(gammon, { type: "move", play: "1/off" }).state.phase).toMatchObject({ how: "gammon", points: 2 });

    const backgammon = at(M5, "-Aa---------------------n-:1:1:1:21:0:0:0:5:10", { kind: "move", player: 1 });
    expect(applyAction(backgammon, { type: "move", play: "1/off" }).state.phase).toMatchObject({ how: "backgammon", points: 6 });

    const onBar = parseXgid("a-----------------------n-:0:0:1:00:0:0:0:5:10");
    expect(winKind(onBar, 1)).toBe("backgammon");
  });

  it("applies the Jacoby rule to an unturned cube in money play", () => {
    const pos = parseXgid("------------------------o-:0:0:1:00:0:0:1:0:10");
    expect(winPoints(pos, "gammon")).toBe(1);
    expect(winPoints({ ...pos, cubeValue: 2, cubeOwner: 2 }, "gammon")).toBe(4);
    expect(winPoints({ ...pos, jacoby: false }, "backgammon")).toBe(3);
  });

  it("ends the match when the winner reaches the length", () => {
    const s = at(M5, "-A----------------------c-:0:0:1:21:4:3:0:5:10", { kind: "move", player: 1 });
    const r = applyAction(s, { type: "move", play: "1/off" });
    expect(r.state.phase).toMatchObject({ kind: "game-over", matchOver: true });
    expect(scoreAfter(r.state)).toEqual([5, 3]);
    expect(() => nextGame(r.state, [3, 1])).toThrow(RuleError);
  });
});

describe("next game and the Crawford rule", () => {
  const over = (score: [number, number], winner: 1 | 2, points: number, crawfordDone = false): GameState => ({
    ...newMatch(M5, [5, 3]),
    score,
    crawfordDone,
    phase: { kind: "game-over", winner, points, how: "single", matchOver: false },
  });

  it("makes the first game after reaching match point the Crawford game, and only that one", () => {
    const g = nextGame(over([3, 2], 1, 1), [2, 5]);
    expect([g.game, g.score, g.crawford, g.crawfordDone]).toEqual([2, [4, 2], true, true]);
    expect(toXgid(g.position)).toBe(`${OPENING}:0:0:-1:52:4:2:1:5:10`);
    expect(cubeAvailable(g.position, 1)).toBe(false);
    expect(cubeAvailable(g.position, 2)).toBe(false);
    const post = nextGame({ ...g, phase: { kind: "game-over", winner: 2, points: 1, how: "single", matchOver: false } }, [6, 1]);
    expect([post.score, post.crawford, post.crawfordDone]).toEqual([[4, 3], false, true]);
    expect(cubeAvailable(post.position, 2)).toBe(true);
  });

  it("has no Crawford game when both reach match point together", () => {
    expect(nextGame(over([3, 4], 1, 1), [2, 5]).crawford).toBe(false);
  });

  it("refuses a new game while one is being played", () => {
    expect(() => nextGame(newMatch(M5, [5, 3]), [2, 1])).toThrow(RuleError);
  });
});
