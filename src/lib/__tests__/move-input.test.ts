import { describe, expect, it } from "vitest";
import { toPerspective, viewFromCounts } from "@/lib/board";
import {
  boardAfter,
  clear,
  destinations,
  diceUsage,
  enter,
  entryNotation,
  isComplete,
  movableFrom,
  remainingDice,
  startEntry,
  swapDice,
  tapGroup,
  undo,
} from "@/lib/move-input";
import { generatePlays, legalSequences, stateKey } from "@/lib/moves";
import { parseXgid } from "@/lib/xgid";

const opening = toPerspective(parseXgid("-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10"), 1);

describe("legalSequences", () => {
  it("lists every order of every legal play with the die of each step", () => {
    const seqs = legalSequences(opening, [3, 1]);
    expect(seqs.every((s) => s.steps.length === 2 && s.dice.length === 2)).toBe(true);
    const byText = new Map(seqs.map((s) => [s.steps.map((st) => `${st.from}/${st.to}`).join(" "), s.dice]));
    expect(byText.get("8/5 6/5")).toEqual([3, 1]);
    expect(byText.get("6/5 8/5")).toEqual([1, 3]);
    expect(new Set(generatePlays(opening, [3, 1]).map((p) => stateKey(p.result))).size).toBe(16);
  });
});

describe("tapping (Galaxy style)", () => {
  it("uses the higher die first, and the other one when the first does not work for that checker", () => {
    const e = startEntry(opening, [1, 3]);
    expect(e.order).toEqual([3, 1]);
    expect(tapGroup(e, 8)).toEqual({ steps: [{ from: 8, to: 5, hit: false }], dice: [3] });
    const swapped = swapDice(e);
    expect(swapped.order).toEqual([1, 3]);
    expect(tapGroup(swapped, 6)).toEqual({ steps: [{ from: 6, to: 5, hit: false }], dice: [1] });
    // 13/12 is blocked (White's midpoint), so a tap on 13 falls back to the 3.
    expect(tapGroup(swapped, 13)).toEqual({ steps: [{ from: 13, to: 10, hit: false }], dice: [3] });
    expect(tapGroup(e, 3)).toBeNull(); // no checker there
  });

  it("tracks the dice used, in tap order, and completes the play", () => {
    let e = startEntry(opening, [3, 1]);
    e = enter(e, tapGroup(e, 8)!);
    expect(diceUsage(e)).toEqual([true, false]);
    expect(remainingDice(e)).toEqual([1]);
    expect(tapGroup(e, 6)).toEqual({ steps: [{ from: 6, to: 5, hit: false }], dice: [1] });
    e = enter(e, tapGroup(e, 6)!);
    expect(isComplete(e)).toBe(true);
    expect(entryNotation(e)).toBe("8/5 6/5");
    expect(remainingDice(e)).toEqual([]);
    expect(movableFrom(e).size).toBe(0);
    expect(tapGroup(e, 13)).toBeNull();
    expect(entryNotation(undo(e))).toBe("8/5");
    expect(entryNotation(clear(e))).toBe("");
  });

  it("plays a double one die per tap", () => {
    let e = startEntry(opening, [4, 4]);
    expect(e.order).toEqual([4, 4, 4, 4]);
    expect(swapDice(e)).toBe(e);
    for (let i = 0; i < 4; i++) e = enter(e, tapGroup(e, 13)!);
    expect(diceUsage(e)).toEqual([true, true, true, true]);
    expect(entryNotation(e)).toBe("13/9(4)");
    expect(isComplete(e)).toBe(true);
  });

  it("bears off with a bigger die from the highest point, and a drop prefers the exact die", () => {
    const view = viewFromCounts({ mine: { 4: 1, 2: 1 }, theirs: { 24: 15 } });
    const e = startEntry(view, [6, 4]);
    expect(tapGroup(e, 4)).toEqual({ steps: [{ from: 4, to: 0, hit: false }], dice: [6] });
    expect(destinations(e, 4).get(0)).toEqual({ steps: [{ from: 4, to: 0, hit: false }], dice: [4] });
    const after = enter(e, tapGroup(e, 4)!);
    expect(tapGroup(after, 2)).toEqual({ steps: [{ from: 2, to: 0, hit: false }], dice: [4] });
  });
});

describe("dragging", () => {
  it("offers every landing point, one die or both", () => {
    const e = startEntry(opening, [3, 1]);
    expect([...movableFrom(e)].sort((a, b) => a - b)).toEqual([6, 8, 13, 24]);
    const from8 = destinations(e, 8);
    expect([...from8.keys()].sort((a, b) => a - b)).toEqual([4, 5, 7]);
    expect(from8.get(4)?.steps).toHaveLength(2);
    expect(from8.get(4)?.dice.slice().sort()).toEqual([1, 3]);
    const both = enter(e, from8.get(4)!);
    expect(isComplete(both)).toBe(true);
    expect(entryNotation(both)).toBe("8/4");
    expect(boardAfter(opening, both).points[4]).toBe(1);
  });

  it("goes round a blot rather than hitting it on the way", () => {
    // A checker on 13 with 6-1 and an opposing blot on 12: 13/7/6, not 13/12*/6.
    const view = viewFromCounts({ mine: { 13: 1, 6: 14 }, theirs: { 12: 1, 24: 14 } });
    const e = startEntry(view, [6, 1]);
    expect(destinations(e, 13).get(6)).toEqual({
      steps: [
        { from: 13, to: 7, hit: false },
        { from: 7, to: 6, hit: false },
      ],
      dice: [6, 1],
    });
    const hit = enter(e, destinations(e, 13).get(12)!);
    expect(boardAfter(view, hit).theirBar).toBe(1);
    expect(entryNotation(hit)).toBe("13/12*");
  });

  it("only allows the bar first, handles no legal move, and refuses what does not continue", () => {
    const view = viewFromCounts({ mine: { 6: 14 }, myBar: 1, theirs: { 19: 2, 20: 2, 21: 2, 22: 2, 23: 2, 18: 5 } });
    const e = startEntry(view, [6, 1]);
    expect([...movableFrom(e)]).toEqual([25]);
    expect(tapGroup(e, 25)).toEqual({ steps: [{ from: 25, to: 24, hit: false }], dice: [1] });
    const closed = viewFromCounts({ mine: { 6: 14 }, myBar: 1, theirs: { 19: 2, 20: 2, 21: 2, 22: 2, 23: 2, 24: 2, 18: 3 } });
    const none = startEntry(closed, [6, 1]);
    expect([none.length, isComplete(none), entryNotation(none)]).toEqual([0, true, ""]);
    expect(() => enter(e, { steps: [{ from: 6, to: 5, hit: false }], dice: [1] })).toThrow();
    expect(() => enter(e, { steps: [], dice: [] })).toThrow();
  });
});
