/**
 * Legal-play generation and move notation, all in the acting player's numbering
 * (24 = farthest point, 1 = ace point, 25 = bar, 0 = off).
 *
 * Plays are compared by their *resulting position*, so "13/10 10/7" and "13/7" are the
 * same play. That is also how `isLegalPlay` validates notation strings.
 */
import { BAR_POINT, OFF_POINT, type PerspectiveView } from "./board";

export interface MoveStep {
  /** 25 = bar, otherwise 1..24 */
  from: number;
  /** 0 = off, otherwise 1..24 */
  to: number;
  hit: boolean;
}

export interface BoardState {
  /** Length 25, index 1..24, +mine / -theirs. */
  points: number[];
  myBar: number;
  theirBar: number;
  myOff: number;
  theirOff: number;
}

export interface Play {
  steps: MoveStep[];
  notation: string;
  result: BoardState;
}

export function stateFromView(view: PerspectiveView): BoardState {
  return {
    points: view.points.slice(),
    myBar: view.myBar,
    theirBar: view.theirBar,
    myOff: view.myOff,
    theirOff: view.theirOff,
  };
}

function clone(s: BoardState): BoardState {
  return { ...s, points: s.points.slice() };
}

/** Identity of a position for de-duplication. */
export function stateKey(s: BoardState): string {
  return `${s.points.slice(1).join(",")}|${s.myBar}|${s.theirBar}`;
}

function allInHome(s: BoardState): boolean {
  if (s.myBar > 0) return false;
  for (let i = 7; i <= 24; i++) if (s.points[i] > 0) return false;
  return true;
}

function highestPoint(s: BoardState): number {
  for (let i = 24; i >= 1; i--) if (s.points[i] > 0) return i;
  return 0;
}

/**
 * Move one checker exactly `die` pips from `from` (25 = bar). Returns null when illegal.
 * Enforces: bar first, blocked points (2+ opposing checkers), bearing off only with all
 * checkers home, exact bear-off or from the highest point with a larger die.
 */
function tryStep(s: BoardState, from: number, die: number): { state: BoardState; step: MoveStep } | null {
  if (s.myBar > 0 && from !== BAR_POINT) return null;
  if (from === BAR_POINT) {
    if (s.myBar === 0) return null;
  } else if (from < 1 || from > 24 || s.points[from] <= 0) {
    return null;
  }
  const to = from - die;
  if (to >= 1) {
    if (s.points[to] < -1) return null;
    const next = clone(s);
    if (from === BAR_POINT) next.myBar--;
    else next.points[from]--;
    let hit = false;
    if (next.points[to] === -1) {
      hit = true;
      next.points[to] = 1;
      next.theirBar++;
    } else {
      next.points[to]++;
    }
    return { state: next, step: { from, to, hit } };
  }
  // Bearing off.
  if (from === BAR_POINT) return null;
  if (!allInHome(s)) return null;
  if (to < 0 && highestPoint(s) !== from) return null;
  const next = clone(s);
  next.points[from]--;
  next.myOff++;
  return { state: next, step: { from, to: OFF_POINT, hit: false } };
}

interface Sequence {
  steps: MoveStep[];
  dice: number[];
  state: BoardState;
}

function dfs(state: BoardState, order: number[], idx: number, steps: MoveStep[], dice: number[], out: Sequence[]) {
  if (idx === order.length) {
    out.push({ steps, dice, state });
    return;
  }
  const die = order[idx];
  let moved = false;
  const sources: number[] = [];
  if (state.myBar > 0) {
    sources.push(BAR_POINT);
  } else {
    for (let i = 24; i >= 1; i--) if (state.points[i] > 0) sources.push(i);
  }
  for (const from of sources) {
    const r = tryStep(state, from, die);
    if (!r) continue;
    moved = true;
    dfs(r.state, order, idx + 1, [...steps, r.step], [...dice, die], out);
  }
  if (!moved) out.push({ steps, dice, state });
}

/**
 * All distinct legal plays for the acting player. Empty array = no legal move (must pass).
 * Applies the "use both dice if possible, else the larger" rule.
 */
