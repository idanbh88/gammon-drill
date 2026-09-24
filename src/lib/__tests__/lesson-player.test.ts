import { describe, expect, it } from "vitest";
import { currentIndex, initialPlayer, playerReducer, type PlayerAction, type PlayerState } from "@/lib/lesson-player";

const run = (s: PlayerState, ...actions: PlayerAction[]) => actions.reduce(playerReducer, s);

describe("lesson player", () => {
  it("resumes at the unanswered problems, or opens on the summary", () => {
    const s = initialPlayer([null, "correct", null]);
    expect(s).toEqual({ mode: "run", queue: [0, 2], review: null, picked: null, view: null });
    expect(currentIndex(s)).toBe(0);
    const done = initialPlayer(["correct", "wrong"]);
    expect(done.mode).toBe("summary");
    expect(currentIndex(done)).toBeNull();
  });

  it("answers once, then moves on to the summary", () => {
    let s = initialPlayer([null, null]);
    expect(playerReducer(s, { type: "next" })).toBe(s); // not answered yet
    s = run(s, { type: "answer", choiceId: "a", view: "a" });
    expect(s).toMatchObject({ picked: "a", view: "a" });
    expect(playerReducer(s, { type: "answer", choiceId: "b", view: null })).toBe(s);
    s = run(s, { type: "show", choiceId: null }, { type: "next" });
    expect(s).toMatchObject({ queue: [1], picked: null, view: null });
    s = run(s, { type: "answer", choiceId: "c", view: null }, { type: "next" });
    expect(s.mode).toBe("summary");
  });

  it("reviews an answered problem without recording anything", () => {
    let s = run(initialPlayer([null, "correct", null]), { type: "answer", choiceId: "a", view: null });
    s = run(s, { type: "open", index: 1, answered: true });
    expect(currentIndex(s)).toBe(1);
    expect(playerReducer(s, { type: "answer", choiceId: "x", view: null })).toBe(s);
    s = run(s, { type: "close" });
    expect(currentIndex(s)).toBe(0);
    expect(s.picked).toBe("a");
    expect(run(s, { type: "open", index: 1, answered: true }, { type: "next" })).toEqual(s); // next leaves the review
  });

  it("jumps to an unanswered problem, dropping a current one that is answered", () => {
    const fresh = initialPlayer([null, null, null]);
    expect(run(fresh, { type: "open", index: 2, answered: false }).queue).toEqual([2, 0, 1]);
    const answered = run(fresh, { type: "answer", choiceId: "a", view: null }, { type: "open", index: 2, answered: false });
    expect(answered).toEqual({ mode: "run", queue: [2, 1], review: null, picked: null, view: null });
  });

  it("retries mistakes and starts over", () => {
    const summary = initialPlayer(["wrong", "correct", "wrong"]);
    const retry = run(summary, { type: "retry", indexes: [0, 2] });
    expect(retry).toMatchObject({ mode: "retry", queue: [0, 2] });
    expect(playerReducer(summary, { type: "retry", indexes: [] })).toBe(summary);
    const end = run(retry, { type: "answer", choiceId: "a", view: null }, { type: "next" }, { type: "answer", choiceId: "b", view: null }, { type: "next" });
    expect(end.mode).toBe("summary");
    expect(run(end, { type: "restart", total: 3 })).toMatchObject({ mode: "run", queue: [0, 1, 2] });
    expect(run(end, { type: "restart", total: 0 }).mode).toBe("summary");
  });
});
