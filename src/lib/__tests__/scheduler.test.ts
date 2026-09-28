import { describe, expect, it } from "vitest";
import type { Problem } from "@/types/problem";
import {
  addedRank,
  cardState,
  cardStates,
  categoryStats,
  dueCount,
  humanizeInterval,
  INTERVALS_MS,
  markSeen,
  pickNext,
  stateReason,
} from "@/lib/scheduler";
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

  it("puts never-answered problems first when asked", () => {
    const newFirst = { newFirst: true, random: false };
    expect(pickNext(P, states, { now: T0, rng, order: newFirst })).toMatchObject({ problem: { id: "new1" }, reason: "new" });
    expect(pickNext(P, states, { now: T0, rng: () => 0.99, order: newFirst })?.problem.id).toBe("new1"); // in the order given
    expect(pickNext(P, states, { now: T0, order: newFirst, exclude: "new1" })?.problem.id).toBe("new2");
    const seenAll = P.filter((p) => !p.id.startsWith("new"));
    expect(pickNext(seenAll, states, { now: T0, rng, order: newFirst })).toMatchObject({ problem: { id: "again" }, reason: "again" });
  });

  it("serves the match added last first, in game order, then older matches, then the problem sets", () => {
    const mistake = (id: string, matchId: number): Problem => ({
      ...problem(id),
      origin: { site: "BackgammonGalaxy", matchId, opponent: "x", playedAt: null, played: "b", loss: 0.1 },
    });
    // as the loader lists them: problem sets, then matches newest first, game order within
    const pool = [problem("set1"), problem("set2"), mistake("m7-g1", 7), mistake("m7-g2", 7), mistake("m5-g1", 5), mistake("again", 9)];
    expect(pool.map(addedRank)).toEqual([-1, -1, 7, 7, 5, 9]);
    const st = cardStates(pool, [attempt("again", false, T0 - 10 * MIN)]);
    const newFirst = { newFirst: true, random: false };
    const order: string[] = [];
    let attempts: Attempt[] = [attempt("again", false, T0 - 10 * MIN)];
    for (let i = 0; i < 5; i++) {
      const next = pickNext(pool, cardStates(pool, attempts), { now: T0, rng: () => 0.99, order: newFirst })!;
      expect(next.reason).toBe("new");
      order.push(next.problem.id);
      attempts = [...attempts, attempt(next.problem.id, true, T0)];
    }
    expect(order).toEqual(["m7-g1", "m7-g2", "m5-g1", "set1", "set2"]);
    // match 9 is newer but was answered already: not "new"
    expect(pickNext(pool, st, { now: T0, rng, order: newFirst })?.problem.id).toBe("m7-g1");
    // with Random too: the newest match still comes first, shuffled within it
    const both = { newFirst: true, random: true };
    const firsts = new Set<string>();
    for (let i = 0; i < 40; i++) firsts.add(pickNext(pool, st, { now: T0, order: both })!.problem.id);
    expect([...firsts].sort()).toEqual(["m7-g1", "m7-g2"]);
  });

  it("deals every problem once in a random order before any comes back", () => {
    const random = { newFirst: false, random: true };
    let seen: Set<string> = new Set();
    let last: string | null = null;
    const dealt: string[] = [];
    for (let i = 0; i < 3 * P.length; i++) {
      const id: string = pickNext(P, states, { now: T0, order: random, seen, exclude: last })!.problem.id;
      seen = markSeen(seen, P, id);
      last = id;
      dealt.push(id);
    }
    for (let round = 0; round < 3; round++) {
      expect(new Set(dealt.slice(round * P.length, (round + 1) * P.length)).size).toBe(P.length);
    }
    expect(dealt.every((id, i) => i === 0 || id !== dealt[i - 1])).toBe(true);
    // due or not: "later" (not due for a day) is dealt too, and says so
    const later = pickNext([problem("later")], states, { now: T0, order: random });
    expect(later).toMatchObject({ problem: { id: "later" }, reason: "ahead" });
  });

  it("combines new first with a random order", () => {
    const both = { newFirst: true, random: true };
    expect(pickNext(P, states, { now: T0, rng, order: both })?.reason).toBe("new");
    const newOnes = new Set<string>();
    for (let i = 0; i < 40; i++) newOnes.add(pickNext(P, states, { now: T0, order: both })!.problem.id);
    expect([...newOnes].sort()).toEqual(["new1", "new2"]); // problem sets: shuffled too
    const seenAll = P.filter((p) => !p.id.startsWith("new"));
    const picked = new Set<string>();
    for (let i = 0; i < 60; i++) picked.add(pickNext(seenAll, states, { now: T0, order: both })!.problem.id);
    expect([...picked].sort()).toEqual(["again", "later", "review"]);
  });

  it("names a problem's state", () => {
    expect(stateReason(states.get("new1")!, T0)).toBe("new");
    expect(stateReason(states.get("again")!, T0)).toBe("again");
    expect(stateReason(states.get("review")!, T0)).toBe("review");
    expect(stateReason(states.get("later")!, T0)).toBe("ahead");
  });

  it("starts a new round once the whole pool was dealt", () => {
    const pool = [problem("a"), problem("b")];
    expect([...markSeen(new Set(), pool, "a")]).toEqual(["a"]);
    expect([...markSeen(new Set(["a"]), pool, "b")].sort()).toEqual(["a", "b"]);
    expect([...markSeen(new Set(["a", "b"]), pool, "a")]).toEqual(["a"]);
    expect([...markSeen(new Set(["a", "gone"]), pool, "b")].sort()).toEqual(["a", "b", "gone"]);
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
