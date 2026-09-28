/**
 * Robertie's "501 Essential Backgammon Problems", read from the user's scan by
 * pipeline/import_robertie.py into data/robertie/ (git-ignored: the book's material stays on this
 * machine). View types and pure helpers; client-safe (robertie-store.ts reads the database on the
 * server).
 *
 * A book problem is a quiz problem with `book` set (id "robertie-<n>"): the position the book
 * shows, gnubg's ranked answers with the book's answer among them, and the mark for how gnubg
 * rates that answer. gnubg judges the quiz, as everywhere in the app; the book's answer is
 * always offered and tagged after answering.
 */
import type { BookAgreement, Problem } from "@/types/problem";
import type { ProblemStatus } from "./lesson-progress";
import { BLUNDER_THRESHOLD, ERROR_THRESHOLD, formatLoss } from "./matches";
import type { Attempt } from "./storage";

export const ROBERTIE_ID_RE = /^robertie-(\d{1,3})$/;
export const BOOK_NAME = "Robertie 501";

export function robertieId(n: number): string {
  return `robertie-${n}`;
}

/** The book's problem number of a quiz id, or null for any other id. */
export function robertieNumber(id: string): number | null {
  const m = ROBERTIE_ID_RE.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 501 ? n : null;
}

/** gnubg's rating of the book's answer, from its equity loss (the app's error and blunder lines). */
export function agreementOf(loss: number): BookAgreement {
  if (loss === 0) return "same";
  if (loss < ERROR_THRESHOLD) return "close";
  if (loss < BLUNDER_THRESHOLD) return "differs";
  return "blunder";
}

export const AGREEMENT_LABEL: Record<BookAgreement, string> = {
  same: "gnubg agrees",
  close: "small difference",
  differs: "gnubg disagrees",
  blunder: "gnubg strongly disagrees",
};

export const AGREEMENT_CLASS: Record<BookAgreement, string> = {
  same: "bg-green-100 text-green-800",
  close: "bg-lime-100 text-lime-800",
  differs: "bg-amber-100 text-amber-900",
  blunder: "bg-red-100 text-red-800",
};

export const AGREEMENTS: BookAgreement[] = ["same", "close", "differs", "blunder"];

/**
 * The line under the verdict for a book problem (after answering only): how the user's pick,
 * gnubg's best and the book's answer relate. `null` for other problems.
 */
export function bookVerdict(p: Problem, pickedId: string): string | null {
  const book = p.book;
  if (!book) return null;
  const best = p.answers[0];
  const label = (id: string) => p.answers.find((a) => a.id === id)?.label ?? id;
  const plies = `${book.plies}-ply`;
  if (book.answerId === best.id) return pickedId === best.id ? "Robertie plays it too." : `Robertie plays ${best.label} too.`;
  const loss = formatLoss(book.loss);
  if (pickedId === book.answerId) return `That is Robertie's answer, but gnubg prefers ${best.label} (${loss}, ${plies}).`;
  return `Robertie's answer is ${label(book.answerId)} (${loss} by gnubg, ${plies}).`;
}

export type ImageKind = "diagram" | "page";

/** Names the importer writes: a diagram "s003-L-1" (diagrams/s003-L-1.png), a page "s003-L". */
export const DIAGRAM_RE = /^s\d{3}-[LR]-\d{1,2}$/;
export const PAGE_RE = /^s\d{3}-[LR]$/;

export function robertieImageSrc(kind: ImageKind, key: string, version?: string | null): string {
  const file = kind === "diagram" ? `${key}.png` : `${key}.jpg`;
  return `/api/robertie/images/${kind}/${file}${version ? `?v=${version}` : ""}`;
}

export interface ChapterSummary {
  number: number;
  title: string;
  firstProblem: number | null;
  lastProblem: number | null;
  /** Problems in the chapter by kind. */
  checker: number;
  cube: number;
  /** Playable: the position is read and checked. */
  playable: number;
  /** Waiting for a look at their reading (not in the quiz yet). */
  waiting: number;
  /** Playable problems per mark. */
  marks: Record<BookAgreement, number>;
  /** The playable problems' ids, in book order (progress in the browser comes from these). */
  ids: string[];
}

