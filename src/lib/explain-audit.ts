/**
 * Does an explanation quote only numbers and moves that exist in the problem's data?
 *
 * Numbers with decimals are checked against the answers' equities and losses (and the
 * differences between equities), percentages against the win / gammon probabilities (and the
 * losing chance, 100 minus the win rate), integers of 26 and above against pip counts, the pip
 * difference, scores, the match length and the roll itself ("63"). Integers up to 25 (points,
 * checkers, single dice, small scores) and cube values are not checked. Moves are split into hops (`bar/21* 24/21` is
 * `bar/21` and `24/21`) and every hop must occur in some answer.
 *
 * Returns the tokens that nothing in the data explains, in order of appearance.
 *
 * `translationMismatches` compares a translation with its English original the same way: the
 * numbers and moves must be the same in both.
 */
import type { Problem } from "@/types/problem";
import { actingView } from "./board";
import { parseXgid } from "./xgid";

/** One move in notation (13/7, bar/21*, 6/off, 8/5(2)), hops chained through a hit included. */
export const MOVE_PATTERN = String.raw`(?:bar|\d{1,2})\/(?:\d{1,2}|off)(?:\*?\/(?:\d{1,2}|off))*\*?(?:\(\d\))?`;

const TOKEN = new RegExp(String.raw`(?<move>${MOVE_PATTERN})|(?<pct>\d+(?:\.\d+)?)\s?%|(?<dec>\d*\.\d+)|(?<int>\d+)`, "gi");

const UNCHECKED_INT_MAX = 25;
const CUBE_VALUES = new Set([32, 64]);

function decimals(token: string): number {
  const i = token.indexOf(".");
  return i < 0 ? 0 : token.length - i - 1;
}

function near(value: number, candidates: readonly number[], places: number): boolean {
  const tol = 0.5 * 10 ** -places + 1e-9;
  return candidates.some((c) => Math.abs(c - value) <= tol);
}

/**
 * The hops of one move token, hits and repeat counts stripped: a chained move from the bar via
 * the 21-point to the 18-point gives "bar/21", "21/18" and "bar/18"; `8/5(2)` gives "8/5".
 * Returns null when the token is not a move.
 */
function hops(token: string): string[] | null {
  const parts = token
    .toLowerCase()
    .replace(/\(\d\)$/, "")
    .replaceAll("*", "")
    .split("/");
  if (parts.length < 2) return null;
  const out: string[] = [];
  for (let i = 0; i + 1 < parts.length; i++) out.push(`${parts[i]}/${parts[i + 1]}`);
  if (parts.length > 2) out.push(`${parts[0]}/${parts[parts.length - 1]}`);
  return out;
}

export function auditExplanation(problem: Problem, text: string): string[] {
  const pos = parseXgid(problem.xgid);
  const view = actingView(pos);

  const equities = problem.answers.map((a) => a.equity);
  const decimalValues: number[] = [];
  for (const a of problem.answers) decimalValues.push(Math.abs(a.equity), a.equityLoss);
  for (let i = 0; i < equities.length; i++) {
    for (let j = i + 1; j < equities.length; j++) decimalValues.push(Math.abs(equities[i] - equities[j]));
  }

  const percentValues: number[] = [];
  for (const a of problem.answers) {
    const p = a.probs;
    if (!p) continue;
    percentValues.push(100 * p.win, 100 * p.winGammon, 100 * p.winBackgammon, 100 * p.loseGammon, 100 * p.loseBackgammon, 100 * (1 - p.win));
  }

  const intValues = new Set([
    view.myPips,
    view.theirPips,
    Math.abs(view.myPips - view.theirPips),
    pos.score[0],
    pos.score[1],
    pos.matchLength,
    ...CUBE_VALUES,
  ]);
  if (pos.dice) {
    // The roll as written in prose ("an opening 63", "with 31").
    const [a, b] = pos.dice;
    intValues.add(Number(`${a}${b}`));
    intValues.add(Number(`${b}${a}`));
  }

  const knownHops = new Set<string>();
  for (const a of problem.answers) {
    for (const token of a.id.split(/\s+/)) {
      for (const h of hops(token) ?? []) knownHops.add(h);
    }
  }

  const flagged: string[] = [];
  const flag = (token: string) => {
    if (!flagged.includes(token)) flagged.push(token);
  };

  for (const m of text.matchAll(TOKEN)) {
    const g = m.groups!;
    if (g.move !== undefined) {
      const hs = hops(g.move);
      if (!hs || !hs.every((h) => knownHops.has(h))) flag(g.move);
    } else if (g.pct !== undefined) {
      if (!near(Number(g.pct), percentValues, decimals(g.pct))) flag(m[0].replace(/\s/g, ""));
    } else if (g.dec !== undefined) {
      if (!near(Number(g.dec), decimalValues, decimals(g.dec))) flag(g.dec);
    } else if (g.int !== undefined) {
      const n = Number(g.int);
      if (n > UNCHECKED_INT_MAX && !intValues.has(n)) flag(g.int);
    }
  }
  return flagged;
}

/**
 * The numbers and moves of a text as comparable keys, each with the text it was found as.
 * A number is keyed by its value, so 30% and "30 אחוז" (percent in words) or 0.050 and 0.05
 * agree; integers up to 25 (points, checkers, dice) are left out as in the audit, since either
 * language may spell them in words.
 */
function comparable(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(TOKEN)) {
    const g = m.groups!;
    if (g.move !== undefined) {
      if (!out.has(`m:${g.move.toLowerCase()}`)) out.set(`m:${g.move.toLowerCase()}`, g.move);
      continue;
    }
    const raw = g.pct ?? g.dec ?? g.int!;
    if (g.int !== undefined && Number(raw) <= UNCHECKED_INT_MAX) continue;
    const key = `n:${Number(raw)}`;
    if (!out.has(key)) out.set(key, g.pct !== undefined ? m[0].replace(/\s/g, "") : raw);
  }
  return out;
}

/**
 * Numbers and moves that a translation and its English original do not share: first those of
 * the English missing from the translation, then those the translation added. Empty when the
 * two agree.
 */
export function translationMismatches(english: string, translation: string): string[] {
  const en = comparable(english);
  const tr = comparable(translation);
  const out: string[] = [];
  for (const [key, shown] of en) if (!tr.has(key)) out.push(shown);
  for (const [key, shown] of tr) if (!en.has(key)) out.push(shown);
  return out;
}
