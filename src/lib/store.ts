/**
 * The SQLite store (`data/store.sqlite`): generated explanations, and the matches, games and
 * decisions written by the match importer (pipeline/import_match.py). Server-only
 * (node:sqlite); do not import from client components.
 *
 * Explanations are only ever inserted, so nothing generated is lost. Match rows are written
 * by Python; the app only reads them. Connections are short-lived (open, query, close). The
 * loader opens read-only and skips the overlay when the file does not exist yet; the first
 * write creates it, and a writable open upgrades an older file (every version is additive).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Answer, Problem } from "@/types/problem";
import { explanationMeta } from "./matches";
import { mistakeProblems, type MistakeRow } from "./mistakes";
import { ratePlayer, type PlayerRating, type RatedDecision } from "./pr";
import { ADDED_COLUMNS, SCHEMA_SQL, SCHEMA_VERSION } from "./store-schema";

export const STORE_FILE = "store.sqlite";

export function storePath(dir: string): string {
  return path.join(dir, STORE_FILE);
}

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}

export interface ExplanationRow {
  id: number;
  xgid: string;
  problemId: string;
  /** The model asked for. */
  requestedModel: string;
  /** The model that produced the text (differs from requestedModel after a server-side fallback). */
  model: string;
  promptVersion: string;
  promptSha256: string;
  explanation: string;
  /** The model's text before cleaning, so the cleaning can be redone. */
  rawText: string;
  /** ISO 8601 date-time. */
  generatedAt: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  requestId: string | null;
  servedByFallback: boolean;
  /** output_config.effort sent with the request; null for rows written before schema v4. */
  effort: string | null;
}

export type NewExplanation = Omit<ExplanationRow, "id">;

export interface MatchRow {
  id: number;
  site: string;
  siteMatchId: string;
  player1: string;
  player2: string;
  /** 0 = money session. */
  matchLength: number;
  /** ISO date-time when known. */
  playedAt: string | null;
  fileName: string;
  fileSha256: string;
  /** 1 or 2: whose decisions were analysed. */
  analysedPlayer: number;
  engine: string;
  plies: number;
  importedAt: string;
}

export interface GameRow {
  id: number;
  matchId: number;
  number: number;
  /** Score at the start of the game. */
  score1: number;
  score2: number;
  crawford: boolean;
  winner: number | null;
  points: number | null;
}

export type DecisionKind = "checker" | "cube" | "take";

export interface DecisionRow {
  id: number;
  matchId: number;
  gameId: number;
  /** Stable id, e.g. "match-45552673-g1-m7-checker"; explanations record it as problem_id. */
  decisionId: string;
  gameNumber: number;
  moveNumber: number;
  player: number;
  kind: DecisionKind;
  /** The position before the decision; the analysed player is the acting player. */
  xgid: string;
  dice: string | null;
  /** Checker: canonical notation (empty for a dance). Cube: double / no-double. Take: take / pass. */
  played: string;
  /** The answer id matching the play, when the engine ranked it. */
  playedAnswerId: string | null;
  bestAnswerId: string | null;
  bestEquity: number | null;
  playedEquity: number | null;
  /** Equity lost by the play; null when forced or not scored. */
  loss: number | null;
  forced: boolean;
  positionClass: string | null;
  categories: string[];
  features: Record<string, number | boolean | string> | null;
  /** Ranked answers, best first; empty when forced. */
  answers: Answer[];
  plies: number;
  analysedAt: string;
}

export interface MatchSummary {
  matchId: number;
  /** Decisions the engine evaluated (forced ones excluded). */
  decisions: number;
  forced: number;
  errors: number;
  blunders: number;
  totalLoss: number;
}

export interface Thresholds {
  error: number;
  blunder: number;
}

/** A database layout this module can open: its version, the DDL that creates it, and columns added to tables later. */
export interface StoreSchema {
  version: number;
  sql: string;
  /** Lines of "table column type" (see ADDED_COLUMNS in store-schema.ts). */
  addedColumns?: string;
}

/** data/store.sqlite (store-schema.ts). The lessons database has its own (lesson-store.ts). */
export const MAIN_SCHEMA: StoreSchema = { version: SCHEMA_VERSION, sql: SCHEMA_SQL, addedColumns: ADDED_COLUMNS };

export function parseAddedColumns(text: string | undefined): { table: string; column: string; type: string }[] {
  return (text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [table, column, ...type] = l.split(/\s+/);
      return { table, column, type: type.join(" ") };
    });
}

