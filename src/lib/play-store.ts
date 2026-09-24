/**
 * Matches played against gnubg in the app, in data/store.sqlite: the usual matches / games /
 * decisions rows (site 'gnubg', written as the match goes, both players' decisions) plus the
 * match in progress in play_state. Also the quiz picks (which decisions the quiz shows).
 * Server-only (node:sqlite).
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { EngineResult } from "./engine";
import type { DecisionRecord, GameState, MatchSettings } from "./game";
import { hasPlayTables, MAIN_SCHEMA, storePath, withReadOnlyFile } from "./store";

export const PLAY_SITE = "gnubg";
export const GNUBG_NAME = "gnubg";

export type PlayStatus = "playing" | "finished";

export interface PlayRecord {
  matchId: number;
  settings: MatchSettings;
  state: GameState;
  status: PlayStatus;
  /** Bumped on every save; a save with a stale version is refused. */
  version: number;
  updatedAt: string;
}

export class PlayConflictError extends Error {
  constructor(message = "the match changed in another tab; reload it") {
    super(message);
    this.name = "PlayConflictError";
  }
}

/** Run `fn` in one transaction. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** A new match row, its first game and its play_state; returns the match id. */
export function createPlayMatch(
  db: DatabaseSync,
  opts: { settings: MatchSettings; state: GameState; playerName: string; plies: number; now: string },
): number {
  const m = db
    .prepare(
      "INSERT INTO matches (site, site_match_id, player1, player2, match_length, played_at, file_name, file_sha256, mat_text, " +
        "analysed_player, engine, plies, imported_at) VALUES (?, ?, ?, ?, ?, ?, '', '', '', 1, 'gnubg', ?, ?)",
    )
    .run(PLAY_SITE, `new-${randomUUID()}`, opts.playerName, GNUBG_NAME, opts.settings.matchLength, opts.now, opts.plies, opts.now);
  const matchId = Number(m.lastInsertRowid);
  db.prepare("UPDATE matches SET site_match_id = ? WHERE id = ?").run(String(matchId), matchId);
  insertGame(db, matchId, opts.state);
  db.prepare("INSERT INTO play_state (match_id, settings, state, status, version, updated_at) VALUES (?, ?, ?, 'playing', 1, ?)").run(
    matchId,
    JSON.stringify(opts.settings),
    JSON.stringify(opts.state),
    opts.now,
  );
  return matchId;
}

/** The games row for the state's current game (at its start). */
export function insertGame(db: DatabaseSync, matchId: number, state: GameState): number {
  const r = db
    .prepare("INSERT INTO games (match_id, number, score1, score2, crawford, winner, points) VALUES (?, ?, ?, ?, ?, NULL, NULL)")
    .run(matchId, state.game, state.score[0], state.score[1], state.crawford ? 1 : 0);
  return Number(r.lastInsertRowid);
}

export function finishGame(db: DatabaseSync, matchId: number, number: number, winner: number, points: number): void {
  db.prepare("UPDATE games SET winner = ?, points = ? WHERE match_id = ? AND number = ?").run(winner, points, matchId, number);
}

export function gameId(db: DatabaseSync, matchId: number, number: number): number {
  const row = db.prepare("SELECT id FROM games WHERE match_id = ? AND number = ?").get(matchId, number) as { id: number } | undefined;
  if (!row) throw new Error(`match ${matchId} has no game ${number}`);
  return Number(row.id);
}

/** Decision ids of a match played in the app: play-<match>-g<game>-m<move>-<kind>, gnubg's with -p2. */
export function playDecisionId(matchId: number, d: Pick<DecisionRecord, "game" | "move" | "player" | "kind">): string {
  return `play-${matchId}-g${d.game}-m${d.move}${d.player === 2 ? "-p2" : ""}-${d.kind}`;
}

