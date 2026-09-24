/**
 * Playing a match against gnubg. One request = one action of the user: the rules check it, the
 * engine grades it, then gnubg plays (and the user's automatic steps happen: a roll when the cube
 * is not theirs to turn, forced plays, dances) until the user has something to decide again or
 * the game ends. Engine calls come first; every row is then written in one short transaction.
 * Server-only. The engine, the dice and the clock are injected, so tests can script a game.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Engine, EngineResult } from "./engine";
import {
  actor,
  applyAction,
  cubeAvailable,
  GNUBG,
  legalPlays,
  newMatch,
  nextGame,
  RuleError,
  USER,
  type Action,
  type DecisionRecord,
  type GameEnd,
  type GameState,
  type MatchSettings,
} from "./game";
import { toMatchDecision, type MatchDecision } from "./matches";
import {
  createPlayMatch,
  finishGame,
  insertGame,
  insertPlayDecision,
  loadPlay,
  PlayConflictError,
  savePlay,
  transaction,
  type PlayStatus,
} from "./play-store";
import { ratePlayer, type PlayerRating } from "./pr";
import { inQuiz } from "./mistakes";
import { getDecision, latestExplanations, listDecisions, readQuizPicks, type DecisionRow } from "./store";
import { toXgid, type Player } from "./xgid";

export interface PlayDeps {
  db: DatabaseSync;
  engine: Engine;
  /** Two dice. */
  roll: () => [number, number];
  /** Local ISO date-time (no zone), as stored for imported matches. */
  now: () => string;
  plies: number;
}

export type UserAction =
  | { type: "roll" }
  | { type: "double" }
  | { type: "take" }
  | { type: "pass" }
  | { type: "move"; play: string }
  | { type: "next-game" }
  | { type: "end" };

export type PlayEvent =
  | { type: "opening"; game: number; dice: [number, number]; first: Player }
  | { type: "roll"; player: Player; dice: [number, number] }
  | { type: "move"; player: Player; play: string; forced: boolean; xgid: string }
  | { type: "no-move"; player: Player; dice: [number, number] }
  | { type: "double"; player: Player; cube: number }
  | { type: "take"; player: Player }
  | { type: "pass"; player: Player }
  | { type: "game-over"; winner: Player; points: number; how: GameEnd; matchOver: boolean };

/** One line of the game log. */
export interface LogEntry {
  decisionId: string;
  player: Player;
  move: number;
  kind: DecisionRow["kind"];
  dice: string | null;
  played: string;
  forced: boolean;
  loss: number | null;
}

export interface PlayView {
  matchId: number;
  version: number;
  status: PlayStatus;
  state: GameState;
  /** What happened during this request, in order (empty for a plain load). */
  events: PlayEvent[];
  /** The user's decisions graded during this request (a cube decision and/or a play). */
  graded: MatchDecision[];
  /** The last checker play of the current game (either side), to mark on the board. */
  lastMove: { player: Player; play: string; xgid: string } | null;
  /** Every decision of the current game, in order. */
  log: LogEntry[];
  /** PR per player, [user, gnubg], for this game and for the match so far. */
  ratings: { game: [PlayerRating, PlayerRating]; match: [PlayerRating, PlayerRating] };
}

export class PlayError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "PlayError";
  }
}

type Write =
  | { type: "game"; state: GameState }
  | { type: "decision"; record: DecisionRecord; analysis: EngineResult | null }
  | { type: "finish"; game: number; winner: Player; points: number };

/** A turn in progress: the state plus everything to store and report. */
class Turn {
  writes: Write[] = [];
  events: PlayEvent[] = [];
  constructor(
    public state: GameState,
    readonly deps: PlayDeps,
  ) {}

