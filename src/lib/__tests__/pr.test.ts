import { describe, expect, it } from "vitest";
import { THRESHOLDS } from "@/lib/matches";
import { cubeEquities, isCounted, PR_THRESHOLDS, ratePlayer, ratingWord, type RatedDecision } from "@/lib/pr";
import type { Answer } from "@/types/problem";

function cubeAnswers(nd: number, dt: number, dp: number): Answer[] {
  return [
    { id: "no-double", label: "No double, take", equity: nd, equityLoss: 0 },
    { id: "double-take", label: "Double, take", equity: dt, equityLoss: 0 },
    { id: "double-pass", label: "Double, pass", equity: dp, equityLoss: 0 },
    { id: "too-good", label: "No double, pass (too good)", equity: nd, equityLoss: 0 },
  ];
}

const checker = (player: number, loss: number | null, forced = false): RatedDecision => ({ player, kind: "checker", played: "13/9", forced, loss, answers: [] });
const noDouble = (loss: number, nd: number, dt: number, dp = 1): RatedDecision => ({
  player: 1,
  kind: "cube",
  played: "no-double",
  forced: false,
  loss,
  answers: cubeAnswers(nd, dt, dp),
});

describe("which decisions count", () => {
  it("counts checker plays with a choice, doubles, takes and passes", () => {
    expect(isCounted(checker(1, 0))).toBe(true);
    expect(isCounted(checker(1, 0, true))).toBe(false);
    expect(isCounted(checker(1, null))).toBe(false);
    expect(isCounted({ ...noDouble(0, 0.1, -0.17), played: "double", loss: 0.27 })).toBe(true);
    expect(isCounted({ player: 1, kind: "take", played: "take", forced: false, loss: 0, answers: [] })).toBe(true);
  });

  it("counts a no-double only when doubling was close or right", () => {
    expect(isCounted(noDouble(0, 0.105, -0.171))).toBe(false); // the opening: doubling loses 0.276
    expect(isCounted(noDouble(0, 0.514, 0.478))).toBe(true); // a race just short of a double
    expect(isCounted(noDouble(0.04, 0.752, 0.792))).toBe(true); // a missed double
    expect(isCounted(noDouble(0, 1.1, 1.3))).toBe(true); // too good by a little
    expect(isCounted(noDouble(0, 1.5, 1.8))).toBe(false); // far too good
    expect(isCounted({ ...noDouble(0, 0.5, 0.4), answers: [] })).toBe(false);
  });

  it("reads the cube equities from the answers", () => {
    expect(cubeEquities(cubeAnswers(0.5, 0.4, 1))).toEqual({ nd: 0.5, dt: 0.4, dp: 1 });
    expect(cubeEquities([])).toBeNull();
  });
});

describe("ratePlayer", () => {
  it("is 500 times the loss per counted decision, split into checker and cube", () => {
    const decisions: RatedDecision[] = [
      checker(1, 0),
      checker(1, 0.05),
      checker(1, 0.1),
      checker(1, 0, true),
      noDouble(0.04, 0.752, 0.792),
      noDouble(0, 0.105, -0.171),
      checker(2, 0),
      checker(2, 0),
    ];
    const r = ratePlayer(decisions, 1);
    expect(r.decisions).toBe(4);
    expect([r.checkerDecisions, r.cubeDecisions]).toEqual([3, 1]);
    expect(r.totalLoss).toBeCloseTo(0.19, 6);
    expect(r.pr).toBe(23.8);
    expect(r.checkerPr).toBe(25);
    expect(r.cubePr).toBe(20);
    expect([r.errors, r.blunders]).toEqual([3, 1]);
    expect(r.rating).toBe("Awful");
    const g = ratePlayer(decisions, 2);
    expect([g.decisions, g.pr, g.rating]).toEqual([2, 0, "Supernatural"]);
    expect(ratePlayer([], 1)).toMatchObject({ decisions: 0, pr: null, checkerPr: null, cubePr: null, rating: null });
  });

  it("uses gnubg's rating words", () => {
    const cases: [number, string][] = [
      [0.9, "Supernatural"],
      [1, "World class"],
      [2.4, "World class"],
      [2.5, "Expert"],
      [5.9, "Advanced"],
      [8.9, "Intermediate"],
      [12.9, "Casual player"],
      [17.4, "Beginner"],
      [17.5, "Awful"],
    ];
    for (const [pr, word] of cases) expect(ratingWord(pr), String(pr)).toBe(word);
  });

  it("keeps its error thresholds in step with the match review", () => {
    expect(PR_THRESHOLDS).toEqual(THRESHOLDS);
  });
});
