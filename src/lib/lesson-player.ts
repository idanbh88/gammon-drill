/**
 * The lesson player's navigation as a pure reducer; the component records answers in the log
 * (lesson-progress.ts) in its event handlers and then dispatches here.
 *
 * A run walks the problems not answered yet, in set order. A retry round walks the remaining
 * mistakes. An answered problem can be opened from the strip for review, which records nothing.
 * The summary ends a run or a round.
 */
import type { ProblemStatus } from "./lesson-progress";

export type PlayerMode = "run" | "retry" | "summary";

export interface PlayerState {
  mode: PlayerMode;
  /** Problem indexes still to play in this mode; the head is the current problem. */
  queue: number[];
  /** An answered problem opened for review, shown instead of the queue's head. */
  review: number | null;
  /** The choice picked on the current problem during this visit. */
  picked: string | null;
  /** The choice whose after-play picture is shown; null shows the position. */
  view: string | null;
}

export type PlayerAction =
  | { type: "answer"; choiceId: string; view: string | null }
  | { type: "next" }
  | { type: "open"; index: number; answered: boolean }
  | { type: "close" }
  | { type: "show"; choiceId: string | null }
  | { type: "retry"; indexes: number[] }
  | { type: "restart"; total: number };

const SUMMARY: PlayerState = { mode: "summary", queue: [], review: null, picked: null, view: null };

export function initialPlayer(statuses: readonly ProblemStatus[]): PlayerState {
  const queue = statuses.flatMap((s, i) => (s === null ? [i] : []));
  return queue.length ? { mode: "run", queue, review: null, picked: null, view: null } : SUMMARY;
}

/** The problem on screen, or null on the summary. */
export function currentIndex(s: PlayerState): number | null {
  if (s.review !== null) return s.review;
  return s.mode === "summary" ? null : (s.queue[0] ?? null);
}

export function playerReducer(s: PlayerState, a: PlayerAction): PlayerState {
  switch (a.type) {
    case "answer":
      if (s.review !== null || s.mode === "summary" || s.picked !== null || s.queue.length === 0) return s;
      return { ...s, picked: a.choiceId, view: a.view };
    case "next": {
      if (s.review !== null) return { ...s, review: null, view: null };
      if (s.mode === "summary" || s.picked === null) return s;
      const queue = s.queue.slice(1);
      return queue.length ? { ...s, queue, picked: null, view: null } : SUMMARY;
    }
    case "open": {
      if (a.answered) return { ...s, review: a.index, view: null };
      // Play an unanswered problem now; a current problem that was just answered is done.
      const done = s.review === null && s.picked !== null ? s.queue[0] : undefined;
      const rest = s.mode === "run" ? s.queue.filter((i) => i !== a.index && i !== done) : [];
      return { mode: "run", queue: [a.index, ...rest], review: null, picked: null, view: null };
    }
    case "close":
      return s.review === null ? s : { ...s, review: null, view: null };
    case "show":
      return { ...s, view: a.choiceId };
    case "retry":
      return a.indexes.length ? { mode: "retry", queue: [...a.indexes], review: null, picked: null, view: null } : s;
    case "restart":
      return a.total > 0 ? { mode: "run", queue: Array.from({ length: a.total }, (_, i) => i), review: null, picked: null, view: null } : SUMMARY;
  }
}
