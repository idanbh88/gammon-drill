import { describe, expect, it } from "vitest";
import { actingPlayer, toPerspective, viewFromCounts } from "@/lib/board";
import { applySteps, formatPlay, generatePlays, isLegalPlay, parsePlay, stateFromView, stateKey } from "@/lib/moves";
import { parseXgid } from "@/lib/xgid";

const OPENING = "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10";

function viewOf(xgid: string) {
  const pos = parseXgid(xgid);
  return toPerspective(pos, actingPlayer(pos));
}

function notations(view: ReturnType<typeof viewOf>, dice: [number, number]) {
  return generatePlays(view, dice).map((p) => p.notation);
}

describe("generatePlays: basic movement", () => {
  const opening = viewOf(OPENING);

  it("finds the standard opening plays for 31", () => {
    const ns = notations(opening, [3, 1]);
    expect(ns).toContain("8/5 6/5");
    expect(ns).toContain("24/23 24/21");
    expect(ns.some((n) => n.includes("13/12"))).toBe(false); // the 12 point is held by White
    expect(ns).toContain("24/23 13/10");
    expect(ns).toContain("24/20");
    expect(ns).toContain("13/9");
    expect(ns).not.toContain("13/10 13/9");
    // every play uses both dice
    for (const p of generatePlays(opening, [3, 1])) expect(p.steps).toHaveLength(2);
  });

  it("never lands on a point held by two or more opposing checkers", () => {
    // 6 pips from 24 is the 18 point (open), 5 pips from 24 is the 19 point (held by 5)
    const ns = notations(opening, [6, 5]);
    expect(ns).toContain("24/13");
    expect(ns.some((n) => n.includes("24/19"))).toBe(false);
  });

  it("dedupes plays that reach the same position", () => {
    const v = viewFromCounts({ mine: { 6: 15 }, theirs: { 19: 15 } });
    const ns = notations(v, [2, 1]);
    // 6/4 6/5, and 6/3 (via 4 or via 5, same result)
    expect(ns.sort()).toEqual(["6/3", "6/5 6/4"].sort());
  });
});

describe("generatePlays: the bar", () => {
  const theirs = { 19: 2, 20: 2, 21: 2, 22: 2, 23: 2, 1: 2, 12: 3 };

  it("must enter before doing anything else", () => {
    const v = viewFromCounts({ mine: { 13: 5, 8: 3, 6: 5, 24: 1 }, myBar: 1, theirs });
    const ns = notations(v, [2, 1]);
    // 2 enters on the 23 point (blocked), 1 enters on the 24 point
    expect(ns.every((n) => n.startsWith("bar/24"))).toBe(true);
    expect(ns).toContain("bar/24 13/11");
    expect(ns).toContain("bar/24 6/4");
    expect(isLegalPlay(v, [2, 1], "13/11 13/12")).toBe(false);
  });

  it("returns no plays when entry is impossible", () => {
    const v = viewFromCounts({ mine: { 13: 5, 8: 3, 6: 6 }, myBar: 1, theirs: { 19: 2, 20: 2, 21: 2, 22: 2, 23: 2, 24: 2, 12: 3 } });
    expect(generatePlays(v, [2, 1])).toEqual([]);
    expect(isLegalPlay(v, [2, 1], "")).toBe(true);
    expect(isLegalPlay(v, [2, 1], "13/11")).toBe(false);
  });

  it("enters two checkers with doubles and keeps going", () => {
    const v = viewFromCounts({ mine: { 13: 5, 8: 3, 6: 5 }, myBar: 2, theirs: { 19: 2, 20: 2, 22: 2, 23: 2, 1: 2, 12: 5 } });
    const ns = notations(v, [4, 4]);
    expect(ns).toContain("bar/21(2) 13/9(2)");
    expect(ns).toContain("bar/21(2) 8/4(2)");
    expect(ns).toContain("bar/17(2)");
    for (const p of generatePlays(v, [4, 4])) expect(p.steps).toHaveLength(4);
  });
});

describe("generatePlays: dice usage rules", () => {
  it("must play both dice when any order allows it", () => {
    // Only the checker on 24 can move. 18 (six away) is blocked, 19 (five away) is open,
    // then 19 -> 13 (six) is open too, so 24/19/13 is forced.
    const v = viewFromCounts({ mine: { 24: 1, 1: 14 }, theirs: { 18: 2, 2: 2, 3: 2, 4: 2, 5: 2, 7: 3, 8: 2 } });
    expect(notations(v, [6, 5])).toEqual(["24/13"]);
    expect(notations(v, [5, 6])).toEqual(["24/13"]);
  });

  it("plays the larger die when only one die can be played", () => {
    // 18 and 19 are open but 13 is blocked, so either die can be played but not both.
    const v = viewFromCounts({ mine: { 24: 1, 1: 14 }, theirs: { 13: 2, 2: 2, 3: 2, 4: 2, 5: 2, 7: 3, 8: 2 } });
    expect(notations(v, [6, 5])).toEqual(["24/18"]);
    expect(isLegalPlay(v, [6, 5], "24/19")).toBe(false);
  });

  it("plays the smaller die alone when the larger cannot be played at all", () => {
    // 18 blocked and 13 blocked: only 24/19 is possible.
    const v = viewFromCounts({ mine: { 24: 1, 1: 14 }, theirs: { 18: 2, 13: 2, 2: 2, 3: 2, 4: 2, 5: 2, 7: 3 } });
    expect(notations(v, [6, 5])).toEqual(["24/19"]);
  });

  it("plays up to four moves with doubles", () => {
    const v = viewOf("-b----E-C---eE---c-e----B-:0:0:1:44:0:0:0:7:10");
    const ns = notations(v, [4, 4]);
    expect(ns).toContain("24/20(2) 13/9(2)");
    expect(ns).toContain("13/5(2)");
    expect(ns).toContain("24/16(2)");
    for (const p of generatePlays(v, [4, 4])) expect(p.steps).toHaveLength(4);
  });
});

