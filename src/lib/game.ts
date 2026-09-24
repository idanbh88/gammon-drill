/**
 * Match rules for playing gnubg: turns, the cube, bearing off, gammons and backgammons, the
 * Jacoby and Crawford rules and the match score. Pure and client-safe: dice come in with the
 * action (the server rolls), so tests can script any game. Player 1 is always the user.
 *
 * Decisions are recorded the way the match importer records them (pipeline/bgpipeline/replay.py):
 * the XGID before the decision with the deciding player to act, checker plays in canonical
 * notation ("" for a dance), a pre-roll cube decision whenever the cube is available, and the
 * answer to a double as kind "take".
 */
import { opponent, toPerspective, withState } from "./board";
import { applySteps, generatePlays, parsePlay, stateFromView, stateKey, type Play } from "./moves";
import { parseXgid, toXgid, type Player, type Position } from "./xgid";

export const USER: Player = 1;
export const GNUBG: Player = 2;

const OPENING_BOARD = parseXgid("-b----E-C---eE---c-e----B-:0:0:1:00:0:0:0:0:10").board;
const MAX_CUBE = 1024;

export interface MatchSettings {
  /** 0 = money session. */
  matchLength: number;
  /** Money only: gammons and backgammons count only once the cube has been turned. */
  jacoby: boolean;
}

export type GameEnd = "single" | "gammon" | "backgammon" | "pass";

export type Phase =
  /** Roll, or double when the cube is available. */
  | { kind: "pre-roll"; player: Player }
  /** Play the dice in `position.dice`. */
  | { kind: "move"; player: Player }
  /** Take or pass the double in `position` (dice "D"). */
  | { kind: "take"; player: Player }
  | { kind: "game-over"; winner: Player; points: number; how: GameEnd; matchOver: boolean };

export interface GameState {
  settings: MatchSettings;
  game: number;
  /** Score at the start of this game, [player 1, player 2]. */
  score: [number, number];
  crawford: boolean;
  /** The Crawford game has been played, so later games are post-Crawford. */
  crawfordDone: boolean;
  position: Position;
  phase: Phase;
  /** Move number within the game, .mat style: each of player 1's turns starts a new number. */
  move: number;
  /** Turns started in this game. */
  turns: number;
  /** The opening roll, [player 1's die, player 2's die]. */
  opening: [number, number];
}

export type Action =
  | { type: "roll"; dice: [number, number] }
  | { type: "double" }
  | { type: "take" }
  | { type: "pass" }
  | { type: "move"; play: string };

export type DecisionKind = "checker" | "cube" | "take";

export interface DecisionRecord {
  player: Player;
  kind: DecisionKind;
  /** The position before the decision, with the deciding player to act. */
  xgid: string;
  dice: [number, number] | null;
  /** Canonical notation ("" for no legal move), double / no-double, or take / pass. */
  played: string;
  /** No choice (0 or 1 legal plays): recorded, never analysed. */
  forced: boolean;
  game: number;
  move: number;
}

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

function checkDie(d: number): void {
  if (!Number.isInteger(d) || d < 1 || d > 6) throw new RuleError(`bad die ${d}`);
}

/**
 * Whether `p` may double before rolling (the port of replay.cube_live): not the Crawford game,
 * the cube centred or theirs, below the limit, and in a match a double could still matter to them.
 */
export function cubeAvailable(pos: Position, p: Player): boolean {
  if (pos.matchLength > 0 && pos.crawford) return false;
  if (pos.cubeOwner !== "center" && pos.cubeOwner !== p) return false;
  if (pos.cubeValue >= pos.maxCube) return false;
  if (pos.matchLength > 0 && pos.score[p - 1] + pos.cubeValue >= pos.matchLength) return false;
  return true;
}

/** The player who has to act, or null when the game is over. */
export function actor(state: GameState): Player | null {
  return state.phase.kind === "game-over" ? null : state.phase.player;
}

/** Legal plays for the move phase (empty = no legal move). */
export function legalPlays(state: GameState): Play[] {
  if (state.phase.kind !== "move" || !state.position.dice) return [];
  return generatePlays(toPerspective(state.position, state.phase.player), state.position.dice);
}

/**
 * A new game. `opening` is [player 1's die, player 2's die] and must not be a tie: the higher
 * die moves first with both numbers.
 */
export function startGame(
  settings: MatchSettings,
  game: number,
  score: [number, number],
  crawford: boolean,
  crawfordDone: boolean,
  opening: [number, number],
): GameState {
  checkDie(opening[0]);
  checkDie(opening[1]);
  if (opening[0] === opening[1]) throw new RuleError("the opening roll cannot be a tie");
  const first: Player = opening[0] > opening[1] ? 1 : 2;
  const isMatch = settings.matchLength > 0;
  const position: Position = {
    board: OPENING_BOARD.slice(),
    cubeValue: 1,
    cubeOwner: "center",
    turn: first,
    dice: [Math.max(...opening), Math.min(...opening)],
    cubeAction: "none",
    score: [score[0], score[1]],
    matchLength: settings.matchLength,
    crawford: isMatch && crawford,
    jacoby: !isMatch && settings.jacoby,
    beavers: false,
    maxCube: MAX_CUBE,
  };
  return { settings, game, score, crawford: isMatch && crawford, crawfordDone, position, phase: { kind: "move", player: first }, move: 1, turns: 1, opening };
}

export function newMatch(settings: MatchSettings, opening: [number, number]): GameState {
  if (!Number.isInteger(settings.matchLength) || settings.matchLength < 0) throw new RuleError("bad match length");
  return startGame(settings, 1, [0, 0], false, false, opening);
}