  apply(action: Action, analysis: EngineResult | null = null): DecisionRecord | undefined {
    const before = this.state;
    const r = applyAction(before, action);
    this.state = r.state;
    if (r.decision) this.writes.push({ type: "decision", record: r.decision, analysis });
    const player = actor(before)!;
    switch (action.type) {
      case "roll":
        this.events.push({ type: "roll", player, dice: action.dice });
        break;
      case "double":
        this.events.push({ type: "double", player, cube: before.position.cubeValue * 2 });
        break;
      case "take":
      case "pass":
        this.events.push({ type: action.type, player });
        break;
      case "move":
        if (r.decision && r.decision.played === "") this.events.push({ type: "no-move", player, dice: before.position.dice! });
        else if (r.decision) this.events.push({ type: "move", player, play: r.decision.played, forced: r.decision.forced, xgid: r.decision.xgid });
        break;
    }
    const ph = this.state.phase;
    if (ph.kind === "game-over") {
      this.writes.push({ type: "finish", game: this.state.game, winner: ph.winner, points: ph.points });
      this.events.push({ type: "game-over", winner: ph.winner, points: ph.points, how: ph.how, matchOver: ph.matchOver });
    }
    return r.decision;
  }

  startGame(state: GameState) {
    this.state = state;
    this.writes.push({ type: "game", state });
    this.events.push({ type: "opening", game: state.game, dice: state.opening, first: state.phase.kind === "move" ? state.phase.player : 1 });
  }
}

/** Two dice that differ: [player 1's die, player 2's die]. */
export function rollOpening(roll: () => [number, number]): [number, number] {
  for (;;) {
    const [a, b] = roll();
    if (a !== b) return [a, b];
  }
}

function analyseUser(engine: Engine, rec: DecisionRecord | undefined): Promise<EngineResult | null> {
  if (!rec || rec.forced) return Promise.resolve(null);
  return engine.analyse({ xgid: rec.xgid, played: rec.played });
}

/** gnubg's turns and the user's automatic steps, until the user decides or the game ends. */
async function advance(t: Turn): Promise<void> {
  const { engine, roll } = t.deps;
  for (;;) {
    const ph = t.state.phase;
    if (ph.kind === "game-over") return;
    const pos = t.state.position;
    const p = ph.player;
    if (ph.kind === "pre-roll") {
      if (!cubeAvailable(pos, p)) {
        t.apply({ type: "roll", dice: roll() });
        continue;
      }
      if (p === USER) return;
      const a = await engine.analyse({ xgid: toXgid(pos) });
      if (a.best === "double") t.apply({ type: "double" }, a);
      else t.apply({ type: "roll", dice: roll() }, a);
      continue;
    }
    if (ph.kind === "take") {
      if (p === USER) return;
      const a = await engine.analyse({ xgid: toXgid(pos) });
      t.apply({ type: a.best === "pass" ? "pass" : "take" }, a);
      continue;
    }
    // move
    const plays = legalPlays(t.state);
    if (p === USER && plays.length > 1) return;
    if (plays.length <= 1) {
      t.apply({ type: "move", play: plays[0]?.notation ?? "" });
      continue;
    }
    const a = await engine.analyse({ xgid: toXgid(pos) });
    t.apply({ type: "move", play: a.best }, a);
  }
}

/** Fill in the user's analyses (the rules already recorded the decision). */
async function gradeUser(t: Turn, rec: DecisionRecord | undefined): Promise<void> {
  if (!rec) return;
  const analysis = await analyseUser(t.deps.engine, rec);
  const w = t.writes.find((x) => x.type === "decision" && x.record === rec);
  if (w && w.type === "decision") w.analysis = analysis;
}

function persist(deps: PlayDeps, matchId: number, t: Turn, status: PlayStatus, expectedVersion: number): { version: number; gradedIds: string[] } {
  const now = deps.now();
  const gradedIds: string[] = [];
  const version = transaction(deps.db, () => {
    for (const w of t.writes) {
      if (w.type === "game") insertGame(deps.db, matchId, w.state);
      else if (w.type === "finish") finishGame(deps.db, matchId, w.game, w.winner, w.points);
      else {
        const id = insertPlayDecision(deps.db, { matchId, record: w.record, analysis: w.analysis, plies: deps.plies, now });
        if (w.record.player === USER && w.analysis) gradedIds.push(id);
      }
    }
    return savePlay(deps.db, matchId, t.state, status, expectedVersion, now);
  });
  return { version, gradedIds };
}

function statusOf(state: GameState, ended: boolean): PlayStatus {
  return ended || (state.phase.kind === "game-over" && state.phase.matchOver) ? "finished" : "playing";
}

