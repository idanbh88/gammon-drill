/**
 * Hebrew prose with backgammon notation in it. Inside a right-to-left paragraph the Unicode
 * bidi algorithm reorders digits, slashes and signs: "13/7 8/7" shows as "8/7 13/7", "bar/21*"
 * as "*21/bar" and "−0.045" with its sign on the far side. `ltrRuns` cuts such a text into the
 * pieces that must keep their left-to-right order (a whole sequence of moves, a signed number)
 * and the prose around them; the explanation panel isolates the first kind in <bdi dir="ltr">.
 * Unsigned numbers, percentages and English words in parentheses display correctly as they
 * are. Invisible marks a model puts in on its own are dropped first. Client-safe.
 */
import { MOVE_PATTERN } from "./explain-audit";

/** Bidi marks and embeddings (LRM, RLM, ALM, LRE to RLO, LRI to PDI) and soft hyphens. */
const INVISIBLE_MARKS = /[­‎‏؜‪-‮⁦-⁩]/g;

/** The text without invisible marks: the page sets the direction itself, and a soft hyphen
 * inside a Hebrew word would show as a hyphen where the line breaks. */
export function stripInvisibleMarks(text: string): string {
  return text.replace(INVISIBLE_MARKS, "");
}

export interface TextRun {
  text: string;
  /** Keep left to right inside the right-to-left paragraph. */
  ltr: boolean;
}

/** One move or several in a row ("13/7 8/7", "bar/22 24/22"). */
const MOVES = String.raw`${MOVE_PATTERN}(?:[  ]+${MOVE_PATTERN})*`;
/** A sign right before a number; a hyphen after a letter ("ה-5") or between digits ("6-3") is not one. */
const SIGNED = String.raw`(?<![\p{L}\p{N}.])[+\-−‑]\d*\.?\d+%?`;
const LTR = new RegExp(`${MOVES}|${SIGNED}`, "giu");

export function ltrRuns(raw: string): TextRun[] {
  const text = stripInvisibleMarks(raw);
  const runs: TextRun[] = [];
  let at = 0;
  for (const m of text.matchAll(LTR)) {
    if (m.index > at) runs.push({ text: text.slice(at, m.index), ltr: false });
    runs.push({ text: m[0], ltr: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at), ltr: false });
  return runs;
}
