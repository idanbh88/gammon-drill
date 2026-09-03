import { describe, expect, it } from "vitest";
import { parseXgid, toXgid, XgidError } from "@/lib/xgid";

const OPENING = "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10";

const SEEDS = [
  OPENING,
  "-b----E-C---eE---c-e----B-:0:0:1:63:0:0:0:7:10",
  "---BCCD-B-A--a-a-b-dcca---:0:0:1:00:2:1:0:7:10",
  "-b---BD-C---dD---c-cba--AA:0:0:1:43:0:0:0:7:10",
  "--ABCBB------------bcb-ba-:1:-1:-1:52:2:3:0:7:10",
];

function totals(board: number[]): [number, number] {
  let p1 = 0;
  let p2 = 0;
  for (const v of board) {
    if (v > 0) p1 += v;
    else p2 -= v;
  }
  return [p1, p2];
}

describe("parseXgid", () => {
  it("parses the opening position", () => {
    const pos = parseXgid(OPENING);
    expect(pos.board).toHaveLength(26);
    expect(pos.board[1]).toBe(-2);
    expect(pos.board[6]).toBe(5);
    expect(pos.board[8]).toBe(3);
    expect(pos.board[12]).toBe(-5);
    expect(pos.board[13]).toBe(5);
    expect(pos.board[17]).toBe(-3);
    expect(pos.board[19]).toBe(-5);
    expect(pos.board[24]).toBe(2);
    expect(pos.board[0]).toBe(0);
    expect(pos.board[25]).toBe(0);
    expect(totals(pos.board)).toEqual([15, 15]);
    expect(pos.cubeValue).toBe(1);
    expect(pos.cubeOwner).toBe("center");
    expect(pos.turn).toBe(1);
    expect(pos.dice).toEqual([3, 1]);
    expect(pos.cubeAction).toBe("none");
    expect(pos.score).toEqual([0, 0]);
    expect(pos.matchLength).toBe(7);
    expect(pos.crawford).toBe(false);
    expect(pos.maxCube).toBe(1024);
  });

  it("tolerates the XGID= prefix and surrounding whitespace", () => {
    expect(parseXgid(`  XGID=${OPENING}\n`)).toEqual(parseXgid(OPENING));
    expect(parseXgid(`xgid=${OPENING}`)).toEqual(parseXgid(OPENING));
  });

  it("parses cube, owner, turn and scores", () => {
    const pos = parseXgid("--ABCBB------------bcb-ba-:1:-1:-1:52:2:3:0:7:10");
    expect(pos.cubeValue).toBe(2);
    expect(pos.cubeOwner).toBe(2);
    expect(pos.turn).toBe(2);
    expect(pos.dice).toEqual([5, 2]);
    expect(pos.score).toEqual([2, 3]);
    expect(totals(pos.board)).toEqual([10, 10]);
  });

  it("parses bars", () => {
    const pos = parseXgid("-b---BD-C---dD---c-cba--AA:0:0:1:43:0:0:0:7:10");
    expect(pos.board[25]).toBe(1); // player 1 bar
    expect(pos.board[0]).toBe(0);
    const pos2 = parseXgid("ab---BD-C---dD---c-cb---A-:0:0:-1:43:0:0:0:7:10");
    expect(pos2.board[0]).toBe(-1); // player 2 bar
  });

  it("parses dice 00 as a cube decision and D/B/R as cube actions", () => {
    expect(parseXgid("---BCCD-B-A--a-a-b-dcca---:0:0:1:00:2:1:0:7:10").dice).toBeNull();
    expect(parseXgid("---BCCD-B-A--a-a-b-dcca---:0:0:1:00:2:1:0:7:10").cubeAction).toBe("none");
    expect(parseXgid("---BCCD-B-A--a-a-b-dcca---:0:0:1:D:2:1:0:7:10").cubeAction).toBe("double");
    expect(parseXgid("---BCCD-B-A--a-a-b-dcca---:0:0:1:B:0:0:3:0:10").cubeAction).toBe("beaver");
    expect(parseXgid("---BCCD-B-A--a-a-b-dcca---:0:0:1:R:0:0:3:0:10").cubeAction).toBe("raccoon");
    expect(parseXgid("---BCCD-B-A--a-a-b-dcca---:0:0:1:d:2:1:0:7:10").cubeAction).toBe("double");
  });

  it("interprets the crawford/jacoby field by match vs money", () => {
    expect(parseXgid("-b----E-C---eE---c-e----B-:0:0:1:00:6:4:1:7:10").crawford).toBe(true);
    const money = parseXgid("-b----E-C---eE---c-e----B-:0:0:1:00:0:0:3:0:10");
    expect(money.crawford).toBe(false);
    expect(money.jacoby).toBe(true);
    expect(money.beavers).toBe(true);
    const moneyJacobyOnly = parseXgid("-b----E-C---eE---c-e----B-:0:0:1:00:0:0:1:0:10");
    expect(moneyJacobyOnly.jacoby).toBe(true);
    expect(moneyJacobyOnly.beavers).toBe(false);
  });

  it.each([
    ["-b----E-C---eE---c-e----B:0:0:1:31:0:0:0:7:10", /26 characters/],
    ["-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7", /10 colon/],
    ["-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10:1", /10 colon/],
    ["-b----E-C---eE---c-e----Bz:0:0:1:31:0:0:0:7:10", /invalid character/],
    ["-b----E-C---eE---c-e---PB-:0:0:1:31:0:0:0:7:10", /player 1 has/],
    ["pb----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10", /player 2 has/],
    ["Ab----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10", /player 2 bar/],
    ["-b----E-C---eE---c-e----Ba:0:0:1:31:0:0:0:7:10", /player 1 bar/],
    ["-b----E-C---eE---c-e----B-:0:2:1:31:0:0:0:7:10", /cube owner/],
    ["-b----E-C---eE---c-e----B-:0:0:0:31:0:0:0:7:10", /turn/],
    ["-b----E-C---eE---c-e----B-:0:0:1:37:0:0:0:7:10", /dice/],
    ["-b----E-C---eE---c-e----B-:0:0:1:3:0:0:0:7:10", /dice/],
    ["-b----E-C---eE---c-e----B-:x:0:1:31:0:0:0:7:10", /cube/],
    ["-b----E-C---eE---c-e----B-:0:0:1:31:-1:0:0:7:10", /score/],
  ])("rejects bad input %s", (xgid, error) => {
    expect(() => parseXgid(xgid)).toThrow(XgidError);
    expect(() => parseXgid(xgid)).toThrow(error);
  });
});

describe("toXgid", () => {
  it.each(SEEDS)("round-trips %s", (xgid) => {
    expect(toXgid(parseXgid(xgid))).toBe(xgid);
  });

  it("round-trips cube actions and money flags", () => {
    for (const x of [
      "---BCCD-B-A--a-a-b-dcca---:0:0:1:D:2:1:0:7:10",
      "---BCCD-B-A--a-a-b-dcca---:1:1:1:B:0:0:3:0:10",
      "---BCCD-B-A--a-a-b-dcca---:2:-1:-1:R:0:0:2:0:10",
      "-b----E-C---eE---c-e----B-:0:0:1:00:6:4:1:7:10",
    ]) {
      expect(toXgid(parseXgid(x))).toBe(x);
    }
  });

  it("rejects a non power-of-two cube", () => {
    const pos = parseXgid(OPENING);
    expect(() => toXgid({ ...pos, cubeValue: 3 })).toThrow(XgidError);
  });
});
