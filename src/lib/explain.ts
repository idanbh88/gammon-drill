/**
 * The prompt for Claude-written explanations, built from the same data the app shows: the
 * position from Blue's side, the question, the ranked answers with equities / losses /
 * probabilities and the classifier's features. Server-only (used by the /api/explain route).
 *
 * Bump PROMPT_VERSION when SYSTEM_PROMPT or the prompt layout changes; every stored explanation
 * records the version and a hash of its full prompt.
 */
import { createHash } from "node:crypto";
import type { Problem } from "@/types/problem";
import { actingView, questionText } from "./board";
import { parseXgid, type Position } from "./xgid";

export const PROMPT_VERSION = "v3";

/** Room for the model's thinking as well as the answer; thinking tokens count against it. */
export const MAX_TOKENS = 16000;
/** At xhigh and max the thinking can run long (max is uncapped); the request is streamed, so no timeout limits this. */
export const MAX_TOKENS_DEEP = 64000;

export function maxTokensFor(effort: string): number {
  return effort === "xhigh" || effort === "max" ? MAX_TOKENS_DEEP : MAX_TOKENS;
}

export const SYSTEM_PROMPT = `You are an expert backgammon coach. A position-training app shows the reader a position, they choose a play or a cube action, and then they see the engine's ranking of the candidates with their equities. You write the explanation that appears under that ranking.

Goal: the reader should understand why the best play is right and what the alternatives give up, the way a strong player would say it at the board.

Constraints:
- 3 to 5 sentences of plain prose, about 120 words at most. No headings, lists, markdown or preamble.
- Name the concrete idea the best play serves (safety, priming, blitzing, anchoring, timing, the race, gammons, cube ownership, match score). For the alternatives you mention, quote the equity losses you were given.
- Use "Blue" and "White" and Blue's point numbering exactly as in the data: Blue moves from the 24-point down to the 1-point and off.
- Do not invent moves, dice, numbers or rules; do not restate the whole position; do not hedge.`;

function pct(x: number): string {
  return `${(100 * x).toFixed(1)}%`;
}

function signed(x: number): string {
  return (x >= 0 ? "+" : "") + x.toFixed(3);
}

export function describePosition(pos: Position): string {
  const view = actingView(pos);
  const pts = view.points;
  const mine: string[] = [];
  for (let i = 24; i >= 1; i--) if (pts[i] > 0) mine.push(`${i}-point x${pts[i]}`);
  const theirs: string[] = [];
  for (let i = 1; i <= 24; i++) if (pts[i] < 0) theirs.push(`Blue's ${i}-point (White's ${25 - i}-point) x${-pts[i]}`);
  const lines = [
    `Blue (to act): ${mine.join(", ") || "none on the board"}; bar ${view.myBar}; borne off ${view.myOff}; pip count ${view.myPips}.`,
    `White: ${theirs.join(", ") || "none on the board"}; bar ${view.theirBar}; borne off ${view.theirOff}; pip count ${view.theirPips}.`,
  ];
  let score: string;
  if (pos.matchLength > 0) {
    const myScore = view.me === 1 ? pos.score[0] : pos.score[1];
    const theirScore = view.me === 1 ? pos.score[1] : pos.score[0];
    score = `${pos.matchLength}-point match, Blue ${myScore} - White ${theirScore}`;
    if (pos.crawford) score += ", Crawford game";
  } else {
    score = "money game" + (pos.jacoby ? ", Jacoby" : "") + (pos.beavers ? ", beavers" : "");
  }
  const cube =
    pos.cubeOwner === "center"
      ? `cube centred at ${pos.cubeValue}`
      : `cube at ${pos.cubeValue}, owned by ${pos.cubeOwner === view.me ? "Blue" : "White"}`;
  lines.push(`Score: ${score}. Cube: ${cube}.`);
  return lines.join("\n");
}