/** The score after the current game (the start score while it is still being played). */
export function scoreAfter(state: GameState): [number, number] {
  const s: [number, number] = [state.score[0], state.score[1]];
  if (state.phase.kind === "game-over") s[state.phase.winner - 1] += state.phase.points;
  return s;
}

/** The next game of the match or money session, after a finished one. */
export function nextGame(state: GameState, opening: [number, number]): GameState {
  if (state.phase.kind !== "game-over") throw new RuleError("the game is not over");
  if (state.phase.matchOver) throw new RuleError("the match is over");
  const score = scoreAfter(state);
  const len = state.settings.matchLength;
  let crawford = false;
  let crawfordDone = state.crawfordDone;
  if (len > 0 && !crawfordDone && (score[0] === len - 1) !== (score[1] === len - 1)) {
    crawford = true;
    crawfordDone = true;
  }
  return startGame(state.settings, state.game + 1, score, crawford, crawfordDone, opening);
}

function decision(state: GameState, player: Player, kind: DecisionKind, pos: Position, played: string, forced = false): DecisionRecord {
  return { player, kind, xgid: toXgid(pos), dice: pos.dice, played, forced, game: state.game, move: state.move };
}

function passTurn(state: GameState, pos: Position): GameState {
  const next = opponent(pos.turn);
  return {
    ...state,
    position: { ...pos, turn: next, dice: null, cubeAction: "none" },
    phase: { kind: "pre-roll", player: next },
    turns: state.turns + 1,
    move: next === 1 ? state.move + 1 : state.move,
  };
}

function gameOver(state: GameState, pos: Position, winner: Player, points: number, how: GameEnd): GameState {
  const len = state.settings.matchLength;
  const matchOver = len > 0 && state.score[winner - 1] + points >= len;
  return { ...state, position: pos, phase: { kind: "game-over", winner, points, how, matchOver } };
}

/** How a bear-off win counts: single, gammon (the loser has none off) or backgammon (and still
 * has a checker on the bar or in the winner's home board). */
export function winKind(pos: Position, winner: Player): Exclude<GameEnd, "pass"> {
  const loser = toPerspective(pos, opponent(winner));
  if (loser.myOff > 0) return "single";
  if (loser.myBar > 0) return "backgammon";
  for (let p = 19; p <= 24; p++) if (loser.points[p] > 0) return "backgammon";
  return "gammon";
}

/** Points for a bear-off win: the cube times 1, 2 or 3; with Jacoby an unturned cube counts single. */
export function winPoints(pos: Position, how: Exclude<GameEnd, "pass">): number {
  const multiplier = how === "backgammon" ? 3 : how === "gammon" ? 2 : 1;
  if (pos.matchLength === 0 && pos.jacoby && pos.cubeOwner === "center") return pos.cubeValue;
  return pos.cubeValue * multiplier;
}

/** Apply one action of the player who has to act. Throws RuleError when it is not allowed. */
export function applyAction(state: GameState, action: Action): { state: GameState; decision?: DecisionRecord } {
  const { phase, position: pos } = state;
  switch (phase.kind) {
    case "game-over":
      throw new RuleError("the game is over");

    case "pre-roll": {
      const p = phase.player;
      if (action.type === "roll") {
        checkDie(action.dice[0]);
        checkDie(action.dice[1]);
        const rec = cubeAvailable(pos, p) ? decision(state, p, "cube", pos, "no-double") : undefined;
        return { state: { ...state, position: { ...pos, dice: [action.dice[0], action.dice[1]] }, phase: { kind: "move", player: p } }, decision: rec };
      }
      if (action.type === "double") {
        if (!cubeAvailable(pos, p)) throw new RuleError("the cube is not available");
        const rec = decision(state, p, "cube", pos, "double");
        return { state: { ...state, position: { ...pos, cubeAction: "double" }, phase: { kind: "take", player: opponent(p) } }, decision: rec };
      }
      throw new RuleError(`cannot ${action.type} before rolling`);
    }

    case "take": {
      const r = phase.player;
      const doubler = pos.turn;
      if (action.type === "take") {
        const rec = decision(state, r, "take", pos, "take");
        const taken: Position = { ...pos, cubeValue: pos.cubeValue * 2, cubeOwner: r, cubeAction: "none" };
        return { state: { ...state, position: taken, phase: { kind: "pre-roll", player: doubler } }, decision: rec };
      }
      if (action.type === "pass") {
        const rec = decision(state, r, "take", pos, "pass");
        return { state: gameOver(state, { ...pos, cubeAction: "none" }, doubler, pos.cubeValue, "pass"), decision: rec };
      }
      throw new RuleError(`cannot ${action.type} when a double is offered`);
    }

    case "move": {
      if (action.type !== "move") throw new RuleError(`cannot ${action.type} after rolling`);
      const p = phase.player;
      const plays = legalPlays(state);
      const text = action.play.trim();
      if (plays.length === 0) {
        if (text !== "") throw new RuleError("there is no legal move");
        return { state: passTurn(state, pos), decision: decision(state, p, "checker", pos, "", true) };
      }
      let matched: Play | undefined;
      try {
        const result = applySteps(stateFromView(toPerspective(pos, p)), parsePlay(text));
        const key = result ? stateKey(result) : null;
        matched = plays.find((pl) => stateKey(pl.result) === key);
      } catch {
        matched = undefined;
      }
      if (!matched) throw new RuleError(`illegal play "${text}"`);
      const rec = decision(state, p, "checker", pos, matched.notation, plays.length === 1);
      const after = withState(pos, p, matched.result);
      if (toPerspective(after, p).myOff === 15) {
        const how = winKind(after, p);
        return { state: gameOver(state, { ...after, dice: null }, p, winPoints(after, how), how), decision: rec };
      }
      return { state: passTurn(state, after), decision: rec };
    }
  }
}
