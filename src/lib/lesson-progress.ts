/**
 * Lesson progress in localStorage under its own key (not the quiz's attempt log): an append-only
 * list of answers plus, per set, when the current run started. "Start over" begins a new run by
 * moving that marker; nothing is deleted.
 *
 * Within the current run a problem's status comes from its first answer, so the score is what
 * you knew the first time. Answers given in a "retry my mistakes" round (retry: true) can turn a
 * mistake into "fixed" (the latest retry decides) but never raise the score.
 */
export const LESSONS_KEY = "bg-trainer/lessons/v1";

export interface LessonAttempt {
  /** The set's Galaxy quiz id. */
  setKey: string;
  problemId: string;
  choiceId: string;
  correct: boolean;
  loss: number | null;
  /** Given in a "retry my mistakes" round. */
  retry: boolean;
  /** ISO timestamp. */
  at: string;
}

export interface LessonLog {
  attempts: LessonAttempt[];
  /** setKey -> ISO start of the current run; a set without one counts every answer. */
  runs: Record<string, string>;
}

/** null: not answered in this run; "fixed": answered wrong, then right in a retry. */
export type ProblemStatus = "correct" | "wrong" | "fixed" | null;

export interface SetProgress {
  total: number;
  /** Problems answered in this run. */
  answered: number;
  /** First answers that were right: the run's score. */
  correct: number;
  /** Mistakes not fixed (yet). */
  wrong: number;
  fixed: number;
  statuses: ProblemStatus[];
  /** The choice picked last in this run, per problem. */
  picks: (string | null)[];
  /** Index of the first problem not answered in this run, or null. */
  next: number | null;
  finished: boolean;
  runStartedAt: string | null;
}

export function emptyLog(): LessonLog {
  return { attempts: [], runs: {} };
}

function isAttempt(x: unknown): x is LessonAttempt {
  if (!x || typeof x !== "object") return false;
  const a = x as Record<string, unknown>;
  return (
    typeof a.setKey === "string" &&
    typeof a.problemId === "string" &&
    typeof a.choiceId === "string" &&
    typeof a.correct === "boolean" &&
    (a.loss === null || typeof a.loss === "number") &&
    typeof a.retry === "boolean" &&
    typeof a.at === "string"
  );
}

/** Whatever storage held, reduced to a valid log. */
export function sanitizeLog(x: unknown): LessonLog {
  if (!x || typeof x !== "object") return emptyLog();
  const o = x as Record<string, unknown>;
  const attempts = Array.isArray(o.attempts) ? o.attempts.filter(isAttempt) : [];
  const runs: Record<string, string> = {};
  if (o.runs && typeof o.runs === "object" && !Array.isArray(o.runs)) {
    for (const [k, v] of Object.entries(o.runs)) if (typeof v === "string") runs[k] = v;
  }
  return { attempts, runs };
}

export function loadLessonLog(): LessonLog {
  try {
    if (typeof window === "undefined") return emptyLog();
    const raw = window.localStorage.getItem(LESSONS_KEY);
    return raw ? sanitizeLog(JSON.parse(raw)) : emptyLog();
  } catch {
    return emptyLog();
  }
}

function save(log: LessonLog): LessonLog {
  try {
    window.localStorage.setItem(LESSONS_KEY, JSON.stringify(log));
  } catch {
    // storage unavailable (private mode, quota): the returned log still has everything
  }
  return log;
}

/** Append one answer to the in-memory log (so a failed write loses nothing) and save it. */
export function recordAttempt(log: LessonLog, attempt: LessonAttempt): LessonLog {
  return save({ attempts: [...log.attempts, attempt], runs: log.runs });
}

/** Start a new run of one set: earlier answers stay in the log but no longer count. */
export function recordRunStart(log: LessonLog, setKey: string, at: string): LessonLog {
  return save({ attempts: log.attempts, runs: { ...log.runs, [setKey]: at } });
}

/** Forget every lesson answer. */
export function clearLessonLog(): LessonLog {
  try {
    window.localStorage.removeItem(LESSONS_KEY);
  } catch {
    // ignore
  }
  return emptyLog();
}

export function setProgress(log: LessonLog, setKey: string, problemIds: readonly string[]): SetProgress {
  const runStartedAt = log.runs[setKey] ?? null;
  const start = runStartedAt === null ? -Infinity : Date.parse(runStartedAt);
  const index = new Map(problemIds.map((id, i) => [id, i]));
  const first: (LessonAttempt | null)[] = problemIds.map(() => null);
  const lastRetry: (LessonAttempt | null)[] = problemIds.map(() => null);
  const picks: (string | null)[] = problemIds.map(() => null);
  for (const a of log.attempts) {
    if (a.setKey !== setKey) continue;
    const i = index.get(a.problemId);
    if (i === undefined || !(Date.parse(a.at) >= start)) continue;
    if (!a.retry) {
      if (first[i]) continue; // a second first answer (another tab): the earlier one counts
      first[i] = a;
    } else if (first[i]) {
      lastRetry[i] = a;
    } else {
      continue;
    }
    picks[i] = a.choiceId;
  }
  const statuses: ProblemStatus[] = first.map((f, i) => {
    if (!f) return null;
    if (f.correct) return "correct";
    return lastRetry[i]?.correct ? "fixed" : "wrong";
  });
  const answered = first.filter(Boolean).length;
  const next = statuses.indexOf(null);
  return {
    total: problemIds.length,
    answered,
    correct: first.filter((f) => f?.correct).length,
    wrong: statuses.filter((s) => s === "wrong").length,
    fixed: statuses.filter((s) => s === "fixed").length,
    statuses,
    picks,
    next: next >= 0 ? next : null,
    finished: problemIds.length > 0 && answered === problemIds.length,
    runStartedAt,
  };
}

/** Problems still wrong in this run, in set order (the "retry my mistakes" round). */
export function mistakeIndexes(p: SetProgress): number[] {
  return p.statuses.flatMap((s, i) => (s === "wrong" ? [i] : []));
}
