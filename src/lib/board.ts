/**
 * Perspective helpers: everything the renderer and the move generator see goes through
 * `toPerspective`, which re-numbers the absolute XGID board from one player's point of view.
 */
import { BOARD_LEN, CHECKERS_PER_SIDE, P1_BAR, P2_BAR, type Player, type Position } from "./xgid";

export const BAR_POINT = 25;
export const OFF_POINT = 0;

export interface PerspectiveView {
  me: Player;
  them: Player;
  /**
   * Length 25. points[i] for i in 1..24 = my point i (1 = my ace point, 24 = my farthest point).
   * +n = n of my checkers, -n = n of theirs. points[0] is unused (always 0).
   */
  points: number[];
  myBar: number;
  theirBar: number;
  myOff: number;
  theirOff: number;
  myPips: number;
  theirPips: number;
}

export function opponent(p: Player): Player {
  return p === 1 ? 2 : 1;
}

export function toPerspective(pos: Position, me: Player): PerspectiveView {
  const points: number[] = new Array(25).fill(0);
  let myBar: number;
  let theirBar: number;
  if (me === 1) {
    for (let i = 1; i <= 24; i++) points[i] = pos.board[i];
    myBar = pos.board[P1_BAR];
    theirBar = 0 - pos.board[P2_BAR];
  } else {
    for (let i = 1; i <= 24; i++) points[i] = 0 - pos.board[25 - i];
    myBar = 0 - pos.board[P2_BAR];
    theirBar = pos.board[P1_BAR];
  }
  return finishView(me, points, myBar, theirBar);
}

/**
 * The position with the board replaced by `state` (a board state in `me`'s numbering, as
 * produced by the move generator). Inverse of `toPerspective` + `stateFromView`; every other
 * field of `pos` is kept.
 */
export function withState(
  pos: Position,
  me: Player,
  state: { points: number[]; myBar: number; theirBar: number },
): Position {
  const board: number[] = new Array(BOARD_LEN).fill(0);
  if (me === 1) {
    for (let i = 1; i <= 24; i++) board[i] = state.points[i];
    board[P1_BAR] = state.myBar;
    board[P2_BAR] = 0 - state.theirBar;
  } else {
    for (let i = 1; i <= 24; i++) board[25 - i] = 0 - state.points[i];
    board[P2_BAR] = 0 - state.myBar;
    board[P1_BAR] = state.theirBar;
  }
  return { ...pos, board };
}

/** Build a view directly from counts (handy for tests and the pipeline). */
export function viewFromCounts(spec: {
  me?: Player;
  mine?: Record<number, number>;
  theirs?: Record<number, number>;
  myBar?: number;
  theirBar?: number;
}): PerspectiveView {
  const points: number[] = new Array(25).fill(0);
  for (const [k, n] of Object.entries(spec.mine ?? {})) {
    const p = Number(k);
    if (p < 1 || p > 24) throw new Error(`bad point ${k}`);
    points[p] += n;
  }
  for (const [k, n] of Object.entries(spec.theirs ?? {})) {
    const p = Number(k);
    if (p < 1 || p > 24) throw new Error(`bad point ${k}`);
    if (points[p] > 0) throw new Error(`point ${k} has checkers of both players`);
    points[p] -= n;
  }
  return finishView(spec.me ?? 1, points, spec.myBar ?? 0, spec.theirBar ?? 0);
}

function finishView(me: Player, points: number[], myBar: number, theirBar: number): PerspectiveView {
  let mine = myBar;
  let theirs = theirBar;
  let myPips = BAR_POINT * myBar;
  let theirPips = BAR_POINT * theirBar;
  for (let i = 1; i <= 24; i++) {
    const v = points[i];
    if (v > 0) {
      mine += v;
      myPips += v * i;
    } else if (v < 0) {
      theirs += -v;
      theirPips += -v * (25 - i);
    }
  }
  return {
    me,
    them: opponent(me),
    points,
    myBar,
    theirBar,
    myOff: CHECKERS_PER_SIDE - mine,
    theirOff: CHECKERS_PER_SIDE - theirs,
    myPips,
    theirPips,
  };
}

/** Pip counts for [player 1, player 2], independent of perspective. */
export function pipCounts(pos: Position): [number, number] {
  const v = toPerspective(pos, 1);
  return [v.myPips, v.theirPips];
}

/** Checkers on the board (points + bar) for [player 1, player 2]. */
export function checkersOnBoard(pos: Position): [number, number] {
  const v = toPerspective(pos, 1);
  return [CHECKERS_PER_SIDE - v.myOff, CHECKERS_PER_SIDE - v.theirOff];
}

export type DecisionKind = "checker" | "cube-double" | "cube-take";

/** What the acting player has to decide in this position. */
export function decisionKind(pos: Position): DecisionKind {
  if (pos.dice) return "checker";
  if (pos.cubeAction === "double" || pos.cubeAction === "beaver" || pos.cubeAction === "raccoon") {
    return "cube-take";
  }
  return "cube-double";
}

/**
 * The player who has to act. This is the player on roll, except when a double has been
 * offered (dice "D"), where the opponent must take or pass. For a beaver the original doubler
 * decides again; for a raccoon the beaverer decides again.
 */
export function actingPlayer(pos: Position): Player {
  switch (pos.cubeAction) {
    case "double":
      return opponent(pos.turn);
    case "beaver":
      return pos.turn;
    case "raccoon":
      return opponent(pos.turn);
    default:
      return pos.turn;
  }
}

/** Names used in the UI: Blue is always the acting player (drawn at the bottom). */
export const ME_NAME = "Blue";
export const THEM_NAME = "White";

export function questionText(pos: Position): string {
  switch (decisionKind(pos)) {
    case "checker":
      return `${ME_NAME} to play ${pos.dice![0]}${pos.dice![1]}`;
    case "cube-double":
      return `${ME_NAME} on roll. Cube action?`;
    case "cube-take": {
      // Assumption: the cube field holds the value *before* the double (XG convention);
      // verify against gnubg output in Phase 2.
      const to = pos.cubeValue * 2;
      const verb = pos.cubeOwner === "center" ? "doubles" : "redoubles";
      return `${THEM_NAME} ${verb} to ${to}. Take or pass?`;
    }
  }
}

/** Score / match line, from the acting player's point of view. */
export function scoreCaption(pos: Position, me: Player = actingPlayer(pos)): string {
  if (pos.matchLength === 0) {
    const parts = ["Money game"];
    if (pos.jacoby) parts.push("Jacoby");
    if (pos.beavers) parts.push("Beavers");
    return parts.join(" · ");
  }
  const myScore = me === 1 ? pos.score[0] : pos.score[1];
  const theirScore = me === 1 ? pos.score[1] : pos.score[0];
  const parts = [`${pos.matchLength}-point match`, `${ME_NAME} ${myScore} – ${THEM_NAME} ${theirScore}`];
  if (pos.crawford) parts.push("Crawford");
  return parts.join(" · ");
}

/** The board as seen by the player who has to act (Blue). */
export function actingView(pos: Position): PerspectiveView {
  return toPerspective(pos, actingPlayer(pos));
}
