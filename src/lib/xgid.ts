/**
 * XGID (eXtreme Gammon position ID) parsing and formatting.
 *
 *   [XGID=]<pos>:<cube>:<owner>:<turn>:<dice>:<score1>:<score2>:<cj>:<len>:<maxcube>
 *
 * pos     26 chars. Index 0 = player 2 bar, 1..24 = points numbered from player 1
 *         (1 = player 1 ace point), 25 = player 1 bar. A..P = 1..16 player-1 checkers,
 *         a..p = player-2 checkers, "-" = empty. Borne-off checkers are implied
 *         (15 minus what is on the board).
 * cube    log2 of the cube value (0 -> 1, 1 -> 2, ...)
 * owner   1 = player 1, -1 = player 2, 0 = centered
 * turn    1 = player 1 on roll, -1 = player 2
 * dice    "00" = not rolled (cube decision pending), "NN" = rolled, "D" = the turn player
 *         has doubled and the opponent must take/pass, "B" = beaver, "R" = raccoon
 * score1  player 1 score (absolute, not perspective dependent)
 * score2  player 2 score
 * cj      match play: 1 = Crawford game. Money (len 0): bit 0 = Jacoby, bit 1 = beavers
 * len     match length, 0 = money
 * maxcube log2 of the maximum cube
 */

export type Player = 1 | 2;
export type CubeOwner = Player | "center";
export type CubeAction = "none" | "double" | "beaver" | "raccoon";

export const CHECKERS_PER_SIDE = 15;
export const BOARD_LEN = 26;
/** Board index of player 2 bar. */
export const P2_BAR = 0;
/** Board index of player 1 bar. */
export const P1_BAR = 25;

export interface Position {
  /**
   * Length 26, signed: +n = n player-1 checkers, -n = n player-2 checkers.
   * board[0] = player 2 bar (<= 0), board[1..24] = points from player 1 view,
   * board[25] = player 1 bar (>= 0).
   */
  board: number[];
  /** 1, 2, 4, ... */
  cubeValue: number;
  cubeOwner: CubeOwner;
  turn: Player;
  /** null when not rolled (cube decision / cube offered). Order as written in the XGID. */
  dice: [number, number] | null;
  cubeAction: CubeAction;
  /** [player 1, player 2] */
  score: [number, number];
  /** 0 = money play */
  matchLength: number;
  /** Match play only. */
  crawford: boolean;
  /** Money play only. */
  jacoby: boolean;
  /** Money play only. */
  beavers: boolean;
  /** 1024 etc. */
  maxCube: number;
}

export class XgidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XgidError";
  }
}

/** Trims whitespace and removes a leading "XGID=" (case-insensitive). */
export function stripXgidPrefix(input: string): string {
  const s = input.trim();
  return s.replace(/^xgid=/i, "");
}

function parseIntField(field: string, name: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!/^-?\d+$/.test(field)) {
    throw new XgidError(`${name}: expected an integer, got "${field}"`);
  }
  const n = Number(field);
  if (n < min || n > max) {
    throw new XgidError(`${name}: ${n} is out of range [${min}, ${max}]`);
  }
  return n;
}

function parseBoard(pos: string): number[] {
  if (pos.length !== BOARD_LEN) {
    throw new XgidError(`position must be ${BOARD_LEN} characters, got ${pos.length}`);
  }
  const board: number[] = new Array(BOARD_LEN).fill(0);
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < BOARD_LEN; i++) {
    const ch = pos[i];
    if (ch === "-") continue;
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 80) {
      const n = code - 64;
      board[i] = n;
      p1 += n;
    } else if (code >= 97 && code <= 112) {
      const n = code - 96;
      board[i] = -n;
      p2 += n;
    } else {
      throw new XgidError(`invalid character "${ch}" at position index ${i}`);
    }
  }
  if (board[P2_BAR] > 0) {
    throw new XgidError("index 0 is the player 2 bar; it cannot hold player 1 checkers");
  }
  if (board[P1_BAR] < 0) {
    throw new XgidError("index 25 is the player 1 bar; it cannot hold player 2 checkers");
  }
  if (p1 > CHECKERS_PER_SIDE) {
    throw new XgidError(`player 1 has ${p1} checkers on the board (max ${CHECKERS_PER_SIDE})`);
  }
  if (p2 > CHECKERS_PER_SIDE) {
    throw new XgidError(`player 2 has ${p2} checkers on the board (max ${CHECKERS_PER_SIDE})`);
  }
  return board;
}