export function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

/** How long a statement waits for a lock: the Python importers write while pages read. */
const BUSY_TIMEOUT_MS = 5000;

export function openStore(file: string, opts: { readOnly?: boolean; schema?: StoreSchema } = {}): DatabaseSync {
  const readOnly = opts.readOnly ?? false;
  const schema = opts.schema ?? MAIN_SCHEMA;
  if (readOnly && !existsSync(file)) throw new StoreError(`${file}: no store file`);
  const db = new DatabaseSync(file, { readOnly, timeout: BUSY_TIMEOUT_MS });
  try {
    if (!readOnly) {
      db.exec(schema.sql);
      // CREATE TABLE IF NOT EXISTS leaves an older table as it was: add the columns it lacks.
      for (const c of parseAddedColumns(schema.addedColumns)) {
        if (!hasColumn(db, c.table, c.column)) db.exec(`ALTER TABLE ${c.table} ADD COLUMN ${c.column} ${c.type}`);
      }
      db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(schema.version));
    }
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
    if (!row) throw new StoreError(`${file}: not a store (no schema_version)`);
    let version = Number(row.value);
    if (!readOnly && version >= 1 && version < schema.version) {
      // Additive versions: the DDL above already created the newer tables.
      db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(schema.version));
      version = schema.version;
    }
    if (!Number.isInteger(version) || version < 1 || version > schema.version) {
      throw new StoreError(`${file}: schema version ${row.value}, this build expects ${schema.version}`);
    }
  } catch (e) {
    db.close();
    throw e;
  }
  return db;
}

/** The file's schema version (an older file opened read-only keeps its own). */
export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
  return row ? Number(row.value) : 0;
}

const BASE_COLUMNS =
  "id, xgid, problem_id, requested_model, model, prompt_version, prompt_sha256, explanation, raw_text, generated_at, " +
  "input_tokens, output_tokens, cache_read_tokens, request_id, served_by_fallback";

/** The explanation columns to select; a file opened read-only before its v4 upgrade has no effort. */
function explanationColumns(db: DatabaseSync): string {
  return BASE_COLUMNS + (hasColumn(db, "explanations", "effort") ? ", effort" : ", NULL AS effort");
}

function fromRow(r: Record<string, unknown>): ExplanationRow {
  return {
    id: Number(r.id),
    xgid: String(r.xgid),
    problemId: String(r.problem_id),
    requestedModel: String(r.requested_model),
    model: String(r.model),
    promptVersion: String(r.prompt_version),
    promptSha256: String(r.prompt_sha256),
    explanation: String(r.explanation),
    rawText: String(r.raw_text),
    generatedAt: String(r.generated_at),
    inputTokens: r.input_tokens == null ? null : Number(r.input_tokens),
    outputTokens: r.output_tokens == null ? null : Number(r.output_tokens),
    cacheReadTokens: r.cache_read_tokens == null ? null : Number(r.cache_read_tokens),
    requestId: r.request_id == null ? null : String(r.request_id),
    servedByFallback: Number(r.served_by_fallback) !== 0,
    effort: r.effort == null ? null : String(r.effort),
  };
}

/** Append one explanation; returns its row id. */
export function insertExplanation(db: DatabaseSync, e: NewExplanation): number {
  const result = db
    .prepare(
      "INSERT INTO explanations (xgid, problem_id, requested_model, model, prompt_version, prompt_sha256, explanation, raw_text, " +
        "generated_at, input_tokens, output_tokens, cache_read_tokens, request_id, served_by_fallback, effort) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      e.xgid,
      e.problemId,
      e.requestedModel,
      e.model,
      e.promptVersion,
      e.promptSha256,
      e.explanation,
      e.rawText,
      e.generatedAt,
      e.inputTokens,
      e.outputTokens,
      e.cacheReadTokens,
      e.requestId,
      e.servedByFallback ? 1 : 0,
      e.effort,
    );
  return Number(result.lastInsertRowid);
}

/** The newest explanation per XGID. */
export function latestExplanations(db: DatabaseSync): Map<string, ExplanationRow> {
  const rows = db
    .prepare(`SELECT ${explanationColumns(db)} FROM explanations e WHERE e.id = (SELECT MAX(id) FROM explanations WHERE xgid = e.xgid)`)
    .all() as Record<string, unknown>[];
  return new Map(rows.map((r) => [String(r.xgid), fromRow(r)]));
}

