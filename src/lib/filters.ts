/**
 * Study filters: category, question type, difficulty, source, mistake size and progress.
 * Difficulty is the equity gap between the best and the second-best answer (smaller gap =
 * harder); the source separates the problem sets from the user's own mistakes (problems with an
 * origin), the mistake size picks those by what the move played lost (errors, blunders), and the
 * progress can leave out every problem already answered (the attempt log, passed in). The chosen
 * filters are remembered in localStorage as a convenience.
 */
import { CATEGORIES, QUESTION_TYPES, type Category, type Problem, type QuestionType } from "@/types/problem";
import { BLUNDER_THRESHOLD, ERROR_THRESHOLD, errorLevel } from "./matches";
import { difficulty } from "./problem-utils";

export const DIFFICULTY_BANDS = ["hard", "medium", "easy"] as const;
export type DifficultyBand = (typeof DIFFICULTY_BANDS)[number];

/** Gap thresholds (equity): below HARD_MAX is hard, below MEDIUM_MAX is medium, else easy. */
export const HARD_MAX = 0.03;
export const MEDIUM_MAX = 0.1;

export function difficultyBand(p: Problem): DifficultyBand {
  const gap = difficulty(p);
  if (gap < HARD_MAX) return "hard";
  if (gap < MEDIUM_MAX) return "medium";
  return "easy";
}

export const BAND_LABEL: Record<DifficultyBand, string> = {
  hard: `Hard (gap < ${HARD_MAX})`,
  medium: `Medium (${HARD_MAX}–${MEDIUM_MAX})`,
  easy: `Easy (gap ≥ ${MEDIUM_MAX})`,
};

export const SOURCES = ["all", "sets", "mistakes"] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_LABEL: Record<Source, string> = { all: "All", sets: "Problem sets", mistakes: "My mistakes" };

/** The size of one of the user's own mistakes: what the move played lost (matches.ts thresholds). */
export const MISTAKE_SIZES = ["error", "blunder"] as const;
export type MistakeSize = (typeof MISTAKE_SIZES)[number];

export const MISTAKE_SIZE_LABEL: Record<MistakeSize, { text: string; title: string }> = {
  error: { text: "Errors only", title: `Your mistakes that lost ${ERROR_THRESHOLD}–${BLUNDER_THRESHOLD}` },
  blunder: { text: "Blunders only", title: `Your mistakes that lost ${BLUNDER_THRESHOLD} or more` },
};

/** All problems, or only those never answered in this browser (the attempt log). */
export const PROGRESS = ["all", "untried"] as const;
export type Progress = (typeof PROGRESS)[number];

export const PROGRESS_LABEL: Record<Progress, string> = { all: "All", untried: "Not tried yet" };

/** The ids of the problems answered at least once. */
export function attemptedIds(attempts: readonly { problemId: string }[]): Set<string> {
  return new Set(attempts.map((a) => a.problemId));
}

const NONE_ATTEMPTED: ReadonlySet<string> = new Set();

/** The one size chosen, or null for all problems (the panel offers one size at a time). */
export function onlySize(f: Filters): MistakeSize | null {
  return f.mistakeSize.length === 1 ? f.mistakeSize[0] : null;
}

/** Errors and blunders are exclusive here: an error lost less than a blunder. Other problems have none. */
export function mistakeSize(p: Problem): MistakeSize | null {
  if (!p.origin) return null;
  const level = errorLevel(p.origin.loss);
  return level === "ok" ? null : level;
}

export interface Filters {
  /** Empty = any category; otherwise a problem matches when it carries at least one of them. */
  categories: Category[];
  type: QuestionType | "all";
  /** Empty = any difficulty. */
  difficulty: DifficultyBand[];
  /** Problem sets (data/*.json), the user's own mistakes, or both. */
  source: Source;
  /**
   * Empty = any problem; otherwise only the user's own mistakes of these sizes. The panel sets
   * one size at a time ("Errors only", "Blunders only"); a stored pair loads as empty.
   */
  mistakeSize: MistakeSize[];
  /** "untried": only problems never answered; answering one takes it out of the pool. */
  progress: Progress;
}

