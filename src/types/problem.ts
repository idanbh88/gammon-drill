import { z } from "zod";

/** Category taxonomy (after Robertie's chapter structure). */
export const CATEGORIES = [
  "opening",
  "early-game",
  "blitz",
  "holding-game",
  "priming-game",
  "back-game",
  "connectivity",
  "hit-or-not",
  "breaking-anchor",
  "crunch",
  "bearing-in",
  "bearing-off",
  "racing-cube",
  "contact-cube",
  "containment",
  "ace-point-game",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const QUESTION_TYPES = ["checker", "cube"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/**
 * Ids used by cube answers. Checker answers use the move notation as id.
 * The first four are the doubler's joint decision (dice `00`); `take`/`pass`
 * are the responder's decision (dice `D`).
 */
export const CUBE_ANSWER_IDS = [
  "no-double",
  "double-take",
  "double-pass",
  "too-good",
  "take",
  "pass",
] as const;
export type CubeAnswerId = (typeof CUBE_ANSWER_IDS)[number];

export const POSITION_CLASSES = ["contact", "race", "crashed", "bearoff", "over"] as const;
export type PositionClass = (typeof POSITION_CLASSES)[number];

export interface Probs {
  win: number;
  winGammon: number;
  winBackgammon: number;
  loseGammon: number;
  loseBackgammon: number;
}

export interface Answer {
  /** Checker: gnubg notation in Blue's numbering (25 = bar, 0 = off), e.g. "bar/21* 24/21", "6/4(2)". Cube: a CubeAnswerId. */
  id: string;
  /** Display text; for checker answers usually equals id. */
  label: string;
  /** Cubeful equity (money) or EMG-normalised equity (match) from Blue's side. */
  equity: number;
  /** >= 0; 0 for the best answer. Not always best.equity - equity for cube answers. */
  equityLoss: number;
  /** Optional gnubg detail, filled by the Phase 2 pipeline. */
  probs?: Probs;
}

export interface Analysis {
  engine: "gnubg" | "manual";
  plies?: number;
  positionClass?: PositionClass;
  /** ISO date */
  analysedAt?: string;
}

export interface Problem {
  /** Stable slug, e.g. "seed-003"; progress is keyed on this. */
  id: string;
  /** Without the "XGID=" prefix. */
  xgid: string;
  type: QuestionType;
  /** Ranked best-first; answers[0].equityLoss === 0; length >= 2. */
  answers: Answer[];
  /** At least one. */
  categories: Category[];
  /** Empty string until Phase 3 fills it. */
  explanation: string;
  /** "Robertie 501 #12", forum URL, "handwritten", ... */
  source?: string;
  /** Provenance, Phase 2. */
  analysis?: Analysis;
  /** Classifier features, Phase 2. Logged so rules can be tuned later. */
  features?: Record<string, number | boolean | string>;
  /** Provenance of a generated explanation (Phase 3, pipeline/explain.py). */
  explanationMeta?: ExplanationMeta;
}

export interface ExplanationMeta {
  model: string;
  /** ISO date */
  generatedAt: string;
}

export interface ProblemSet {
  name: string;
  source?: string;
  problems: Problem[];
}

// ---------------------------------------------------------------------------
// Runtime validation (zod) for data/*.json

export const ProbsSchema: z.ZodType<Probs> = z.object({
  win: z.number(),
  winGammon: z.number(),
  winBackgammon: z.number(),
  loseGammon: z.number(),
  loseBackgammon: z.number(),
});

export const AnswerSchema: z.ZodType<Answer> = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  equity: z.number(),
  equityLoss: z.number().min(0),
  probs: ProbsSchema.optional(),
});

export const AnalysisSchema: z.ZodType<Analysis> = z.object({
  engine: z.enum(["gnubg", "manual"]),
  plies: z.number().int().min(0).optional(),
  positionClass: z.enum(POSITION_CLASSES).optional(),
  analysedAt: z.string().optional(),
});

export const ProblemSchema: z.ZodType<Problem> = z.object({
  id: z.string().min(1),
  xgid: z.string().min(1),
  type: z.enum(QUESTION_TYPES),
  answers: z.array(AnswerSchema).min(2),
  categories: z.array(z.enum(CATEGORIES)).min(1),
  explanation: z.string(),
  source: z.string().optional(),
  analysis: AnalysisSchema.optional(),
  features: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])).optional(),
  explanationMeta: z.object({ model: z.string().min(1), generatedAt: z.string().min(1) }).optional(),
});

export const ProblemSetSchema: z.ZodType<ProblemSet> = z.object({
  name: z.string().min(1),
  source: z.string().optional(),
  problems: z.array(ProblemSchema),
});
