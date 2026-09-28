/**
 * How the quiz picks the next problem among those the filters let through: new (never answered)
 * problems first, and a random order instead of the spaced-repetition schedule; the two combine.
 * Remembered in localStorage as a convenience, apart from the filters, so resetting the filters
 * keeps the order. The picking itself is `pickNext` in scheduler.ts.
 */

export interface QuizOrder {
  /** Never-answered problems before anything else, the last match added first. */
  newFirst: boolean;
  /** Any matching problem, due or not, each once before any comes back (a shuffled deck). */
  random: boolean;
}

export const DEFAULT_ORDER: QuizOrder = { newFirst: false, random: false };

export const ORDER_KEY = "bg-trainer/quiz-order/v1";

export function isDefaultOrder(o: QuizOrder): boolean {
  return !o.newFirst && !o.random;
}

/** One line on what the order does, for the filter panel. */
export function orderText(o: QuizOrder): string {
  if (o.newFirst && o.random) return "new problems first, the last match added first (shuffled within it), then the rest at random";
  if (o.newFirst) return "new problems first, the last match added first (in game order), then spaced repetition";
  if (o.random) return "at random, each problem once before any comes back";
  return "spaced repetition: missed ones again, then due reviews, then new problems";
}

/** Short form for the collapsed panel; empty for the default. */
export function orderSummary(o: QuizOrder): string {
  if (o.newFirst && o.random) return "new first, then random";
  if (o.newFirst) return "new first";
  if (o.random) return "random order";
  return "";
}

export function loadOrder(): QuizOrder {
  try {
    if (typeof window === "undefined") return DEFAULT_ORDER;
    const raw = window.localStorage.getItem(ORDER_KEY);
    if (!raw) return DEFAULT_ORDER;
    const o = JSON.parse(raw) as Record<string, unknown> | null;
    return { newFirst: o?.newFirst === true, random: o?.random === true };
  } catch {
    return DEFAULT_ORDER;
  }
}

export function saveOrder(o: QuizOrder): void {
  try {
    window.localStorage.setItem(ORDER_KEY, JSON.stringify(o));
  } catch {
    // storage unavailable: the order just won't persist
  }
}