export const DEFAULT_FILTERS: Filters = { categories: [], type: "all", difficulty: [], source: "all", mistakeSize: [], progress: "all" };

export function isDefaultFilters(f: Filters): boolean {
  return (
    f.categories.length === 0 &&
    f.type === "all" &&
    f.difficulty.length === 0 &&
    f.source === "all" &&
    f.mistakeSize.length === 0 &&
    f.progress === "all"
  );
}

/** `attempted`: the ids answered so far (`attemptedIds`), needed for the progress filter. */
export function matchesFilters(p: Problem, f: Filters, attempted: ReadonlySet<string> = NONE_ATTEMPTED): boolean {
  if (f.progress === "untried" && attempted.has(p.id)) return false;
  if (f.source === "sets" && p.origin) return false;
  if (f.source === "mistakes" && !p.origin) return false;
  if (f.type !== "all" && p.type !== f.type) return false;
  if (f.categories.length > 0 && !p.categories.some((c) => f.categories.includes(c))) return false;
  if (f.difficulty.length > 0 && !f.difficulty.includes(difficultyBand(p))) return false;
  if (f.mistakeSize.length > 0) {
    const size = mistakeSize(p);
    if (!size || !f.mistakeSize.includes(size)) return false;
  }
  return true;
}

export function applyFilters(problems: readonly Problem[], f: Filters, attempted: ReadonlySet<string> = NONE_ATTEMPTED): Problem[] {
  return problems.filter((p) => matchesFilters(p, f, attempted));
}

/** Problems per category within a list (a problem counts once per category it carries). */
export function categoryCounts(problems: readonly Problem[]): Record<Category, number> {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  for (const p of problems) for (const c of p.categories) counts[c]++;
  return counts;
}

export const FILTERS_KEY = "bg-trainer/filters/v4";
/**
 * Older keys, newest first: v3 had no progress, v2 no mistake size either, v1 no source either;
 * the newest one found carries over.
 */
export const FILTERS_KEY_V3 = "bg-trainer/filters/v3";
export const FILTERS_KEY_V2 = "bg-trainer/filters/v2";
export const FILTERS_KEY_V1 = "bg-trainer/filters/v1";

function sanitize(x: unknown): Filters {
  if (!x || typeof x !== "object") return DEFAULT_FILTERS;
  const o = x as Record<string, unknown>;
  const categories = Array.isArray(o.categories)
    ? (o.categories.filter((c): c is Category => (CATEGORIES as readonly string[]).includes(c as string)) as Category[])
    : [];
  const type = (QUESTION_TYPES as readonly string[]).includes(o.type as string) ? (o.type as QuestionType) : "all";
  const bands = Array.isArray(o.difficulty)
    ? (o.difficulty.filter((d): d is DifficultyBand => (DIFFICULTY_BANDS as readonly string[]).includes(d as string)) as DifficultyBand[])
    : [];
  const source = (SOURCES as readonly string[]).includes(o.source as string) ? (o.source as Source) : "all";
  const sizes = Array.isArray(o.mistakeSize)
    ? (o.mistakeSize.filter((m): m is MistakeSize => (MISTAKE_SIZES as readonly string[]).includes(m as string)) as MistakeSize[])
    : [];
  const progress = (PROGRESS as readonly string[]).includes(o.progress as string) ? (o.progress as Progress) : "all";
  return { categories, type, difficulty: bands, source, mistakeSize: sizes.length === 1 ? sizes : [], progress };
}

export function loadFilters(): Filters {
  try {
    if (typeof window === "undefined") return DEFAULT_FILTERS;
    const raw = window.localStorage.getItem(FILTERS_KEY);
    if (raw) return sanitize(JSON.parse(raw));
    const old =
      window.localStorage.getItem(FILTERS_KEY_V3) ?? window.localStorage.getItem(FILTERS_KEY_V2) ?? window.localStorage.getItem(FILTERS_KEY_V1);
    if (!old) return DEFAULT_FILTERS;
    const migrated = sanitize(JSON.parse(old));
    window.localStorage.setItem(FILTERS_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function saveFilters(f: Filters): void {
  try {
    window.localStorage.setItem(FILTERS_KEY, JSON.stringify(f));
  } catch {
    // storage unavailable: filters just won't persist
  }
}
