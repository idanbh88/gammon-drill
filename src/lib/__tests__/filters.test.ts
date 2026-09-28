import { describe, expect, it } from "vitest";
import type { Problem } from "@/types/problem";
import {
  applyFilters,
  attemptedIds,
  categoryCounts,
  DEFAULT_FILTERS,
  difficultyBand,
  FILTERS_KEY,
  FILTERS_KEY_V1,
  FILTERS_KEY_V2,
  FILTERS_KEY_V3,
  isDefaultFilters,
  loadFilters,
  mistakeSize,
  onlySize,
} from "@/lib/filters";

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
    expect(applyFilters(P, { categories: ["holding-game"], type: "checker", difficulty: [], source: "all", mistakeSize: [], progress: "all" })).toEqual([]);
  });

  it("filters by source: the problem sets or the user's own mistakes", () => {
    const mine = { ...P[0], id: "m1", origin: { site: "gnubg", matchId: 1, opponent: "gnubg", playedAt: null, played: "x", loss: 0.1 } };
    const all = [...P, mine];
    expect(applyFilters(all, { ...DEFAULT_FILTERS, source: "mistakes" }).map((p) => p.id)).toEqual(["m1"]);
    expect(applyFilters(all, { ...DEFAULT_FILTERS, source: "sets" })).toHaveLength(P.length);
    expect(applyFilters(all, DEFAULT_FILTERS)).toHaveLength(P.length + 1);
    expect(isDefaultFilters({ ...DEFAULT_FILTERS, source: "mistakes" })).toBe(false);
  });

  it("filters the user's own mistakes by size: errors (0.02 to 0.08) and blunders (0.08 or more)", () => {
    const origin = { site: "gnubg", matchId: 1, opponent: "gnubg", playedAt: null, played: "x" };
    const mistake = (id: string, loss: number): Problem => ({ ...P[0], id, origin: { ...origin, loss } });
    const all = [...P, mistake("small", 0.01), mistake("error", 0.02), mistake("error2", 0.079), mistake("blunder", 0.08), mistake("blunder2", 0.5)];
    expect(all.map(mistakeSize)).toEqual([null, null, null, null, null, "error", "error", "blunder", "blunder"]);
    const ids = (f: Partial<typeof DEFAULT_FILTERS>) => applyFilters(all, { ...DEFAULT_FILTERS, ...f }).map((p) => p.id);
    expect(ids({ mistakeSize: ["error"] })).toEqual(["error", "error2"]);
    expect(ids({ mistakeSize: ["blunder"] })).toEqual(["blunder", "blunder2"]);
    expect(ids({ mistakeSize: ["error", "blunder"] })).toEqual(["error", "error2", "blunder", "blunder2"]);
    expect(ids({ mistakeSize: ["blunder"], source: "sets" })).toEqual([]);
    expect(ids({})).toHaveLength(all.length);
    expect(isDefaultFilters({ ...DEFAULT_FILTERS, mistakeSize: ["blunder"] })).toBe(false);
    expect(onlySize({ ...DEFAULT_FILTERS, mistakeSize: ["blunder"] })).toBe("blunder");
    expect(onlySize(DEFAULT_FILTERS)).toBeNull();
  });

  it("leaves out the problems already answered when asked", () => {
    const attempted = attemptedIds([{ problemId: "p2" }, { problemId: "p2" }, { problemId: "p4" }, { problemId: "gone" }]);
    expect([...attempted].sort()).toEqual(["gone", "p2", "p4"]);
    const untried = { ...DEFAULT_FILTERS, progress: "untried" as const };
    expect(applyFilters(P, untried, attempted).map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(applyFilters(P, DEFAULT_FILTERS, attempted)).toHaveLength(4);
    expect(applyFilters(P, untried)).toHaveLength(4); // nothing answered yet
    expect(applyFilters(P, { ...untried, type: "cube" }, attempted).map((p) => p.id)).toEqual(["p3"]);
    expect(isDefaultFilters(untried)).toBe(false);
  });

  function withStorage(saved: Map<string, string>, run: () => void) {
    const g = globalThis as { window?: unknown };
    g.window = { localStorage: { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) } };
    try {
      run();
    } finally {
      delete g.window;
    }
  }

  it("carries filters saved under the v3 key over to v4", () => {
    const saved = new Map<string, string>([
      [FILTERS_KEY_V3, JSON.stringify({ categories: [], type: "all", difficulty: [], source: "mistakes", mistakeSize: ["blunder"] })],
      [FILTERS_KEY_V2, JSON.stringify({ categories: ["blitz"], type: "cube", difficulty: [], source: "all" })],
    ]);
    withStorage(saved, () => {
      expect(loadFilters()).toEqual({ ...DEFAULT_FILTERS, source: "mistakes", mistakeSize: ["blunder"] });
      expect(JSON.parse(saved.get(FILTERS_KEY)!)).toMatchObject({ source: "mistakes", mistakeSize: ["blunder"], progress: "all" });
      saved.set(FILTERS_KEY, JSON.stringify({ ...DEFAULT_FILTERS, progress: "untried" }));
      expect(loadFilters().progress).toBe("untried");
      saved.set(FILTERS_KEY, JSON.stringify({ ...DEFAULT_FILTERS, progress: "bogus" }));
      expect(loadFilters().progress).toBe("all");
    });
  });

  it("carries filters saved under the v1 key over to v4", () => {
    const saved = new Map<string, string>([[FILTERS_KEY_V1, JSON.stringify({ categories: ["blitz"], type: "cube", difficulty: ["hard"] })]]);
    withStorage(saved, () => {
      expect(loadFilters()).toEqual({ categories: ["blitz"], type: "cube", difficulty: ["hard"], source: "all", mistakeSize: [], progress: "all" });
      expect(JSON.parse(saved.get(FILTERS_KEY)!)).toMatchObject({ categories: ["blitz"], source: "all", mistakeSize: [] });
      saved.set(FILTERS_KEY, JSON.stringify({ ...DEFAULT_FILTERS, source: "mistakes", mistakeSize: ["blunder", "nonsense"] }));
      expect(loadFilters()).toMatchObject({ source: "mistakes", mistakeSize: ["blunder"] });
      saved.set(FILTERS_KEY, JSON.stringify({ ...DEFAULT_FILTERS, mistakeSize: ["error", "blunder"] }));
      expect(loadFilters().mistakeSize).toEqual([]); // one size at a time; a pair loads as all
    });
  });

  it("carries filters saved under the v2 key over to v4, before v1", () => {
    const saved = new Map<string, string>([
      [FILTERS_KEY_V2, JSON.stringify({ categories: [], type: "all", difficulty: [], source: "mistakes" })],
      [FILTERS_KEY_V1, JSON.stringify({ categories: ["blitz"], type: "cube", difficulty: [] })],
    ]);
    withStorage(saved, () => {
      expect(loadFilters()).toEqual({ ...DEFAULT_FILTERS, source: "mistakes" });
      expect(JSON.parse(saved.get(FILTERS_KEY)!)).toEqual({ ...DEFAULT_FILTERS, source: "mistakes" });
    });
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
