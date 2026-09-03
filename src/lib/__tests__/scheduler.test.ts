import { describe, expect, it } from "vitest";
import type { Problem } from "@/types/problem";
import { cardState, cardStates, categoryStats, dueCount, humanizeInterval, INTERVALS_MS, pickNext } from "@/lib/scheduler";
import type { Attempt } from "@/lib/storage";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = Date.parse("2026-09-03T10:00:00Z");

function problem(id: string, categories: Problem["categories"] = ["opening"]): Problem {
  return {
    id,
    xgid: "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10",
    type: "checker",
    categories,
    explanation: "",
    answers: [
      { id: "a", label: "a", equity: 0.5, equityLoss: 0 },
      { id: "b", label: "b", equity: 0.4, equityLoss: 0.1 },
    ],
  };
}

function attempt(problemId: string, correct: boolean, at: number, loss = correct ? 0 : 0.1): Attempt {
  return { problemId, answerId: correct ? "a" : "b", equityLoss: loss, correct, at: new Date(at).toISOString() };
}

describe("cardState", () => {
  it("is due immediately when never attempted", () => {
    expect(cardState("p", []).due).toBe(0);
  });

  it("comes back in 5 minutes after a wrong answer and grows with the streak", () => {
    expect(cardState("p", [attempt("p", false, T0)]).due).toBe(T0 + 5 * MIN);
    expect(cardState("p", [attempt("p", true, T0)]).due).toBe(T0 + DAY);
    const two = [attempt("p", true, T0 - DAY), attempt("p", true, T0)];
    expect(cardState("p", two)).toMatchObject({ streak: 2, correct: 2, attempts: 2, due: T0 + 3 * DAY });
    const lapse = [attempt("p", true, T0 - 2 * DAY), attempt("p", true, T0 - DAY), attempt("p", false, T0)];
    expect(cardState("p", lapse)).toMatchObject({ streak: 0, lastCorrect: false, due: T0 + 5 * MIN });
    const recovered = [...lapse, attempt("p", true, T0 + 10 * MIN)];
    expect(cardState("p", recovered).due).toBe(T0 + 10 * MIN + DAY);
    const many = Array.from({ length: 9 }, (_, i) => attempt("p", true, T0 + i * DAY));
    expect(cardState("p", many).due).toBe(T0 + 8 * DAY + INTERVALS_MS[INTERVALS_MS.length - 1]);
  });

  it("ignores attempts of other problems and unordered input", () => {
    const s = cardState("p", [attempt("q", false, T0), attempt("p", true, T0), attempt("p", false, T0 - DAY)]);
    expect(s).toMatchObject({ attempts: 2, correct: 1, streak: 1, due: T0 + DAY });
  });
});

describe("pickNext", () => {
  const P = [problem("new1"), problem("new2"), problem("again"), problem("review"), problem("later")];
  const attempts = [
    attempt("again", false, T0 - 10 * MIN),
    attempt("review", true, T0 - 2 * DAY),
    attempt("later", true, T0 - MIN),
  ];
  const states = cardStates(P, attempts);
  const rng = () => 0;

  it("prefers lapsed, then due reviews, then new problems", () => {
    expect(pickNext(P, states, { now: T0, rng })).toMatchObject({ problem: { id: "again" }, reason: "again" });
    expect(pickNext(P, states, { now: T0, rng, exclude: "again" })).toMatchObject({ problem: { id: "review" }, reason: "review" });
    const onlyNew = P.filter((p) => p.id.startsWith("new"));
    expect(pickNext(onlyNew, states, { now: T0, rng })).toMatchObject({ reason: "new" });
    expect(dueCount(P, states, T0)).toBe(4);
  });

  it("falls back to the soonest due problem when nothing is due", () => {
    const later = [problem("later"), problem("later2")];
    const st = cardStates(later, [attempt("later", true, T0 - MIN), attempt("later2", true, T0 - DAY + MIN)]);
    expect(pickNext(later, st, { now: T0, rng })).toMatchObject({ problem: { id: "later2" }, reason: "ahead" });
    expect(pickNext([], st, { now: T0 })).toBeNull();
  });

  it("does not repeat the excluded problem unless it is the only one", () => {
    const single = [problem("only")];
    expect(pickNext(single, cardStates(single, []), { now: T0, exclude: "only" })?.problem.id).toBe("only");
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(pickNext(P, states, { now: T0, exclude: "again" })!.problem.id);
    expect(seen.has("again")).toBe(false);
  });
});

describe("categoryStats", () => {
  it("aggregates per category, counting an attempt for every category of its problem", () => {
    const P = [problem("a", ["opening"]), problem("b", ["early-game", "hit-or-not"]), problem("c", ["hit-or-not"])];
    const attempts = [attempt("b", true, T0 - DAY), attempt("b", false, T0, 0.2), attempt("c", true, T0), attempt("gone", false, T0)];
    const rows = categoryStats(P, attempts, T0);
    expect(rows.map((r) => r.category)).toEqual(["opening", "early-game", "hit-or-not"]);
    expect(rows[0]).toMatchObject({ total: 1, due: 1, attempts: 0, correct: 0, avgLoss: 0 });
    expect(rows[1]).toMatchObject({ total: 1, due: 0, attempts: 2, correct: 1 });
    expect(rows[1].avgLoss).toBeCloseTo(0.1);
    expect(rows[2]).toMatchObject({ total: 2, due: 0, attempts: 3, correct: 2 });
  });
});

describe("humanizeInterval", () => {
  it("formats minutes, hours and days", () => {
    expect(humanizeInterval(5 * MIN)).toBe("5 min");
    expect(humanizeInterval(3 * 60 * MIN)).toBe("3 h");
    expect(humanizeInterval(DAY)).toBe("1 day");
    expect(humanizeInterval(7 * DAY)).toBe("7 days");
    expect(humanizeInterval(10_000)).toBe("less than a minute");
  });
});
