/**
 * Models and effort levels the explanation panel offers. Client-safe: no secrets, no SDK.
 * Prices are Anthropic list prices (input / output per million tokens) at the time of writing.
 */
import type { Problem } from "@/types/problem";
import { difficultyBand } from "./filters";

/** output_config.effort: how much the model thinks (and so time and tokens). All four models accept every level. */
export const EXPLAIN_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ExplainEffort = (typeof EXPLAIN_EFFORTS)[number];

export interface ExplainModel {
  id: string;
  label: string;
  note: string;
  /** Opt into Anthropic's server-side fallback when a safety classifier declines a request. */
  usesFallbacks: boolean;
  /** The model's own default level, preselected in the panel and sent when none is chosen. */
  defaultEffort: ExplainEffort;
}

export const EXPLAIN_MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5", note: "$5 / $25 per M tokens", usesFallbacks: true, defaultEffort: "high" },
  // Thinking is always on and effort is the only control; its API default is medium (Opus 5's is
  // high). Broader safety classifiers than Opus 5, hence the fallback.
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "$4 / $20 per M tokens, thinking always on", usesFallbacks: true, defaultEffort: "medium" },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", note: "$10 / $50 per M tokens, thinking always on, slower", usesFallbacks: true, defaultEffort: "high" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", note: "$2 / $10 per M tokens", usesFallbacks: false, defaultEffort: "high" },
] as const satisfies readonly ExplainModel[];

export type ExplainModelId = (typeof EXPLAIN_MODELS)[number]["id"];

export const DEFAULT_MODEL: ExplainModelId = "claude-opus-5";
/** Preselected for problems in the hard band (small equity gap); the user still clicks. */
export const HARD_MODEL: ExplainModelId = "claude-fable-5-1";

export function isExplainModel(id: string): id is ExplainModelId {
  return EXPLAIN_MODELS.some((m) => m.id === id);
}

export function isExplainEffort(x: string): x is ExplainEffort {
  return (EXPLAIN_EFFORTS as readonly string[]).includes(x);
}

export function explainModel(id: ExplainModelId): ExplainModel {
  return EXPLAIN_MODELS.find((m) => m.id === id)!;
}

export function suggestedModel(p: Problem): ExplainModelId {
  return difficultyBand(p) === "hard" ? HARD_MODEL : DEFAULT_MODEL;
}

/** Slow enough to warn about: Fable, or the two highest levels. */
export function isSlow(model: ExplainModelId, effort: ExplainEffort): boolean {
  return model === "claude-fable-5-1" || effort === "xhigh" || effort === "max";
}
