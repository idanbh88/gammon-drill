/**
 * Match review helpers: turn the importer's decision rows into the shapes the app already
 * knows (a `Problem` plus "what you played"), and the error thresholds. Pure and client-safe;
 * the store types are imported as types only.
 */
import { CATEGORIES, POSITION_CLASSES, type Category, type ExplanationMeta, type PositionClass, type Problem } from "@/types/problem";
import type { DecisionKind, DecisionRow, GameRow, MatchRow } from "./store";

/** XG-style thresholds: a loss of 0.02 is an error, 0.08 a blunder. */
export const ERROR_THRESHOLD = 0.02;
export const BLUNDER_THRESHOLD = 0.08;
export const THRESHOLDS = { error: ERROR_THRESHOLD, blunder: BLUNDER_THRESHOLD };

export type ErrorLevel = "ok" | "error" | "blunder";

export function errorLevel(loss: number | null): ErrorLevel {
  if (loss === null) return "ok";
  if (loss >= BLUNDER_THRESHOLD) return "blunder";
  if (loss >= ERROR_THRESHOLD) return "error";
  return "ok";
}

/** Text colour for an equity loss: green for none, then lime, amber and red at the thresholds. */
export function lossClass(loss: number): string {
  if (loss === 0) return "text-green-700";
  if (loss < ERROR_THRESHOLD) return "text-lime-700";
  if (loss < BLUNDER_THRESHOLD) return "text-amber-700";
  return "text-red-700";
}

export interface PlayedAnswer {
  id: string;
  label: string;
  equity: number;
  loss: number;
}

export interface MatchDecision {
  /** The decision as a quiz problem: ranked answers, categories, engine data, explanation. */
  problem: Problem;
  /** The engine's ranking of what was played; null for forced or unscored decisions. */
  played: PlayedAnswer | null;
  game: number;
  move: number;
  /** Whose decision: the match's analysed player is the user. */
  player: number;
  kind: DecisionKind;
  dice: string | null;
  forced: boolean;
  /** Plain text of what was played, for the card header. */
  playedText: string;
  level: ErrorLevel;
  /** Whether the quiz shows this decision (its pick, else the automatic rule); set by the server. */
  inQuiz?: boolean;
}

export interface StoredExplanation {
  explanation: string;
  model: string;
  generatedAt: string;
  /** null for explanations written before the effort was recorded. */
  effort?: string | null;
}

/** What the panel shows under an explanation: the model, the date and, when recorded, the effort. */
export function explanationMeta(row: Pick<StoredExplanation, "model" | "generatedAt" | "effort">): ExplanationMeta {
  const meta: ExplanationMeta = { model: row.model, generatedAt: row.generatedAt.slice(0, 10) };
  if (row.effort) meta.effort = row.effort;
  return meta;
}

function categories(raw: string[]): Category[] {
  return raw.filter((c): c is Category => (CATEGORIES as readonly string[]).includes(c));
}

function positionClass(raw: string | null): PositionClass | undefined {
  return raw && (POSITION_CLASSES as readonly string[]).includes(raw) ? (raw as PositionClass) : undefined;
}

/** What the player did, as text: "24/23 13/9", "Double", "No double", "Take", "Pass". */
export function playedText(row: Pick<DecisionRow, "kind" | "played" | "forced">): string {
  switch (row.kind) {
    case "checker":
      return row.played || "no legal move";
    case "cube":
      return row.played === "double" ? "Double" : "No double";
    case "take":
      return row.played === "pass" ? "Pass" : "Take";
  }
}

export function decisionProblem(row: DecisionRow, explanations?: Map<string, StoredExplanation>): Problem {
  const stored = explanations?.get(row.xgid);
  const problem: Problem = {
    id: row.decisionId,
    xgid: row.xgid,
    type: row.kind === "checker" ? "checker" : "cube",
    answers: row.answers,
    categories: categories(row.categories),
    explanation: stored?.explanation ?? "",
    source: "match",
    analysis: { engine: "gnubg", plies: row.plies, positionClass: positionClass(row.positionClass), analysedAt: row.analysedAt },
  };
  if (row.features) problem.features = row.features;
  if (stored) problem.explanationMeta = explanationMeta(stored);
  return problem;
}

export function toMatchDecision(row: DecisionRow, explanations?: Map<string, StoredExplanation>): MatchDecision {
  const problem = decisionProblem(row, explanations);
  const answer = row.playedAnswerId ? row.answers.find((a) => a.id === row.playedAnswerId) : undefined;
  const played: PlayedAnswer | null =
    answer && row.loss !== null ? { id: answer.id, label: answer.label, equity: answer.equity, loss: row.loss } : null;
  return {
    problem,
    played,
    game: row.gameNumber,
    move: row.moveNumber,
    player: row.player,
    kind: row.kind,
    dice: row.dice,
    forced: row.forced,
    playedText: playedText(row),
    level: errorLevel(played ? played.loss : null),
  };
}

export interface DecisionSummary {
  /** Decisions the engine evaluated. */
  decisions: number;
  forced: number;
  errors: number;
  blunders: number;
  totalLoss: number;
  /** Evaluated but not scored (the played move was missing from the engine's list). */
  unscored: number;
}

export function summarize(decisions: MatchDecision[]): DecisionSummary {
  const s: DecisionSummary = { decisions: 0, forced: 0, errors: 0, blunders: 0, totalLoss: 0, unscored: 0 };
  for (const d of decisions) {
    if (d.forced) {
      s.forced++;
      continue;
    }
    s.decisions++;
    if (!d.played) {
      s.unscored++;
      continue;
    }
    s.totalLoss += d.played.loss;
    if (d.level === "blunder") s.blunders++;
    if (d.level !== "ok") s.errors++;
  }
  s.totalLoss = Math.round(s.totalLoss * 1e4) / 1e4;
  return s;
}

export function groupByGame(decisions: MatchDecision[]): Map<number, MatchDecision[]> {
  const out = new Map<number, MatchDecision[]>();
  for (const d of decisions) {
    const list = out.get(d.game);
    if (list) list.push(d);
    else out.set(d.game, [d]);
  }
  return out;
}

export interface MatchResult {
  score1: number;
  score2: number;
  /** 1 or 2 when the match is decided, null otherwise. */
  winner: 1 | 2 | null;
}

/** The final score from the games' starting scores plus the last decided game. */
export function matchResult(match: Pick<MatchRow, "matchLength">, games: GameRow[]): MatchResult {
  let score1 = 0;
  let score2 = 0;
  const last = games[games.length - 1];
  if (last) {
    score1 = last.score1 + (last.winner === 1 ? (last.points ?? 0) : 0);
    score2 = last.score2 + (last.winner === 2 ? (last.points ?? 0) : 0);
  }
  let winner: 1 | 2 | null = null;
  if (match.matchLength > 0) {
    if (score1 >= match.matchLength) winner = 1;
    else if (score2 >= match.matchLength) winner = 2;
  }
  return { score1, score2, winner };
}

export function formatLoss(loss: number): string {
  return loss === 0 ? "—" : "−" + loss.toFixed(3);
}

/** "2026-09-03 18:37" from the stored ISO date-time. */
export function formatPlayedAt(playedAt: string | null): string {
  if (!playedAt) return "";
  return playedAt.slice(0, 16).replace("T", " ");
}