/** Every stored explanation for one position, newest first. */
export function explanationHistory(db: DatabaseSync, xgid: string): ExplanationRow[] {
  const rows = db.prepare(`SELECT ${explanationColumns(db)} FROM explanations WHERE xgid = ? ORDER BY id DESC`).all(xgid) as Record<string, unknown>[];
  return rows.map(fromRow);
}

export function countExplanations(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM explanations").get() as { n: number | bigint };
  return Number(row.n);
}

/** The latest stored explanation per XGID, or an empty map when there is no store file. */
export function readLatestExplanations(dir: string): Map<string, ExplanationRow> {
  const file = storePath(dir);
  if (!existsSync(file)) return new Map();
  const db = openStore(file, { readOnly: true });
  try {
    return latestExplanations(db);
  } finally {
    db.close();
  }
}

/** Overlay stored explanations onto problems: a store row wins over the JSON field. */
export function applyStore(problems: Problem[], latest: Map<string, ExplanationRow>): Problem[] {
  return problems.map((p) => {
    const row = latest.get(p.xgid);
    if (!row) return p;
    return { ...p, explanation: row.explanation, explanationMeta: explanationMeta(row) };
  });
}

// ---------------------------------------------------------------------------
// Matches (written by pipeline/import_match.py, read here)

const MATCH_COLUMNS =
  "id, site, site_match_id, player1, player2, match_length, played_at, file_name, file_sha256, analysed_player, engine, plies, imported_at";

function matchFromRow(r: Record<string, unknown>): MatchRow {
  return {
    id: Number(r.id),
    site: String(r.site),
    siteMatchId: String(r.site_match_id),
    player1: String(r.player1),
    player2: String(r.player2),
    matchLength: Number(r.match_length),
    playedAt: r.played_at == null ? null : String(r.played_at),
    fileName: String(r.file_name),
    fileSha256: String(r.file_sha256),
    analysedPlayer: Number(r.analysed_player),
    engine: String(r.engine),
    plies: Number(r.plies),
    importedAt: String(r.imported_at),
  };
}