export function describeAnswers(problem: Problem): string {
  return problem.answers
    .map((a, i) => {
      const parts = [`${i + 1}. ${a.label}: equity ${signed(a.equity)}`, a.equityLoss === 0 ? "(best)" : `(loses ${a.equityLoss.toFixed(3)})`];
      const p = a.probs;
      if (p) {
        parts.push(
          `- wins ${pct(p.win)}, gammons ${pct(p.winGammon)}, backgammons ${pct(p.winBackgammon)}; ` +
            `loses gammons ${pct(p.loseGammon)}, backgammons ${pct(p.loseBackgammon)}`,
        );
      }
      return parts.join(" ");
    })
    .join("\n");
}

const FEATURE_LABELS: Record<string, string> = {
  position_class: "engine position class",
  back_me: "Blue checkers back (bar + White's home board)",
  back_them: "White checkers back",
  anchors_me: "Blue anchors in White's board (Blue's points)",
  anchors_them: "White anchors in Blue's board (Blue's points)",
  home_points_me: "Blue home-board points made",
  home_points_them: "White home-board points made",
  prime_me: "longest Blue prime in front of White's back checkers",
  prime_them: "longest White prime in front of Blue's back checkers",
  bar_me: "Blue on the bar",
  bar_them: "White on the bar",
  can_hit: "a hit is available",
};

export function describeFeatures(problem: Problem): string {
  const f = problem.features ?? {};
  const parts: string[] = [];
  for (const [key, label] of Object.entries(FEATURE_LABELS)) {
    if (!(key in f)) continue;
    const v = f[key];
    const shown = typeof v === "boolean" ? (v ? "yes" : "no") : v === "" ? "none" : String(v);
    parts.push(`${label}: ${shown}`);
  }
  return parts.join("; ");
}

export interface PromptOptions {
  /** Set when the reader is reviewing a move from their own match: the answer they played. */
  played?: { label: string; equityLoss: number };
}

export function describePlayed(played: { label: string; equityLoss: number }): string {
  const verdict =
    played.equityLoss > 0
      ? `which loses ${played.equityLoss.toFixed(3)} against the best play. Say what that play gives up and what the best play achieves instead`
      : "which is the best play. Say why it is right and what the alternatives would have cost";
  return `The reader is reviewing a match they played: in this position they played ${played.label}, ${verdict}.`;
}

export function buildPrompt(problem: Problem, opts: PromptOptions = {}): string {
  const pos = parseXgid(problem.xgid);
  const engine = problem.analysis;
  const source = engine?.engine === "gnubg" ? `GNU Backgammon ${engine.plies ?? "?"}-ply evaluation` : "the engine";
  const sections = [
    `Question: ${questionText(pos)}`,
    `Categories: ${problem.categories.join(", ") || "unknown"}.`,
    "Position (Blue's numbering, 24 = Blue's farthest point, 1 = Blue's ace point):",
    describePosition(pos),
    `Candidate plays ranked by ${source}, equities from Blue's side (cubeful; normalised money equity in match play):`,
    describeAnswers(problem),
  ];
  const feats = describeFeatures(problem);
  if (feats) sections.push(`Board features: ${feats}.`);
  if (opts.played) sections.push(describePlayed(opts.played));
  sections.push("Write the explanation now.");
  return sections.join("\n\n");
}

/** Plain prose only: strip markdown bullets / headings, code fences and a leading label. */
export function cleanExplanation(text: string): string {
  const lines: string[] = [];
  let fenced = false;
  for (const line of text.trim().split(/\r?\n/)) {
    let s = line.trim();
    if (s.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !s) continue;
    s = s.replace(/^(#+\s*|[-*]\s+|\d+[.)]\s+)/, "");
    s = s.replace(/^\**explanation\**\s*:\s*/i, "");
    s = s.replaceAll("**", "");
    lines.push(s);
  }
  return lines.join(" ").replace(/[ \t]+/g, " ").trim();
}

/** Identifies the exact prompt (version, system prompt and user prompt) an explanation came from. */
export function promptSha256(prompt: string): string {
  return createHash("sha256").update(`${PROMPT_VERSION}\n${SYSTEM_PROMPT}\n${prompt}`).digest("hex");
}
