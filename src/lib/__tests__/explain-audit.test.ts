import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditExplanation } from "@/lib/explain-audit";
import type { Problem } from "@/types/problem";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const problems: Problem[] = JSON.parse(readFileSync(path.join(ROOT, "data", "problems.json"), "utf8")).problems;
const seedTexts: { id: string; explanation: string }[] = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures", "seed-explanations-v1.json"), "utf8"),
);
const byId = Object.fromEntries(problems.map((p) => [p.id, p]));

describe("auditExplanation", () => {
  it("accepts every number and move in the five v1 seed explanations", () => {
    expect(seedTexts).toHaveLength(5);
    for (const s of seedTexts) {
      expect(auditExplanation(byId[s.id], s.explanation), s.id).toEqual([]);
    }
  });

  it("flags invented losses, percentages, moves and pip counts", () => {
    const flagged = auditExplanation(byId["seed-001"], "Playing 13/8 loses 0.999, wins 42% of games and the race is 150 to 167.");
    expect(flagged).toEqual(["13/8", "0.999", "42%", "150"]);
  });

  it("accepts rounded and complementary percentages, differences and unicode minus", () => {
    // seed-003: win 0.759 -> 76% wins, 24% for White; seed-002: loss 0.0554 written as ‑0.055.
    expect(auditExplanation(byId["seed-003"], "about 76% wins, leaving White 24 %; 75.9% to be exact")).toEqual([]);
    expect(auditExplanation(byId["seed-002"], "24/21 13/7 (‑0.055) and 24/15 only 0.016 behind; 0.039 between them")).toEqual([]);
  });

  it("does not check points, checkers, dice, cube values or short scores", () => {
    expect(auditExplanation(byId["seed-005"], "the 5-point and 24-point, x2 checkers, a 6-6-5-5-4-4-2-1 spread, 5-2 in a 7-point match, cube at 32")).toEqual([]);
    expect(auditExplanation(byId["seed-002"], "With an opening 63, or 36 for that matter; 64 is not this roll")).toEqual([]);
    expect(auditExplanation(byId["seed-001"], "the 31 roll, unlike 65")).toEqual(["65"]);
  });

  it("checks every hop of a chained or doubled move", () => {
    expect(auditExplanation(byId["seed-004"], "bar/21*/18 and bar/21* 24/21")).toEqual([]);
    expect(auditExplanation(byId["seed-004"], "bar/21*/17, 13/8(2) and 8/5(2)")).toEqual(["bar/21*/17", "13/8(2)"]);
  });
});