function gameFromRow(r: Record<string, unknown>): GameRow {
  return {
    id: Number(r.id),
    matchId: Number(r.match_id),
    number: Number(r.number),
    score1: Number(r.score1),
    score2: Number(r.score2),
    crawford: Number(r.crawford) !== 0,
    winner: r.winner == null ? null : Number(r.winner),
    points: r.points == null ? null : Number(r.points),
  };
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

const DECISION_COLUMNS =
  "id, match_id, game_id, decision_id, game_number, move_number, player, kind, xgid, dice, played, played_answer_id, " +
  "best_answer_id, best_equity, played_equity, loss, forced, position_class, categories, features, answers, plies, analysed_at";

function decisionFromRow(r: Record<string, unknown>): DecisionRow {
  return {
    id: Number(r.id),
    matchId: Number(r.match_id),
    gameId: Number(r.game_id),
    decisionId: String(r.decision_id),
    gameNumber: Number(r.game_number),
    moveNumber: Number(r.move_number),
    player: Number(r.player),
    kind: String(r.kind) as DecisionKind,
    xgid: String(r.xgid),
    dice: r.dice == null ? null : String(r.dice),
    played: String(r.played),
    playedAnswerId: r.played_answer_id == null ? null : String(r.played_answer_id),
    bestAnswerId: r.best_answer_id == null ? null : String(r.best_answer_id),
    bestEquity: r.best_equity == null ? null : Number(r.best_equity),
    playedEquity: r.played_equity == null ? null : Number(r.played_equity),
    loss: r.loss == null ? null : Number(r.loss),
    forced: Number(r.forced) !== 0,
    positionClass: r.position_class == null ? null : String(r.position_class),
    categories: parseJson<string[]>(r.categories, []),
    features: parseJson<Record<string, number | boolean | string> | null>(r.features, null),
    answers: parseJson<Answer[]>(r.answers, []),
    plies: Number(r.plies),
    analysedAt: String(r.analysed_at),
  };
}

function hasMatchTables(db: DatabaseSync): boolean {
  return schemaVersion(db) >= 2;
}

/** Imported matches, newest import first. */
export function listMatches(db: DatabaseSync): MatchRow[] {
  if (!hasMatchTables(db)) return [];
  const rows = db.prepare(`SELECT ${MATCH_COLUMNS} FROM matches ORDER BY id DESC`).all() as Record<string, unknown>[];
  return rows.map(matchFromRow);
}

export function getMatch(db: DatabaseSync, id: number): MatchRow | null {
  if (!hasMatchTables(db)) return null;
  const row = db.prepare(`SELECT ${MATCH_COLUMNS} FROM matches WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? matchFromRow(row) : null;
}

export function listGames(db: DatabaseSync, matchId: number): GameRow[] {
  const rows = db
    .prepare("SELECT id, match_id, number, score1, score2, crawford, winner, points FROM games WHERE match_id = ? ORDER BY number")
    .all(matchId) as Record<string, unknown>[];
  return rows.map(gameFromRow);
}

/** Every game of every match, grouped by match id. */
export function listAllGames(db: DatabaseSync): Map<number, GameRow[]> {
  if (!hasMatchTables(db)) return new Map();
  const rows = db.prepare("SELECT id, match_id, number, score1, score2, crawford, winner, points FROM games ORDER BY match_id, number").all() as Record<
    string,
    unknown
  >[];
  const out = new Map<number, GameRow[]>();
  for (const r of rows) {
    const g = gameFromRow(r);
    const list = out.get(g.matchId);
    if (list) list.push(g);
    else out.set(g.matchId, [g]);
  }
  return out;
}

/** Every decision of a match in playing order. */
export function listDecisions(db: DatabaseSync, matchId: number): DecisionRow[] {
  const rows = db
    .prepare(`SELECT ${DECISION_COLUMNS} FROM decisions WHERE match_id = ? ORDER BY game_number, move_number, id`)
    .all(matchId) as Record<string, unknown>[];
  return rows.map(decisionFromRow);
}

export function getDecision(db: DatabaseSync, decisionId: string): DecisionRow | null {
  if (!hasMatchTables(db)) return null;
  const row = db.prepare(`SELECT ${DECISION_COLUMNS} FROM decisions WHERE decision_id = ?`).get(decisionId) as
    | Record<string, unknown>
    | undefined;
  return row ? decisionFromRow(row) : null;
}

/** Per-match counts of the analysed player's (the user's) evaluated decisions, errors and blunders. */
export function matchSummaries(db: DatabaseSync, t: Thresholds): Map<number, MatchSummary> {
  if (!hasMatchTables(db)) return new Map();
  const rows = db
    .prepare(
      "SELECT d.match_id AS match_id, " +
        "SUM(CASE WHEN d.forced = 0 THEN 1 ELSE 0 END) AS decisions, " +
        "SUM(CASE WHEN d.forced <> 0 THEN 1 ELSE 0 END) AS forced, " +
        "SUM(CASE WHEN d.loss >= ? THEN 1 ELSE 0 END) AS errors, " +
        "SUM(CASE WHEN d.loss >= ? THEN 1 ELSE 0 END) AS blunders, " +
        "COALESCE(SUM(d.loss), 0) AS total_loss " +
        "FROM decisions d JOIN matches m ON m.id = d.match_id WHERE d.player = m.analysed_player GROUP BY d.match_id",
    )
    .all(t.error, t.blunder) as Record<string, unknown>[];
  return new Map(
    rows.map((r) => [
      Number(r.match_id),
      {
        matchId: Number(r.match_id),
        decisions: Number(r.decisions),
        forced: Number(r.forced),
        errors: Number(r.errors),
        blunders: Number(r.blunders),
        totalLoss: Math.round(Number(r.total_loss) * 1e4) / 1e4,
      },
    ]),
  );
}

/** Run `fn` on a short read-only connection to `file`, or return `empty` when there is no file yet. */
export function withReadOnlyFile<T>(file: string, schema: StoreSchema, empty: T, fn: (db: DatabaseSync) => T): T {
  if (!existsSync(file)) return empty;
  const db = openStore(file, { readOnly: true, schema });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function withReadOnly<T>(dir: string, empty: T, fn: (db: DatabaseSync) => T): T {
  return withReadOnlyFile(storePath(dir), MAIN_SCHEMA, empty, fn);
}

export function readMatches(
  dir: string,
  t: Thresholds,
): { matches: MatchRow[]; summaries: Map<number, MatchSummary>; games: Map<number, GameRow[]> } {
  return withReadOnly(dir, { matches: [], summaries: new Map<number, MatchSummary>(), games: new Map<number, GameRow[]>() }, (db) => ({
    matches: listMatches(db),
    summaries: matchSummaries(db, t),
    games: listAllGames(db),
  }));
}

export function readMatch(dir: string, id: number): { match: MatchRow; games: GameRow[]; decisions: DecisionRow[] } | null {
  return withReadOnly(dir, null, (db) => {
    const match = getMatch(db, id);
    if (!match) return null;
    return { match, games: listGames(db, id), decisions: listDecisions(db, id) };
  });
}

export function readDecision(dir: string, decisionId: string): DecisionRow | null {
  return withReadOnly(dir, null, (db) => getDecision(db, decisionId));
}

// ---------------------------------------------------------------------------
// PR, the mistake deck and matches played in the app (schema v3)

/** play_state and quiz_picks exist from schema version 3 on. */
export function hasPlayTables(db: DatabaseSync): boolean {
  return schemaVersion(db) >= 3;
}

/** PR per match for [the analysed player (the user), the opponent]; the opponent's is only
 * meaningful where their decisions were analysed (matches played against gnubg). */
export function matchRatings(db: DatabaseSync): Map<number, [PlayerRating, PlayerRating]> {
  if (!hasMatchTables(db)) return new Map();
  const rows = db
    .prepare(
      "SELECT d.match_id AS match_id, d.player AS player, d.kind AS kind, d.played AS played, d.forced AS forced, d.loss AS loss, " +
        "d.answers AS answers, m.analysed_player AS analysed FROM decisions d JOIN matches m ON m.id = d.match_id",
    )
    .all() as Record<string, unknown>[];
  const byMatch = new Map<number, { analysed: number; list: RatedDecision[] }>();
  for (const r of rows) {
    const id = Number(r.match_id);
    let entry = byMatch.get(id);
    if (!entry) byMatch.set(id, (entry = { analysed: Number(r.analysed), list: [] }));
    entry.list.push({
      player: Number(r.player),
      kind: String(r.kind) as DecisionKind,
      played: String(r.played),
      forced: Number(r.forced) !== 0,
      loss: r.loss == null ? null : Number(r.loss),
      answers: parseJson<Answer[]>(r.answers, []),
    });
  }
  const out = new Map<number, [PlayerRating, PlayerRating]>();
  for (const [id, { analysed, list }] of byMatch) out.set(id, [ratePlayer(list, analysed), ratePlayer(list, analysed === 1 ? 2 : 1)]);
  return out;
}

/** The user's scored decisions that can become quiz problems: every error, and anything picked. */
export function mistakeRows(db: DatabaseSync, minLoss: number): MistakeRow[] {
  if (!hasMatchTables(db)) return [];
  const picked = hasPlayTables(db) ? "OR d.decision_id IN (SELECT decision_id FROM quiz_picks WHERE included <> 0)" : "";
  const cols = DECISION_COLUMNS.split(", ")
    .map((c) => `d.${c} AS ${c}`)
    .join(", ");
  const rows = db
    .prepare(
      `SELECT ${cols}, m.site AS site, m.player1 AS player1, m.player2 AS player2, m.played_at AS played_at, m.analysed_player AS analysed ` +
        `FROM decisions d JOIN matches m ON m.id = d.match_id ` +
        `WHERE d.player = m.analysed_player AND d.forced = 0 AND d.loss IS NOT NULL AND (d.loss >= ? ${picked}) ` +
        `ORDER BY m.id DESC, d.game_number, d.move_number, d.id`,
    )
    .all(minLoss) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...decisionFromRow(r),
    site: String(r.site),
    opponent: Number(r.analysed) === 1 ? String(r.player2) : String(r.player1),
    playedAt: r.played_at == null ? null : String(r.played_at),
    userPlayer: Number(r.analysed),
  }));
}

/** decision id -> in the quiz (true) or taken out (false); empty before schema v3. */
export function readQuizPicks(db: DatabaseSync): Map<string, boolean> {
  if (!hasPlayTables(db)) return new Map();
  const rows = db.prepare("SELECT decision_id, included FROM quiz_picks").all() as { decision_id: string; included: number }[];
  return new Map(rows.map((r) => [String(r.decision_id), Number(r.included) !== 0]));
}

/** The quiz's "My mistakes" problems, or none when there is no store yet. */
export function readMistakeProblems(dir: string, minLoss: number): Problem[] {
  return withReadOnly(dir, [] as Problem[], (db) => mistakeProblems(mistakeRows(db, minLoss), readQuizPicks(db), latestExplanations(db)));
}

export function readMatchRatings(dir: string): Map<number, [PlayerRating, PlayerRating]> {
  return withReadOnly(dir, new Map<number, [PlayerRating, PlayerRating]>(), (db) => matchRatings(db));
}
