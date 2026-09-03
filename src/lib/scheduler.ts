/**
 * Spaced repetition over the attempt log. A wrong answer brings a problem back after a few
 * minutes; each consecutive correct answer pushes it further out. Everything is derived from
 * the attempts in localStorage, nothing else is stored.
 */
import { CATEGORIES, type Category, type Problem } from "@/types/problem";
import type { Attempt } from "./storage";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * Time until a problem is due again, indexed by the number of consecutive correct answers.
 * A wrong answer uses the first entry.
 */
export const INTERVALS_MS = [5 * MINUTE, DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY] as const;

export interface CardState {
  problemId: string;
  attempts: number;
  correct: number;
  /** Consecutive correct answers at the end of the history. */
  streak: number;
  /** Epoch ms of the last attempt, null when never attempted. */
  lastAt: number | null;
  lastCorrect: boolean | null;
  /** Epoch ms; 0 for never-attempted problems (due immediately). */
  due: number;
}

function when(a: Attempt): number {
  const t = Date.parse(a.at);
  return Number.isFinite(t) ? t : 0;
}

/** State for one problem from its attempts (any order). */
export function cardState(problemId: string, attempts: readonly Attempt[]): CardState {
  const mine = attempts
    .filter((a) => a.problemId === problemId)
    .slice()
    .sort((a, b) => when(a) - when(b));
  let streak = 0;
  let correct = 0;
  for (const a of mine) {
    if (a.correct) {
      streak++;
      correct++;
    } else {
      streak = 0;
    }
  }
  const last = mine[mine.length - 1];
  if (!last) return { problemId, attempts: 0, correct: 0, streak: 0, lastAt: null, lastCorrect: null, due: 0 };
  const lastAt = when(last);
  const interval = last.correct ? INTERVALS_MS[Math.min(streak, INTERVALS_MS.length - 1)] : INTERVALS_MS[0];
  return { problemId, attempts: mine.length, correct, streak, lastAt, lastCorrect: last.correct, due: lastAt + interval };
}

export function cardStates(problems: readonly Problem[], attempts: readonly Attempt[]): Map<string, CardState> {
  const byId = new Map<string, Attempt[]>();
  for (const a of attempts) {
    const list = byId.get(a.problemId);
    if (list) list.push(a);
    else byId.set(a.problemId, [a]);
  }
  return new Map(problems.map((p) => [p.id, cardState(p.id, byId.get(p.id) ?? [])]));
}

export function dueCount(problems: readonly Problem[], states: Map<string, CardState>, now = Date.now()): number {
  let n = 0;
  for (const p of problems) if ((states.get(p.id)?.due ?? 0) <= now) n++;
  return n;
}

/** Why a problem was chosen: answered wrong last time, a scheduled review, never seen, or nothing is due. */
export type PickReason = "again" | "review" | "new" | "ahead";

export interface Pick {
  problem: Problem;
  reason: PickReason;
  due: number;
}

/**
 * Choose the next problem: lapsed ones first, then due reviews (most overdue first), then
 * new ones; when nothing is due, the one due soonest. `exclude` avoids an immediate repeat.
 */
export function pickNext(
  problems: readonly Problem[],
  states: Map<string, CardState>,
  opts: { now?: number; exclude?: string | null; rng?: () => number } = {},
): Pick | null {
  const now = opts.now ?? Date.now();
  const rng = opts.rng ?? Math.random;
  let pool = problems;
  if (opts.exclude && pool.length > 1) pool = pool.filter((p) => p.id !== opts.exclude);
  if (pool.length === 0) return null;

  const entries = pool.map((p) => ({ p, s: states.get(p.id) ?? cardState(p.id, []) }));
  const choose = (list: typeof entries, reason: PickReason, spread: number): Pick => {
    const sorted = list.slice().sort((a, b) => a.s.due - b.s.due);
    const e = sorted[Math.floor(rng() * Math.min(spread, sorted.length))];
    return { problem: e.p, reason, due: e.s.due };
  };

  const again = entries.filter((e) => e.s.attempts > 0 && e.s.lastCorrect === false && e.s.due <= now);
  if (again.length) return choose(again, "again", 3);
  const review = entries.filter((e) => e.s.attempts > 0 && e.s.lastCorrect === true && e.s.due <= now);
  if (review.length) return choose(review, "review", 3);
  const fresh = entries.filter((e) => e.s.attempts === 0);
  if (fresh.length) return choose(fresh, "new", fresh.length);
  return choose(entries, "ahead", 1);
}

export function humanizeInterval(ms: number): string {
  if (ms < MINUTE) return "less than a minute";
  if (ms < 60 * MINUTE) return `${Math.round(ms / MINUTE)} min`;
  if (ms < DAY) return `${Math.round(ms / (60 * MINUTE))} h`;
  const days = Math.round(ms / DAY);
  return days === 1 ? "1 day" : `${days} days`;
}

export interface CategoryStat {
  category: Category;
  /** Problems carrying the category. */
  total: number;
  /** Of those, due now. */
  due: number;
  attempts: number;
  correct: number;
  avgLoss: number;
}

/** Accuracy per category. An attempt counts for every category of its problem. */
export function categoryStats(problems: readonly Problem[], attempts: readonly Attempt[], now = Date.now()): CategoryStat[] {
  const byId = new Map(problems.map((p) => [p.id, p]));
  const states = cardStates(problems, attempts);
  const acc = new Map<Category, CategoryStat & { totalLoss: number }>(
    CATEGORIES.map((c) => [c, { category: c, total: 0, due: 0, attempts: 0, correct: 0, avgLoss: 0, totalLoss: 0 }]),
  );
  for (const p of problems) {
    const due = (states.get(p.id)?.due ?? 0) <= now;
    for (const c of p.categories) {
      const s = acc.get(c)!;
      s.total++;
      if (due) s.due++;
    }
  }
  for (const a of attempts) {
    const p = byId.get(a.problemId);
    if (!p) continue;
    for (const c of p.categories) {
      const s = acc.get(c)!;
      s.attempts++;
      if (a.correct) s.correct++;
      s.totalLoss += a.equityLoss;
    }
  }
  return CATEGORIES.map((c) => acc.get(c)!)
    .filter((s) => s.total > 0 || s.attempts > 0)
    .map(({ totalLoss, ...s }) => ({ ...s, avgLoss: s.attempts ? totalLoss / s.attempts : 0 }));
}
