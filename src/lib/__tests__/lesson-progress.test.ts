import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearLessonLog,
  emptyLog,
  LESSONS_KEY,
  loadLessonLog,
  mistakeIndexes,
  recordAttempt,
  recordRunStart,
  sanitizeLog,
  setProgress,
  type LessonAttempt,
  type LessonLog,
} from "@/lib/lesson-progress";

const IDS = ["p1", "p2", "p3"];
const at = (minute: number) => new Date(Date.UTC(2026, 8, 11, 10, minute)).toISOString();

function attempt(problemId: string, correct: boolean, minute: number, over: Partial<LessonAttempt> = {}): LessonAttempt {
  return {
    setKey: "S",
    problemId,
    choiceId: `${problemId}-${correct ? "right" : "wrong"}`,
    correct,
    loss: correct ? 0 : 0.1,
    retry: false,
    at: at(minute),
    ...over,
  };
}

const log = (attempts: LessonAttempt[], runs: Record<string, string> = {}): LessonLog => ({ attempts, runs });

describe("lesson progress", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts empty", () => {
    const p = setProgress(emptyLog(), "S", IDS);
    expect(p).toMatchObject({ total: 3, answered: 0, correct: 0, wrong: 0, fixed: 0, next: 0, finished: false, runStartedAt: null });
    expect(p.statuses).toEqual([null, null, null]);
  });

  it("scores first answers; retries fix mistakes without raising the score", () => {
    const p = setProgress(
      log([
        attempt("p1", false, 1),
        attempt("p2", true, 2),
        attempt("p3", false, 3),
        attempt("p1", true, 4, { retry: true }),
        attempt("p3", true, 5, { retry: true }),
        attempt("p3", false, 6, { retry: true }), // the latest retry decides
      ]),
      "S",
      IDS,
    );
    expect(p.statuses).toEqual(["fixed", "correct", "wrong"]);
    expect(p).toMatchObject({ answered: 3, correct: 1, wrong: 1, fixed: 1, next: null, finished: true });
    expect(p.picks).toEqual(["p1-right", "p2-right", "p3-wrong"]);
    expect(mistakeIndexes(p)).toEqual([2]);
  });

  it("ignores other sets, unknown problems, a second first answer and a retry before any answer", () => {
    const p = setProgress(
      log([
        attempt("p1", true, 1, { setKey: "T" }),
        attempt("p9", true, 1),
        attempt("p2", true, 1, { retry: true }),
        attempt("p1", false, 2),
        attempt("p1", true, 3), // another tab answered again: the first answer counts
      ]),
      "S",
      IDS,
    );
    expect(p.statuses).toEqual(["wrong", null, null]);
    expect(p.next).toBe(1);
  });

  it("a new run hides the earlier answers", () => {
    const p = setProgress(log([attempt("p1", false, 1), attempt("p2", true, 2), attempt("p2", false, 11)], { S: at(10) }), "S", IDS);
    expect(p.statuses).toEqual([null, "wrong", null]);
    expect(p.runStartedAt).toBe(at(10));
  });

  it("sanitises whatever storage held", () => {
    expect(sanitizeLog(null)).toEqual(emptyLog());
    expect(sanitizeLog([1, 2])).toEqual(emptyLog());
    const good = attempt("p1", true, 1);
    const cleaned = sanitizeLog({ attempts: [good, { ...good, correct: "yes" }, 7], runs: { S: at(3), T: 5 } });
    expect(cleaned).toEqual({ attempts: [good], runs: { S: at(3) } });
  });

  it("saves to and loads from localStorage", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        removeItem: (k: string) => void data.delete(k),
      },
    });
    expect(loadLessonLog()).toEqual(emptyLog());
    let current = recordAttempt(emptyLog(), attempt("p1", true, 1));
    current = recordRunStart(current, "S", at(5));
    expect(loadLessonLog()).toEqual(current);
    expect(JSON.parse(data.get(LESSONS_KEY)!).runs).toEqual({ S: at(5) });
    data.set(LESSONS_KEY, "{not json");
    expect(loadLessonLog()).toEqual(emptyLog());
    expect(clearLessonLog()).toEqual(emptyLog());
    expect(data.has(LESSONS_KEY)).toBe(false);
  });

  it("keeps working in memory without storage", () => {
    expect(loadLessonLog()).toEqual(emptyLog());
    const next = recordAttempt(emptyLog(), attempt("p1", true, 1));
    expect(recordAttempt(next, attempt("p2", true, 2)).attempts).toHaveLength(2);
  });
});
