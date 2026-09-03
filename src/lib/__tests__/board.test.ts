import { describe, expect, it } from "vitest";
import {
  actingPlayer,
  checkersOnBoard,
  decisionKind,
  pipCounts,
  questionText,
  scoreCaption,
  toPerspective,
  viewFromCounts,
} from "@/lib/board";
import { parseXgid } from "@/lib/xgid";

const OPENING = "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10";

describe("pip counts", () => {
  it.each([
    [OPENING, 167, 167],
    ["---BCCD-B-A--a-a-b-dcca---:0:0:1:00:2:1:0:7:10", 83, 92],
    ["-b---BD-C---dD---c-cba--AA:0:0:1:43:0:0:0:7:10", 159, 156],
    ["-AB-BCB------------bbcba--:1:1:1:52:3:2:0:7:10", 40, 42],
    ["--ABCBB------------bcb-ba-:1:-1:-1:52:2:3:0:7:10", 42, 40],
  ])("%s -> player 1 %i, player 2 %i", (xgid, p1, p2) => {
    expect(pipCounts(parseXgid(xgid))).toEqual([p1, p2]);
  });

  it("counts a checker on the bar as 25 pips", () => {
    const v = viewFromCounts({ mine: { 6: 14 }, myBar: 1 });
    expect(v.myPips).toBe(6 * 14 + 25);
    expect(v.myOff).toBe(0);
  });
});

describe("toPerspective", () => {
  it("is the identity numbering for player 1", () => {
    const v = toPerspective(parseXgid(OPENING), 1);
    expect(v.me).toBe(1);
    expect(v.points[24]).toBe(2);
    expect(v.points[13]).toBe(5);
    expect(v.points[1]).toBe(-2);
    expect(v.points[19]).toBe(-5);
    expect(v.myOff).toBe(0);
    expect(v.theirOff).toBe(0);
  });

  it("mirrors the board for player 2", () => {
    const v = toPerspective(parseXgid(OPENING), 2);
    expect(v.me).toBe(2);
    // player 2 back checkers sit on the player 1 ace point = player 2 24 point
    expect(v.points[24]).toBe(2);
    expect(v.points[13]).toBe(5);
    expect(v.points[8]).toBe(3);
    expect(v.points[6]).toBe(5);
    expect(v.points[1]).toBe(-2);
    expect(v.myPips).toBe(167);
  });

  it("maps bars and borne-off checkers", () => {
    const v = toPerspective(parseXgid("-b---BD-C---dD---c-cba--AA:0:0:1:43:0:0:0:7:10"), 1);
    expect(v.myBar).toBe(1);
    expect(v.theirBar).toBe(0);
    const v2 = toPerspective(parseXgid("-b---BD-C---dD---c-cba--AA:0:0:1:43:0:0:0:7:10"), 2);
    expect(v2.theirBar).toBe(1);
    expect(v2.myBar).toBe(0);

    const bearoff = parseXgid("--ABCBB------------bcb-ba-:1:-1:-1:52:2:3:0:7:10");
    expect(checkersOnBoard(bearoff)).toEqual([10, 10]);
    const v3 = toPerspective(bearoff, 2);
    expect(v3.myOff).toBe(5);
    expect(v3.theirOff).toBe(5);
    expect(v3.myPips).toBe(40);
    expect(v3.theirPips).toBe(42);
  });

  it("gives the same view for a position and its mirrored encoding", () => {
    const asPlayer1 = toPerspective(parseXgid("-AB-BCB------------bbcba--:1:1:1:52:3:2:0:7:10"), 1);
    const asPlayer2 = toPerspective(parseXgid("--ABCBB------------bcb-ba-:1:-1:-1:52:2:3:0:7:10"), 2);
    expect(asPlayer2.points).toEqual(asPlayer1.points);
    expect(asPlayer2.myBar).toBe(asPlayer1.myBar);
    expect(asPlayer2.theirBar).toBe(asPlayer1.theirBar);
    expect(asPlayer2.myOff).toBe(asPlayer1.myOff);
    expect(asPlayer2.theirOff).toBe(asPlayer1.theirOff);
    expect(asPlayer2.myPips).toBe(asPlayer1.myPips);
    expect(asPlayer2.theirPips).toBe(asPlayer1.theirPips);
  });
});

describe("decisions and captions", () => {
  it("identifies the acting player and decision kind", () => {
    const checker = parseXgid(OPENING);
    expect(decisionKind(checker)).toBe("checker");
    expect(actingPlayer(checker)).toBe(1);

    const cube = parseXgid("---BCCD-B-A--a-a-b-dcca---:0:0:1:00:2:1:0:7:10");
    expect(decisionKind(cube)).toBe("cube-double");
    expect(actingPlayer(cube)).toBe(1);

    const offered = parseXgid("---BCCD-B-A--a-a-b-dcca---:0:0:1:D:2:1:0:7:10");
    expect(decisionKind(offered)).toBe("cube-take");
    expect(actingPlayer(offered)).toBe(2);

    const p2moves = parseXgid("--ABCBB------------bcb-ba-:1:-1:-1:52:2:3:0:7:10");
    expect(actingPlayer(p2moves)).toBe(2);
  });

  it("builds question text", () => {
    expect(questionText(parseXgid(OPENING))).toBe("Blue to play 31");
    expect(questionText(parseXgid("---BCCD-B-A--a-a-b-dcca---:0:0:1:00:2:1:0:7:10"))).toBe(
      "Blue on roll. Cube action?",
    );
    expect(questionText(parseXgid("---BCCD-B-A--a-a-b-dcca---:0:0:1:D:2:1:0:7:10"))).toBe(
      "White doubles to 2. Take or pass?",
    );
    expect(questionText(parseXgid("---BCCD-B-A--a-a-b-dcca---:1:1:1:D:2:1:0:7:10"))).toBe(
      "White redoubles to 4. Take or pass?",
    );
  });

  it("builds the score caption from the acting player side", () => {
    expect(scoreCaption(parseXgid("---BCCD-B-A--a-a-b-dcca---:0:0:1:00:2:1:0:7:10"))).toBe(
      "7-point match · Blue 2 – White 1",
    );
    expect(scoreCaption(parseXgid("--ABCBB------------bcb-ba-:1:-1:-1:52:2:3:0:7:10"))).toBe(
      "7-point match · Blue 3 – White 2",
    );
    expect(scoreCaption(parseXgid("-b----E-C---eE---c-e----B-:0:0:1:00:6:4:1:7:10"))).toBe(
      "7-point match · Blue 6 – White 4 · Crawford",
    );
    expect(scoreCaption(parseXgid("-b----E-C---eE---c-e----B-:0:0:1:00:0:0:3:0:10"))).toBe(
      "Money game · Jacoby · Beavers",
    );
  });
});
