import type { Answer, Problem } from "@/types/problem";

/** Smaller gap between the best and second-best answer = harder. */
export function difficulty(p: Problem): number {
  return p.answers[1]?.equityLoss ?? 0;
}

/**
 * The answers offered as buttons: the top `n` ranked (the best is always among them). For one of
 * the user's own decisions the answer they chose in the game is always offered too, and for a
 * problem of Robertie's book the book's answer, in place of the lowest-ranked one when it is not
 * in the top `n`.
 */
export function offeredAnswers(p: Problem, n = 4): Answer[] {
  const top = p.answers.slice(0, n);
  const must = p.origin?.played ?? p.book?.answerId;
  const extra = must !== undefined ? p.answers.find((a) => a.id === must) : undefined;
  if (!extra || top.includes(extra) || n < 2) return top;
  return [...top.slice(0, n - 1), extra];
}