export function parseXgid(input: string): Position {
  const s = stripXgidPrefix(input);
  const fields = s.split(":");
  if (fields.length !== 10) {
    throw new XgidError(`expected 10 colon-separated fields, got ${fields.length}`);
  }
  const [pos, cubeF, ownerF, turnF, diceF, s1F, s2F, cjF, lenF, maxF] = fields;

  const board = parseBoard(pos);

  const cubeExp = parseIntField(cubeF, "cube", 0, 30);
  const ownerN = parseIntField(ownerF, "cube owner", -1, 1);
  const turnN = parseIntField(turnF, "turn", -1, 1);
  if (turnN === 0) throw new XgidError("turn must be 1 or -1");

  let dice: [number, number] | null = null;
  let cubeAction: CubeAction = "none";
  const d = diceF.toUpperCase();
  if (d === "" || d === "00") {
    // not rolled
  } else if (d === "D") {
    cubeAction = "double";
  } else if (d === "B") {
    cubeAction = "beaver";
  } else if (d === "R") {
    cubeAction = "raccoon";
  } else if (/^[1-6]{2}$/.test(d)) {
    dice = [Number(d[0]), Number(d[1])];
  } else {
    throw new XgidError(`dice: expected 00, two digits 1-6, D, B or R, got "${diceF}"`);
  }

  const score1 = parseIntField(s1F, "score 1", 0);
  const score2 = parseIntField(s2F, "score 2", 0);
  const cj = parseIntField(cjF, "crawford/jacoby", 0, 3);
  const matchLength = parseIntField(lenF, "match length", 0);
  const maxExp = parseIntField(maxF, "max cube", 0, 30);

  const isMatch = matchLength > 0;
  return {
    board,
    cubeValue: 2 ** cubeExp,
    cubeOwner: ownerN === 0 ? "center" : ownerN === 1 ? 1 : 2,
    turn: turnN === 1 ? 1 : 2,
    dice,
    cubeAction,
    score: [score1, score2],
    matchLength,
    crawford: isMatch && (cj & 1) === 1,
    jacoby: !isMatch && (cj & 1) === 1,
    beavers: !isMatch && (cj & 2) === 2,
    maxCube: 2 ** maxExp,
  };
}

function log2Exact(n: number, name: string): number {
  const e = Math.log2(n);
  if (!Number.isInteger(e) || e < 0) {
    throw new XgidError(`${name}: ${n} is not a power of two`);
  }
  return e;
}

function formatBoard(board: number[]): string {
  if (board.length !== BOARD_LEN) {
    throw new XgidError(`board must have ${BOARD_LEN} entries, got ${board.length}`);
  }
  let out = "";
  for (let i = 0; i < BOARD_LEN; i++) {
    const v = board[i];
    if (v === 0) {
      out += "-";
    } else if (v > 0) {
      if (v > 16) throw new XgidError(`too many checkers (${v}) at index ${i}`);
      out += String.fromCharCode(64 + v);
    } else {
      if (v < -16) throw new XgidError(`too many checkers (${-v}) at index ${i}`);
      out += String.fromCharCode(96 - v);
    }
  }
  return out;
}

export function toXgid(pos: Position): string {
  const board = formatBoard(pos.board);
  const cube = log2Exact(pos.cubeValue, "cube");
  const owner = pos.cubeOwner === "center" ? 0 : pos.cubeOwner === 1 ? 1 : -1;
  const turn = pos.turn === 1 ? 1 : -1;

  let dice: string;
  if (pos.dice) {
    dice = `${pos.dice[0]}${pos.dice[1]}`;
  } else if (pos.cubeAction === "double") {
    dice = "D";
  } else if (pos.cubeAction === "beaver") {
    dice = "B";
  } else if (pos.cubeAction === "raccoon") {
    dice = "R";
  } else {
    dice = "00";
  }

  const cj = pos.matchLength > 0 ? (pos.crawford ? 1 : 0) : (pos.jacoby ? 1 : 0) | (pos.beavers ? 2 : 0);
  const maxCube = log2Exact(pos.maxCube, "max cube");

  return [board, cube, owner, turn, dice, pos.score[0], pos.score[1], cj, pos.matchLength, maxCube].join(":");
}
