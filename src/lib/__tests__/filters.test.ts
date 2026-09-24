import { describe, expect, it } from "vitest";
import type { Problem } from "@/types/problem";
import { applyFilters, categoryCounts, DEFAULT_FILTERS, difficultyBand, FILTERS_KEY, FILTERS_KEY_V1, isDefaultFilters, loadFilters } from "@/lib/filters";

function problem(id: string, type: Problem["type"], gap: number, categories: Problem["categories"]): Problem {
  return {
    id,
    xgid: "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10",
    type,
    categories,
    explanation: "",
    answers: [
      { id: "a", label: "a", equity: 0.5, equityLoss: 0 },
      { id: "b", label: "b", equity: 0.5 - gap, equityLoss: gap },
    ],
  };
}

const P = [
  problem("p1", "checker", 0.01, ["opening"]),
  problem("p2", "checker", 0.05, ["early-game", "hit-or-not"]),
  problem("p3", "cube", 0.2, ["racing-cube"]),
  problem("p4", "cube", 0.03, ["contact-cube", "holding-game"]),
];

describe("difficultyBand", () => {
  it("bands by the gap between the top two answers", () => {
    expect(P.map(difficultyBand)).toEqual(["hard", "medium", "easy", "medium"]);
  });
});

describe("applyFilters", () => {
  it("matches everything by default", () => {
    expect(applyFilters(P, DEFAULT_FILTERS)).toHaveLength(4);
    expect(isDefaultFilters(DEFAULT_FILTERS)).toBe(true);
  });

  it("filters by type, category (any of) and difficulty", () => {
    expect(applyFilters(P, { ...DEFAULT_FILTERS, type: "cube" }).map((p) => p.id)).toEqual(["p3", "p4"]);
    expect(applyFilters(P, { ...DEFAULT_FILTERS, categories: ["hit-or-not", "racing-cube"] }).map((p) => p.id)).toEqual(["p2", "p3"]);
    expect(applyFilters(P, { ...DEFAULT_FILTERS, difficulty: ["hard", "medium"] }).map((p) => p.id)).toEqual(["p1", "p2", "p4"]);
    expect(applyFilters(P, { categories: ["holding-game"], type: "checker", difficulty: [], source: "all" })).toEqual([]);
  });

  it("filters by source: the problem sets or the user's own mistakes", () => {
    const mine = { ...P[0], id: "m1", origin: { site: "gnubg", matchId: 1, opponent: "gnubg", playedAt: null, played: "x", loss: 0.1 } };
    const all = [...P, mine];
    expect(applyFilters(all, { ...DEFAULT_FILTERS, source: "mistakes" }).map((p) => p.id)).toEqual(["m1"]);
    expect(applyFilters(all, { ...DEFAULT_FILTERS, source: "sets" })).toHaveLength(P.length);
    expect(applyFilters(all, DEFAULT_FILTERS)).toHaveLength(P.length + 1);
    expect(isDefaultFilters({ ...DEFAULT_FILTERS, source: "mistakes" })).toBe(false);
  });

  it("carries filters saved under the v1 key over to v2", () => {
    const saved = new Map<string, string>([[FILTERS_KEY_V1, JSON.stringify({ categories: ["blitz"], type: "cube", difficulty: ["hard"] })]]);
    const g = globalThis as { window?: unknown };
    g.window = { localStorage: { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) } };
    try {
      expect(loadFilters()).toEqual({ categories: ["blitz"], type: "cube", difficulty: ["hard"], source: "all" });
      expect(JSON.parse(saved.get(FILTERS_KEY)!)).toMatchObject({ categories: ["blitz"], source: "all" });
      saved.set(FILTERS_KEY, JSON.stringify({ ...DEFAULT_FILTERS, source: "mistakes" }));
      expect(loadFilters().source).toBe("mistakes");
    } finally {
      delete g.window;
    }
  });

  it("counts problems per category", () => {
    const counts = categoryCounts(P);
    expect(counts.opening).toBe(1);
    expect(counts["hit-or-not"]).toBe(1);
    expect(counts.blitz).toBe(0);
  });

  it("falls back to defaults without a browser", () => {
    expect(loadFilters()).toEqual(DEFAULT_FILTERS);
  });
});
