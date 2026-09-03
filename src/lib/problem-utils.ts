import type { Answer, Problem } from "@/types/problem";

/** Smaller gap between the best and second-best answer = harder. */
export function difficulty(p: Problem): number {
  return p.answers[1]?.equityLoss ?? 0;
}

/** The answers offered as buttons: the top `n` ranked (the best is always among them). */
export function offeredAnswers(p: Problem, n = 4): Answer[] {
  return p.answers.slice(0, n);
}