export interface Disagreement {
  number: number;
  chapter: number;
  chapterTitle: string;
  caption: string;
  book: string;
  best: string;
  loss: number;
  plies: number;
  agreement: BookAgreement;
}

/** One reading for the check page. */
export interface BoardCheck {
  number: number;
  chapter: number | null;
  caption: string;
  status: "ok" | "fixed" | "check";
  issues: string[];
  diagram: string | null;
  page: string | null;
  xgid: string | null;
  fixNote: string | null;
  /** Reported as misread in the app and not dealt with since. */
  reported: boolean;
}

/** Robertie's text for one problem (loaded after answering). */
export interface BookText {
  number: number;
  caption: string;
  /** English, as printed; null when the scan could not be transcribed (the page image is there). */
  text: string | null;
  /** The book pages the solution is on. */
  pages: string[];
  problemPage: string | null;
  diagram: string | null;
  /** The newest Hebrew translation of exactly this text. */
  translation: { text: string; model: string; generatedAt: string } | null;
}

// ---------------------------------------------------------------------------
// Chapter progress in this browser: the shared attempt log (bg-trainer/attempts/v1) plus the
// chapter's "start over" marker, kept apart in bg-trainer/robertie/v1.

export const ROBERTIE_KEY = "bg-trainer/robertie/v1";

export interface RobertieRuns {
  /** chapter number -> ISO start of the current run; a chapter without one counts every answer. */
  runs: Record<string, string>;
}

export function sanitizeRuns(x: unknown): RobertieRuns {
  const runs: Record<string, string> = {};
  const r = x && typeof x === "object" ? (x as Record<string, unknown>).runs : null;
  if (r && typeof r === "object") {
    for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
      if (/^\d{1,2}$/.test(k) && typeof v === "string" && !Number.isNaN(Date.parse(v))) runs[k] = v;
    }
  }
  return { runs };
}

export function loadRuns(): RobertieRuns {
  try {
    if (typeof window === "undefined") return { runs: {} };
    const raw = window.localStorage.getItem(ROBERTIE_KEY);
    return raw ? sanitizeRuns(JSON.parse(raw)) : { runs: {} };
  } catch {
    return { runs: {} };
  }
}

export function startRun(runs: RobertieRuns, chapter: number, at: string): RobertieRuns {
  const next = { runs: { ...runs.runs, [String(chapter)]: at } };
  try {
    window.localStorage.setItem(ROBERTIE_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: the run starts in memory only
  }
  return next;
}

export interface ChapterProgress {
  total: number;
  answered: number;
  correct: number;
  wrong: number;
  fixed: number;
  statuses: ProblemStatus[];
  /** The choice picked first in this run, per problem. */
  picks: (string | null)[];
}

/**
 * Where a chapter stands in this browser: the first answer to each problem since the run began
 * counts (right or wrong); a wrong one answered right later is "fixed". Answers given in the main
 * quiz count too: there is one attempt log per problem.
 */
export function chapterProgress(attempts: readonly Attempt[], ids: readonly string[], runStartedAt: string | null): ChapterProgress {
  const start = runStartedAt ? Date.parse(runStartedAt) : -Infinity;
  const index = new Map(ids.map((id, i) => [id, i]));
  const first: (Attempt | null)[] = ids.map(() => null);
  const fixed: boolean[] = ids.map(() => false);
  for (const a of attempts) {
    const i = index.get(a.problemId);
    if (i === undefined || !(Date.parse(a.at) >= start)) continue;
    if (!first[i]) first[i] = a;
    else if (!first[i]!.correct && a.correct) fixed[i] = true;
  }
  const statuses: ProblemStatus[] = first.map((f, i) => (!f ? null : f.correct ? "correct" : fixed[i] ? "fixed" : "wrong"));
  return {
    total: ids.length,
    answered: first.filter(Boolean).length,
    correct: statuses.filter((s) => s === "correct").length,
    wrong: statuses.filter((s) => s === "wrong").length,
    fixed: statuses.filter((s) => s === "fixed").length,
    statuses,
    picks: first.map((f) => f?.answerId ?? null),
  };
}