/** The client's view of a match: state, log and PR (graded / events filled by the caller). */
export function playView(db: DatabaseSync, matchId: number): PlayView {
  const rec = loadPlay(db, matchId);
  if (!rec) throw new PlayError(`no match ${matchId}`, 404);
  const rows = listDecisions(db, matchId);
  const gameRows = rows.filter((r) => r.gameNumber === rec.state.game);
  const lastChecker = [...gameRows].reverse().find((r) => r.kind === "checker" && r.played !== "");
  const rate = (list: DecisionRow[]): [PlayerRating, PlayerRating] => [ratePlayer(list, USER), ratePlayer(list, GNUBG)];
  return {
    matchId,
    version: rec.version,
    status: rec.status,
    state: rec.state,
    events: [],
    graded: [],
    lastMove: lastChecker ? { player: lastChecker.player as Player, play: lastChecker.played, xgid: lastChecker.xgid } : null,
    log: gameRows.map((r) => ({
      decisionId: r.decisionId,
      player: r.player as Player,
      move: r.moveNumber,
      kind: r.kind,
      dice: r.dice,
      played: r.played,
      forced: r.forced,
      loss: r.loss,
    })),
    ratings: { game: rate(gameRows), match: rate(rows) },
  };
}

/** Start a match; if gnubg wins the opening roll it plays its first move straight away. */
export async function startPlayMatch(deps: PlayDeps, settings: MatchSettings, playerName: string): Promise<PlayView> {
  const state = newMatch(settings, rollOpening(deps.roll));
  const matchId = transaction(deps.db, () => createPlayMatch(deps.db, { settings, state, playerName, plies: deps.plies, now: deps.now() }));
  const t = new Turn(state, deps);
  t.events.push({ type: "opening", game: 1, dice: state.opening, first: state.phase.kind === "move" ? state.phase.player : 1 });
  await advance(t);
  const { version } = persist(deps, matchId, t, statusOf(t.state, false), 1);
  return { ...playView(deps.db, matchId), version, events: t.events };
}

/** One action of the user. `expectedVersion` is the version the client last saw. */
export async function playAction(deps: PlayDeps, matchId: number, action: UserAction, expectedVersion: number): Promise<PlayView> {
  const rec = loadPlay(deps.db, matchId);
  if (!rec) throw new PlayError(`no match ${matchId}`, 404);
  if (rec.version !== expectedVersion) throw new PlayConflictError();
  if (rec.status === "finished") throw new PlayError("this match is finished");
  const t = new Turn(rec.state, deps);
  const ph = rec.state.phase;
  const mine = actor(rec.state) === USER;
  let ended = false;
  try {
    switch (action.type) {
      case "next-game":
        if (ph.kind !== "game-over") throw new PlayError("the game is not over");
        t.startGame(nextGame(rec.state, rollOpening(deps.roll)));
        break;
      case "end":
        if (ph.kind !== "game-over") throw new PlayError("finish the game first");
        ended = true;
        break;
      case "roll":
        if (!mine || ph.kind !== "pre-roll") throw new PlayError("not your roll");
        await gradeUser(t, t.apply({ type: "roll", dice: deps.roll() }));
        break;
      case "double":
        if (!mine || ph.kind !== "pre-roll") throw new PlayError("you cannot double now");
        await gradeUser(t, t.apply({ type: "double" }));
        break;
      case "take":
      case "pass":
        if (!mine || ph.kind !== "take") throw new PlayError("there is no double to answer");
        await gradeUser(t, t.apply({ type: action.type }));
        break;
      case "move":
        if (!mine || ph.kind !== "move") throw new PlayError("not your move");
        await gradeUser(t, t.apply({ type: "move", play: action.play }));
        break;
      default:
        throw new PlayError("unknown action");
    }
  } catch (e) {
    if (e instanceof RuleError) throw new PlayError(e.message);
    throw e;
  }
  if (!ended) await advance(t);
  const { version, gradedIds } = persist(deps, matchId, t, statusOf(t.state, ended), expectedVersion);
  const explanations = latestExplanations(deps.db);
  const picks = readQuizPicks(deps.db);
  const graded = gradedIds
    .map((id) => getDecision(deps.db, id))
    .filter((r): r is DecisionRow => r !== null)
    .map((r) => ({ ...toMatchDecision(r, explanations), inQuiz: inQuiz(r, USER, picks) }));
  return { ...playView(deps.db, matchId), version, events: t.events, graded };
}
