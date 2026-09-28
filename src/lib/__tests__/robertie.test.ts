import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { offeredAnswers } from "@/lib/problem-utils";
import { applyFilters, DEFAULT_FILTERS } from "@/lib/filters";
import {
  agreementOf,
  bookVerdict,
  chapterProgress,
  loadRuns,
  robertieImageSrc,
  robertieNumber,
  ROBERTIE_KEY,
  sanitizeRuns,
  startRun,
} from "@/lib/robertie";
import type { Attempt } from "@/lib/storage";
import type { Problem } from "@/types/problem";

const answers = [
  { id: "8/5 6/5", label: "8/5 6/5", equity: 0.2, equityLoss: 0 },
  { id: "24/23 13/10", label: "24/23 13/10", equity: 0.1, equityLoss: 0.1 },
  { id: "13/10 6/5", label: "13/10 6/5", equity: 0.15, equityLoss: 0.05 },
  { id: "24/21", label: "24/21", equity: 0.18, equityLoss: 0.02 },
  { id: "13/9", label: "13/9", equity: 0.19, equityLoss: 0.01 },
  { id: "24/20", label: "24/20", equity: 0.0, equityLoss: 0.2 },
].sort((a, b) => a.equityLoss - b.equityLoss);

function bookProblem(answerId: string, loss: number): Problem {
  return {
    id: "robertie-12",
    xgid: "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:0:10",
    type: "checker",
    answers,
    categories: ["opening"],
    explanation: "",
    source: "Robertie 501 #12",
    book: { number: 12, chapter: 5, chapterTitle: "The Opening", caption: "Problem 12: Black to play 31.", answerId, loss, agreement: agreementOf(loss), plies: 2 },
  };
}

describe("book problems", () => {
  it("reads problem numbers from quiz ids", () => {
    expect(robertieNumber("robertie-12")).toBe(12);
    expect(robertieNumber("robertie-501")).toBe(501);
    expect(robertieNumber("robertie-0")).toBeNull();
    expect(robertieNumber("robertie-502")).toBeNull();
    expect(robertieNumber("seed-001")).toBeNull();
  });

  it("marks gnubg's rating of the book's answer with the app's error and blunder lines", () => {
    expect([0, 0.0199, 0.02, 0.0799, 0.08].map(agreementOf)).toEqual(["same", "close", "differs", "differs", "blunder"]);
  });

  it("always offers the book's answer", () => {
    const p = bookProblem("24/20", 0.2);
    const offered = offeredAnswers(p);
    expect(offered).toHaveLength(4);
    expect(offered.map((a) => a.id)).toContain("24/20");
    expect(offered[0].id).toBe("8/5 6/5");
    expect(offeredAnswers(bookProblem("13/9", 0.01)).map((a) => a.id)).toEqual(answers.slice(0, 4).map((a) => a.id));
  });

  it("words the verdict after answering", () => {
    const same = bookProblem("8/5 6/5", 0);
    expect(bookVerdict(same, "8/5 6/5")).toBe("Robertie plays it too.");
    expect(bookVerdict(same, "24/21")).toBe("Robertie plays 8/5 6/5 too.");
    const differs = bookProblem("13/10 6/5", 0.05);
    expect(bookVerdict(differs, "13/10 6/5")).toBe("That is Robertie's answer, but gnubg prefers 8/5 6/5 (−0.050, 2-ply).");
    expect(bookVerdict(differs, "8/5 6/5")).toBe("Robertie's answer is 13/10 6/5 (−0.050 by gnubg, 2-ply).");
    expect(bookVerdict({ ...same, book: undefined }, "8/5 6/5")).toBeNull();
  });

  it("has its own source filter, and problem sets leave the book out", () => {
    const set: Problem = { ...bookProblem("8/5 6/5", 0), id: "seed-001", book: undefined, source: "handwritten" };
    const all = [set, bookProblem("8/5 6/5", 0)];
    expect(applyFilters(all, { ...DEFAULT_FILTERS, source: "book" }).map((p) => p.id)).toEqual(["robertie-12"]);
    expect(applyFilters(all, { ...DEFAULT_FILTERS, source: "sets" }).map((p) => p.id)).toEqual(["seed-001"]);
    expect(applyFilters(all, DEFAULT_FILTERS)).toHaveLength(2);
  });

  it("builds image URLs the image route serves", () => {
    expect(robertieImageSrc("diagram", "s003-L-1")).toBe("/api/robertie/images/diagram/s003-L-1.png");
    expect(robertieImageSrc("page", "s003-L", "abc")).toBe("/api/robertie/images/page/s003-L.jpg?v=abc");
  });
});

describe("chapter progress", () => {
  const ids = ["robertie-1", "robertie-2", "robertie-3"];
  const at = (m: number) => new Date(Date.UTC(2026, 8, 28, 10, m)).toISOString();
  const attempt = (problemId: string, correct: boolean, m: number, answerId = "x"): Attempt => ({ problemId, answerId, equityLoss: correct ? 0 : 0.05, correct, at: at(m) });

  it("counts the first answer of the run and marks a later right answer as fixed", () => {
    const log = [attempt("robertie-1", true, 1), attempt("robertie-2", false, 2, "a"), attempt("robertie-2", true, 3, "b"), attempt("robertie-3", false, 4), attempt("seed-001", true, 5)];
    const p = chapterProgress(log, ids, null);
    expect(p.statuses).toEqual(["correct", "fixed", "wrong"]);
    expect([p.answered, p.correct, p.wrong, p.fixed]).toEqual([3, 1, 1, 1]);
    expect(p.picks[1]).toBe("a");
  });

  it("ignores answers before the run started", () => {
    const log = [attempt("robertie-1", false, 1), attempt("robertie-1", true, 10)];
    expect(chapterProgress(log, ids, at(5)).statuses).toEqual(["correct", null, null]);
  });
});

describe("run markers in localStorage", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    };
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("saves a chapter's start and drops junk on load", () => {
    const runs = startRun(loadRuns(), 9, "2026-09-28T10:00:00.000Z");
    expect(runs.runs["9"]).toBe("2026-09-28T10:00:00.000Z");
    expect(JSON.parse(store.get(ROBERTIE_KEY)!)).toEqual({ runs: { "9": "2026-09-28T10:00:00.000Z" } });
    expect(sanitizeRuns({ runs: { "9": "not a date", x: "2026-09-28T10:00:00Z", "10": "2026-09-28T10:00:00Z" } })).toEqual({ runs: { "10": "2026-09-28T10:00:00Z" } });
    expect(sanitizeRuns(null)).toEqual({ runs: {} });
  });
});
