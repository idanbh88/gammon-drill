/**
 * "My mistakes": the user's own decisions as quiz problems. Every decision of the user that lost
 * at least ERROR_THRESHOLD (in games against gnubg and imported matches) joins the quiz on its
 * own; a quiz pick (table quiz_picks) adds any other decision or removes one. Problem ids are
 * the decision ids, so spaced repetition keys on them like on any problem. Pure and client-safe.
 */
import type { Problem, ProblemOrigin } from "@/types/problem";
import { decisionProblem, ERROR_THRESHOLD, type StoredExplanation } from "./matches";
import type { DecisionRow } from "./store";

export interface MistakeRow extends DecisionRow {
  site: string;
  opponent: string;
  playedAt: string | null;
  /** The match's analysed player: the user. */
  userPlayer: number;
}

/** In the quiz without a pick: a scored, unforced decision of the user that lost 0.02 or more. */
export function isAutoMistake(row: Pick<DecisionRow, "player" | "forced" | "loss">, userPlayer: number): boolean {
  return row.player === userPlayer && !row.forced && row.loss !== null && row.loss >= ERROR_THRESHOLD;
}

/** Whether a decision is in the quiz: the pick when there is one, else the automatic rule. */
export function inQuiz(row: Pick<DecisionRow, "decisionId" | "player" | "forced" | "loss">, userPlayer: number, picks: ReadonlyMap<string, boolean>): boolean {
  return picks.get(row.decisionId) ?? isAutoMistake(row, userPlayer);
}

/** A decision as a quiz problem, with where it came from and what was played. */
export function mistakeProblem(row: MistakeRow, explanations?: Map<string, StoredExplanation>): Problem | null {
  if (row.forced || !row.playedAnswerId || row.loss === null || row.answers.length < 2) return null;
  const problem = decisionProblem(row, explanations);
  const origin: ProblemOrigin = {
    site: row.site,
    matchId: row.matchId,
    opponent: row.opponent,
    playedAt: row.playedAt,
    played: row.playedAnswerId,
    loss: row.loss,
  };
  return { ...problem, source: row.site === "gnubg" ? "game vs gnubg" : `${row.site} match`, origin };
}

/** Every decision the quiz should show, as problems (newest match first, game order within). */
export function mistakeProblems(rows: MistakeRow[], picks: ReadonlyMap<string, boolean>, explanations?: Map<string, StoredExplanation>): Problem[] {
  const out: Problem[] = [];
  for (const row of rows) {
    if (!inQuiz(row, row.userPlayer, picks)) continue;
    const p = mistakeProblem(row, explanations);
    if (p) out.push(p);
  }
  return out;
}
