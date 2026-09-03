/**
 * Progress lives in localStorage as an append-only attempt log. Aggregates are derived
 * from it, and it is what later spaced repetition will read.
 */
export interface Attempt {
  problemId: string;
  answerId: string;
  equityLoss: number;
  correct: boolean;
  /** ISO timestamp */
  at: string;
}

export interface Stats {
  answered: number;
  correct: number;
  totalLoss: number;
  avgLoss: number;
}

export const ATTEMPTS_KEY = "bg-trainer/attempts/v1";

function isAttempt(x: unknown): x is Attempt {
  if (!x || typeof x !== "object") return false;
  const a = x as Record<string, unknown>;
  return (
    typeof a.problemId === "string" &&
    typeof a.answerId === "string" &&
    typeof a.equityLoss === "number" &&
    typeof a.correct === "boolean" &&
    typeof a.at === "string"
  );
}

export function loadAttempts(): Attempt[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(ATTEMPTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isAttempt) : [];
  } catch {
    return [];
  }
}

export function saveAttempt(attempt: Attempt): Attempt[] {
  const all = [...loadAttempts(), attempt];
  try {
    window.localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable (private mode, quota): keep going in memory
  }
  return all;
}

export function clearAttempts(): void {
  try {
    window.localStorage.removeItem(ATTEMPTS_KEY);
  } catch {
    // ignore
  }
}

export function computeStats(attempts: readonly Attempt[]): Stats {
  const answered = attempts.length;
  const correct = attempts.filter((a) => a.correct).length;
  const totalLoss = attempts.reduce((s, a) => s + a.equityLoss, 0);
  return { answered, correct, totalLoss, avgLoss: answered ? totalLoss / answered : 0 };
}
