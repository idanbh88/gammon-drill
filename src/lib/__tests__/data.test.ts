import { describe, expect, it } from "vitest";
import { checkersOnBoard } from "@/lib/board";
import { difficulty, loadProblemSets } from "@/lib/problems";
import { validateProblem } from "@/lib/validate";
import { parseXgid } from "@/lib/xgid";

describe("data/*.json", () => {
  it("loads, validates and has unique ids", async () => {
    const sets = await loadProblemSets();
    expect(sets.length).toBeGreaterThanOrEqual(1);
    const ids = new Set<string>();
    for (const set of sets) {
      for (const p of set.problems) {
        expect(validateProblem(p), `${set.name}/${p.id}`).toEqual([]);
        expect(ids.has(p.id), `duplicate ${p.id}`).toBe(false);
        ids.add(p.id);
        expect(p.categories.length).toBeGreaterThan(0);
        expect(difficulty(p)).toBeGreaterThan(0);
      }
    }
  });

  it("ships the five seed problems", async () => {
    const sets = await loadProblemSets();
    const seed = sets.find((s) => s.name === "seed");
    expect(seed).toBeDefined();
    expect(seed!.problems.map((p) => p.id)).toEqual(["seed-001", "seed-002", "seed-003", "seed-004", "seed-005"]);
    // 15 checkers per side: all on the board except the bear-off problem (5 off each)
    for (const p of seed!.problems) {
      const onBoard = checkersOnBoard(parseXgid(p.xgid));
      expect(onBoard, p.id).toEqual(p.id === "seed-005" ? [10, 10] : [15, 15]);
    }
  });

  it("overlays generated explanations from data/store.sqlite", async () => {
    const problems = (await loadProblemSets()).flatMap((s) => s.problems);
    const withText = problems.filter((p) => p.explanation);
    expect(withText.map((p) => p.id)).toEqual(expect.arrayContaining(["seed-001", "seed-002", "seed-003", "seed-004", "seed-005"]));
    for (const p of withText) {
      expect(p.explanationMeta?.model, p.id).toBeTruthy();
      expect(p.explanationMeta?.generatedAt, p.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("validateProblem", () => {
  const base = {
    id: "t",
    xgid: "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10",
    type: "checker" as const,
    categories: ["opening" as const],
    explanation: "",
    answers: [
      { id: "8/5 6/5", label: "8/5 6/5", equity: 0.1, equityLoss: 0 },
      { id: "24/23 13/10", label: "24/23 13/10", equity: 0, equityLoss: 0.1 },
    ],
  };

  it("accepts a good problem", () => {
    expect(validateProblem(base)).toEqual([]);
  });

  it("flags illegal plays, bad ranking and type mismatches", () => {
    expect(validateProblem({ ...base, answers: [base.answers[0], { ...base.answers[1], id: "13/9 6/5" }] })).toEqual([
      "illegal or malformed play: 13/9 6/5",
    ]);
    expect(validateProblem({ ...base, answers: [{ ...base.answers[0], equityLoss: 0.2 }, base.answers[1]] })).toContain(
      "best answer must have equityLoss 0",
    );
    expect(validateProblem({ ...base, type: "cube" })[0]).toMatch(/type is cube/);
    expect(
      validateProblem({
        ...base,
        xgid: "-b----E-C---eE---c-e----B-:0:0:1:00:0:0:0:7:10",
        type: "cube",
        answers: [
          { id: "double-take", label: "Double, take", equity: 0.5, equityLoss: 0 },
          { id: "take", label: "Take", equity: 0.4, equityLoss: 0.1 },
        ],
      })[0],
    ).toMatch(/cube answer id take/);
  });
});