/** Insert one decision (the analysis is null for forced plays, which are never evaluated). */
export function insertPlayDecision(
  db: DatabaseSync,
  opts: { matchId: number; record: DecisionRecord; analysis: EngineResult | null; plies: number; now: string },
): string {
  const { matchId, record: d, analysis: a } = opts;
  const id = playDecisionId(matchId, d);
  db.prepare(
    "INSERT INTO decisions (match_id, game_id, decision_id, game_number, move_number, player, kind, xgid, dice, played, played_answer_id, " +
      "best_answer_id, best_equity, played_equity, loss, forced, position_class, categories, features, answers, plies, analysed_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    matchId,
    gameId(db, matchId, d.game),
    id,
    d.game,
    d.move,
    d.player,
    d.kind,
    d.xgid,
    d.dice ? `${d.dice[0]}${d.dice[1]}` : null,
    d.played,
    a?.playedAnswerId ?? null,
    a?.bestAnswerId ?? null,
    a?.bestEquity ?? null,
    a?.playedEquity ?? null,
    a?.loss ?? null,
    d.forced ? 1 : 0,
    a?.positionClass ?? null,
    JSON.stringify(a?.categories ?? []),
    a?.features ? JSON.stringify(a.features) : null,
    JSON.stringify(a?.answers ?? []),
    a?.plies ?? opts.plies,
    opts.now.slice(0, 10),
  );
  return id;
}

function recordFromRow(r: Record<string, unknown>): PlayRecord {
  return {
    matchId: Number(r.match_id),
    settings: JSON.parse(String(r.settings)) as MatchSettings,
    state: JSON.parse(String(r.state)) as GameState,
    status: String(r.status) as PlayStatus,
    version: Number(r.version),
    updatedAt: String(r.updated_at),
  };
}

export function loadPlay(db: DatabaseSync, matchId: number): PlayRecord | null {
  const r = db.prepare("SELECT match_id, settings, state, status, version, updated_at FROM play_state WHERE match_id = ?").get(matchId) as
    | Record<string, unknown>
    | undefined;
  return r ? recordFromRow(r) : null;
}

/** Save the state if nobody saved since `expectedVersion`; returns the new version. */
export function savePlay(db: DatabaseSync, matchId: number, state: GameState, status: PlayStatus, expectedVersion: number, now: string): number {
  const r = db
    .prepare("UPDATE play_state SET state = ?, status = ?, version = version + 1, updated_at = ? WHERE match_id = ? AND version = ?")
    .run(JSON.stringify(state), status, now, matchId, expectedVersion);
  if (Number(r.changes) !== 1) throw new PlayConflictError();
  return expectedVersion + 1;
}

/** Every match played in the app, most recently touched first. */
export function listPlays(db: DatabaseSync): PlayRecord[] {
  const rows = db.prepare("SELECT match_id, settings, state, status, version, updated_at FROM play_state ORDER BY updated_at DESC, match_id DESC").all() as Record<
    string,
    unknown
  >[];
  return rows.map(recordFromRow);
}

/** The matches played in the app, read-only; empty before the first one (or on an older store). */
export function readPlays(dir: string): PlayRecord[] {
  return withReadOnlyFile(storePath(dir), MAIN_SCHEMA, [] as PlayRecord[], (db) => (hasPlayTables(db) ? listPlays(db) : []));
}

/** Run `fn` on a read-only connection when the store has the play tables, else return `empty`. */
export function withPlayTables<T>(dir: string, empty: T, fn: (db: DatabaseSync) => T): T {
  return withReadOnlyFile(storePath(dir), MAIN_SCHEMA, empty, (db) => (hasPlayTables(db) ? fn(db) : empty));
}

// ---------------------------------------------------------------------------
// Quiz picks: the user's overrides of which decisions the quiz shows

export function setQuizPick(db: DatabaseSync, decisionId: string, included: boolean, now: string): void {
  db.prepare(
    "INSERT INTO quiz_picks (decision_id, included, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT (decision_id) DO UPDATE SET included = excluded.included, updated_at = excluded.updated_at",
  ).run(decisionId, included ? 1 : 0, now);
}