describe("generatePlays: hitting", () => {
  it("marks hits and sends the blot to the bar", () => {
    const v = viewFromCounts({ mine: { 24: 2, 13: 5, 8: 3, 6: 5 }, theirs: { 21: 1, 12: 5, 17: 3, 19: 5, 1: 1 } });
    const plays = generatePlays(v, [3, 1]);
    const hit = plays.find((p) => p.notation === "24/21* 6/5");
    expect(hit).toBeDefined();
    expect(hit!.steps.find((s) => s.to === 21)!.hit).toBe(true);
    expect(hit!.result.theirBar).toBe(1);
    expect(hit!.result.points[21]).toBe(1);
    expect(plays.some((p) => p.notation === "24/21*/20")).toBe(true);
  });
});

describe("generatePlays: bearing off", () => {
  const theirs = { 19: 2, 20: 2, 21: 3, 22: 2, 23: 1 };

  it("bears off exactly and moves inside the board", () => {
    const v = viewFromCounts({ mine: { 6: 2, 5: 3, 4: 2, 2: 2, 1: 1 }, theirs });
    expect(v.myOff).toBe(5);
    const ns = notations(v, [5, 2]);
    expect(ns).toContain("5/off 2/off");
    expect(ns).toContain("6/4 6/1");
    expect(ns).toContain("6/1 5/3");
    expect(ns).toContain("6/4 5/off");
    expect(ns).toContain("5/off 4/2");
    // 6/off with a 5 is not allowed while a checker sits on the 6 point
    expect(isLegalPlay(v, [5, 2], "6/off 2/off")).toBe(false);
    // 4/off with a 5 is not allowed while checkers sit on higher points
    expect(isLegalPlay(v, [5, 2], "4/off 2/off")).toBe(false);
  });

  it("allows a larger die to bear off from the highest point", () => {
    const v = viewFromCounts({ mine: { 4: 2, 3: 1 }, theirs });
    const ns = notations(v, [6, 5]);
    expect(ns).toContain("4/off(2)");
    expect(ns).not.toContain("4/off 3/off");
    expect(isLegalPlay(v, [6, 5], "3/off 4/off")).toBe(false);
    const v2 = viewFromCounts({ mine: { 4: 1, 3: 1 }, theirs });
    expect(notations(v2, [6, 5])).toEqual(["4/off 3/off"]);
  });

  it("forbids bearing off with a checker outside the home board or on the bar", () => {
    const v = viewFromCounts({ mine: { 7: 1, 6: 2, 5: 3 }, theirs });
    expect(isLegalPlay(v, [6, 1], "7/1 6/off")).toBe(false);
    expect(isLegalPlay(v, [6, 1], "6/off 7/6")).toBe(true); // same resulting position as 7/6 6/off
    expect(isLegalPlay(v, [6, 1], "7/1 6/5")).toBe(true);
    expect(isLegalPlay(v, [6, 1], "7/6 6/off")).toBe(true);
    const onBar = viewFromCounts({ mine: { 6: 2, 5: 3 }, myBar: 1, theirs });
    expect(isLegalPlay(onBar, [6, 1], "6/off bar/24")).toBe(false);
    expect(isLegalPlay(onBar, [6, 1], "bar/24 6/5")).toBe(false); // the 1 was used to enter
    expect(isLegalPlay(onBar, [6, 1], "bar/18")).toBe(true);
  });
});

describe("notation", () => {
  it("parses and formats round trips", () => {
    for (const n of ["bar/21* 24/21", "8/5(2) 6/5(2)", "24/18*/13", "6/off 5/off", "bar/22 13/9", "13/7"]) {
      expect(formatPlay(parsePlay(n))).toBe(n);
    }
  });

  it("expands repeats and chains into steps", () => {
    expect(parsePlay("6/4(2)")).toEqual([
      { from: 6, to: 4, hit: false },
      { from: 6, to: 4, hit: false },
    ]);
    expect(parsePlay("24/18*/13")).toEqual([
      { from: 24, to: 18, hit: true },
      { from: 18, to: 13, hit: false },
    ]);
    expect(parsePlay("Bar/22 6/Off")).toEqual([
      { from: 25, to: 22, hit: false },
      { from: 6, to: 0, hit: false },
    ]);
  });

  it("rejects malformed notation", () => {
    for (const bad of ["24", "24/", "/21", "25/21", "24/21(0)", "off/6", "6/bar", "x/y"]) {
      expect(() => parsePlay(bad)).toThrow();
    }
  });

  it("treats equivalent notations as the same play", () => {
    const v = viewOf(OPENING);
    expect(isLegalPlay(v, [3, 1], "24/21 21/20")).toBe(true);
    expect(isLegalPlay(v, [3, 1], "24/20")).toBe(true);
    expect(isLegalPlay(v, [3, 1], "8/5 6/5")).toBe(true);
    expect(isLegalPlay(v, [3, 1], "6/5 8/5")).toBe(true);
    expect(isLegalPlay(v, [3, 1], "13/9")).toBe(true);
    expect(isLegalPlay(v, [3, 1], "13/10")).toBe(false); // only one die used
    expect(isLegalPlay(v, [3, 1], "13/10 13/8")).toBe(false); // wrong dice
    const s = applySteps(stateFromView(v), parsePlay("8/5 6/5"));
    expect(s).not.toBeNull();
    expect(stateKey(s!)).toBe(stateKey(generatePlays(v, [3, 1]).find((p) => p.notation === "8/5 6/5")!.result));
  });
});
