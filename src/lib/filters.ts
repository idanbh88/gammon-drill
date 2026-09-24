/**
 * Study filters: category, question type, difficulty and source. Difficulty is the equity gap
 * between the best and the second-best answer (smaller gap = harder); the source separates the
 * problem sets from the user's own mistakes (problems with an origin). The chosen filters are
 * remembered in localStorage as a convenience.
 */
import { CATEGORIES, QUESTION_TYPES, type Category, type Problem, type QuestionType } from "@/types/problem";
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

export interface Filters {
  /** Empty = any category; otherwise a problem matches when it carries at least one of them. */
  categories: Category[];
  type: QuestionType | "all";
  /** Empty = any difficulty. */
  difficulty: DifficultyBand[];
  /** Problem sets (data/*.json), the user's own mistakes, or both. */
  source: Source;
}

export const DEFAULT_FILTERS: Filters = { categories: [], type: "all", difficulty: [], source: "all" };

export function isDefaultFilters(f: Filters): boolean {
  return f.categories.length === 0 && f.type === "all" && f.difficulty.length === 0 && f.source === "all";
}

export function matchesFilters(p: Problem, f: Filters): boolean {
  if (f.source === "sets" && p.origin) return false;
  if (f.source === "mistakes" && !p.origin) return false;
  if (f.type !== "all" && p.type !== f.type) return false;
  if (f.categories.length > 0 && !p.categories.some((c) => f.categories.includes(c))) return false;
  if (f.difficulty.length > 0 && !f.difficulty.includes(difficultyBand(p))) return false;
  return true;
}

export function applyFilters(problems: readonly Problem[], f: Filters): Problem[] {
  return problems.filter((p) => matchesFilters(p, f));
}

/** Problems per category within a list (a problem counts once per category it carries). */
export function categoryCounts(problems: readonly Problem[]): Record<Category, number> {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  for (const p of problems) for (const c of p.categories) counts[c]++;
  return counts;
}

export const FILTERS_KEY = "bg-trainer/filters/v2";
/** v1 had no source; its choices carry over with every source. */
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
  return { categories, type, difficulty: bands, source };
}

export function loadFilters(): Filters {
  try {
    if (typeof window === "undefined") return DEFAULT_FILTERS;
    const raw = window.localStorage.getItem(FILTERS_KEY);
    if (raw) return sanitize(JSON.parse(raw));
    const old = window.localStorage.getItem(FILTERS_KEY_V1);
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
