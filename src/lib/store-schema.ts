/**
 * Schema of data/store.sqlite. Kept free of imports so a plain Node script can import it too,
 * and the Python pipeline (bgpipeline/store.py) reads SCHEMA_VERSION, SCHEMA_SQL and
 * ADDED_COLUMNS out of this file with regular expressions: keep all three simple literals.
 *
 * Every version so far is additive (v2 added the match tables, v3 play_state and quiz_picks, v4
 * explanations.effort, v5 translations), so upgrading a file means running the DDL, adding
 * ADDED_COLUMNS that are missing and bumping meta.schema_version; both store.ts and store.py do
 * that. Bump SCHEMA_VERSION when a table changes shape; a new column goes in its CREATE TABLE
 * (new files) and in ADDED_COLUMNS (older files).
 *
 * Explanations and their translations (the Hebrew text shown under each explanation, one row
 * per request, keyed by the explanation's row id) are only ever inserted. Imported match rows
 * are reproducible engine output, so a re-import may delete and rewrite one match's games and
 * decisions. Matches played against gnubg in the app (site 'gnubg') are written by the app as
 * they are played, with the game in progress in play_state; they are never deleted. quiz_picks
 * holds the user's own choices about which decisions the quiz shows, one row per decision,
 * updated in place.
 */
export const SCHEMA_VERSION = 5;

/**
 * Columns added to a table after it was first created. CREATE TABLE IF NOT EXISTS leaves an
 * older file's table as it is, so a writable open adds each missing one with ALTER TABLE ...
 * ADD COLUMN. One per line: table, column, type (nullable, no default).
 */
export const ADDED_COLUMNS = `
explanations effort TEXT
`;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS explanations (
  id INTEGER PRIMARY KEY,
  xgid TEXT NOT NULL,
  problem_id TEXT NOT NULL,
  requested_model TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  prompt_sha256 TEXT NOT NULL,
  explanation TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  request_id TEXT,
  served_by_fallback INTEGER NOT NULL DEFAULT 0,
  effort TEXT
);

CREATE INDEX IF NOT EXISTS explanations_xgid ON explanations (xgid, id);

CREATE TABLE IF NOT EXISTS translations (
  id INTEGER PRIMARY KEY,
  explanation_id INTEGER NOT NULL,
  language TEXT NOT NULL,
  requested_model TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  prompt_sha256 TEXT NOT NULL,
  text TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  request_id TEXT,
  served_by_fallback INTEGER NOT NULL DEFAULT 0,
  effort TEXT
);

CREATE INDEX IF NOT EXISTS translations_explanation ON translations (explanation_id, language, id);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  site TEXT NOT NULL,
  site_match_id TEXT NOT NULL,
  player1 TEXT NOT NULL,
  player2 TEXT NOT NULL,
  match_length INTEGER NOT NULL,
  played_at TEXT,
  file_name TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  mat_text TEXT NOT NULL,
  analysed_player INTEGER NOT NULL,
  engine TEXT NOT NULL,
  plies INTEGER NOT NULL,
  imported_at TEXT NOT NULL,
  UNIQUE (site, site_match_id)
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL,
  number INTEGER NOT NULL,
  score1 INTEGER NOT NULL,
  score2 INTEGER NOT NULL,
  crawford INTEGER NOT NULL DEFAULT 0,
  winner INTEGER,
  points INTEGER,
  UNIQUE (match_id, number)
);

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL,
  game_id INTEGER NOT NULL,
  decision_id TEXT NOT NULL UNIQUE,
  game_number INTEGER NOT NULL,
  move_number INTEGER NOT NULL,
  player INTEGER NOT NULL,
  kind TEXT NOT NULL,
  xgid TEXT NOT NULL,
  dice TEXT,
  played TEXT NOT NULL,
  played_answer_id TEXT,
  best_answer_id TEXT,
  best_equity REAL,
  played_equity REAL,
  loss REAL,
  forced INTEGER NOT NULL DEFAULT 0,
  position_class TEXT,
  categories TEXT NOT NULL,
  features TEXT,
  answers TEXT NOT NULL,
  plies INTEGER NOT NULL,
  analysed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS decisions_match ON decisions (match_id, game_number, move_number);

CREATE TABLE IF NOT EXISTS play_state (
  match_id INTEGER PRIMARY KEY,
  settings TEXT NOT NULL,
  state TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quiz_picks (
  decision_id TEXT PRIMARY KEY,
  included INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
`;