export function generatePlays(view: PerspectiveView, dice: [number, number]): Play[] {
  const start = stateFromView(view);
  const [a, b] = dice;
  const sequences: Sequence[] = [];
  const orders = a === b ? [[a, a, a, a]] : [[a, b], [b, a]];
  for (const order of orders) dfs(start, order, 0, [], [], sequences);

  const maxSteps = Math.max(...sequences.map((s) => s.steps.length));
  if (maxSteps === 0) return [];
  let candidates = sequences.filter((s) => s.steps.length === maxSteps);
  if (maxSteps === 1 && a !== b) {
    const big = Math.max(a, b);
    const withBig = candidates.filter((s) => s.dice[0] === big);
    if (withBig.length > 0) candidates = withBig;
  }

  const seen = new Map<string, Play>();
  for (const seq of candidates) {
    const key = stateKey(seq.state);
    if (seen.has(key)) continue;
    seen.set(key, { steps: seq.steps, notation: formatPlay(seq.steps), result: seq.state });
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Notation

function pointName(p: number): string {
  if (p === BAR_POINT) return "bar";
  if (p === OFF_POINT) return "off";
  return String(p);
}

/**
 * gnubg-style notation: "24/18* 13/10", "8/5(2) 6/5(2)", "24/18* 18/13" (a hit keeps its landing point). Hops without a hit
 * are collapsed ("24/18 18/13" -> "24/13"); tokens are ordered by origin point, high to low.
 */
export function formatPlay(steps: MoveStep[]): string {
  interface Token {
    pts: number[];
    hits: boolean[];
  }
  const tokens: Token[] = [];
  for (const st of steps) {
    let merged = false;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      const last = t.pts.length - 1;
      if (t.pts[last] === st.from && st.from !== OFF_POINT) {
        if (t.hits[last]) {
          t.pts.push(st.to);
          t.hits.push(st.hit);
        } else {
          t.pts[last] = st.to;
          t.hits[last] = st.hit;
        }
        merged = true;
        break;
      }
    }
    if (!merged) tokens.push({ pts: [st.from, st.to], hits: [false, st.hit] });
  }
  const texts = tokens.map((t) => t.pts.map((p, i) => pointName(p) + (t.hits[i] ? "*" : "")).join("/"));
  // Group identical tokens, then order by origin point descending.
  const counts = new Map<string, { text: string; from: number; to: number; n: number }>();
  texts.forEach((text, i) => {
    const e = counts.get(text);
    if (e) e.n++;
    else counts.set(text, { text, from: tokens[i].pts[0], to: tokens[i].pts[tokens[i].pts.length - 1], n: 1 });
  });
  return [...counts.values()]
    .sort((x, y) => y.from - x.from || y.to - x.to)
    .map((e) => (e.n > 1 ? `${e.text}(${e.n})` : e.text))
    .join(" ");
}

export class NotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotationError";
  }
}

function parsePoint(raw: string): { point: number; hit: boolean } {
  let s = raw.trim().toLowerCase();
  let hit = false;
  if (s.endsWith("*")) {
    hit = true;
    s = s.slice(0, -1);
  }
  if (s === "bar" || s === "b") return { point: BAR_POINT, hit };
  if (s === "off" || s === "o") return { point: OFF_POINT, hit };
  if (!/^\d{1,2}$/.test(s)) throw new NotationError(`bad point "${raw}"`);
  const point = Number(s);
  if (point < 1 || point > 24) throw new NotationError(`point out of range "${raw}"`);
  return { point, hit };
}

/** Parse gnubg-style notation into individual checker steps (in written order). */
export function parsePlay(notation: string): MoveStep[] {
  const steps: MoveStep[] = [];
  const tokens = notation.trim().split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const m = /^(.+?)(?:\((\d+)\))?$/.exec(token);
    if (!m) throw new NotationError(`bad token "${token}"`);
    const count = m[2] ? Number(m[2]) : 1;
    if (count < 1 || count > 4) throw new NotationError(`bad repeat count in "${token}"`);
    const parts = m[1].split("/");
    if (parts.length < 2) throw new NotationError(`bad token "${token}"`);
    const pts = parts.map(parsePoint);
    if (pts[0].hit) throw new NotationError(`origin cannot be a hit in "${token}"`);
    for (let k = 1; k < pts.length; k++) {
      if (pts[k - 1].point === OFF_POINT) throw new NotationError(`cannot move from off in "${token}"`);
      if (pts[k].point === BAR_POINT) throw new NotationError(`cannot move to the bar in "${token}"`);
    }
    for (let r = 0; r < count; r++) {
      for (let k = 1; k < pts.length; k++) {
        steps.push({ from: pts[k - 1].point, to: pts[k].point, hit: pts[k].hit });
      }
    }
  }
  return steps;
}

/**
 * Apply steps mechanically (no dice check). Returns null when a step is impossible on the
 * board: nothing to move, landing on a blocked point. Hits are derived from the board, not
 * from the notation.
 */
export function applySteps(start: BoardState, steps: MoveStep[]): BoardState | null {
  const s = clone(start);
  for (const st of steps) {
    if (st.from === BAR_POINT) {
      if (s.myBar === 0) return null;
      s.myBar--;
    } else {
      if (s.points[st.from] <= 0) return null;
      s.points[st.from]--;
    }
    if (st.to === OFF_POINT) {
      s.myOff++;
    } else {
      if (s.points[st.to] < -1) return null;
      if (s.points[st.to] === -1) {
        s.points[st.to] = 1;
        s.theirBar++;
      } else {
        s.points[st.to]++;
      }
    }
  }
  return s;
}

/**
 * Is this notation a legal play for the position and dice? Legality is decided by the
 * resulting position, so equivalent notations are all accepted. An empty notation is legal
 * only when there is no legal move.
 */
export function isLegalPlay(view: PerspectiveView, dice: [number, number], notation: string): boolean {
  let steps: MoveStep[];
  try {
    steps = parsePlay(notation);
  } catch {
    return false;
  }
  const plays = generatePlays(view, dice);
  if (steps.length === 0) return plays.length === 0;
  const result = applySteps(stateFromView(view), steps);
  if (!result) return false;
  const key = stateKey(result);
  return plays.some((p) => stateKey(p.result) === key);
}
