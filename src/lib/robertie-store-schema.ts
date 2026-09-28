/**
 * Schema of data/robertie/robertie.sqlite: Bill Robertie's "501 Essential Backgammon Problems",
 * read from the user's scan by pipeline/import_robertie.py. Same rules as store-schema.ts: no
 * imports, and the Python pipeline (bgpipeline/robertie_store.py) reads SCHEMA_VERSION,
 * ADDED_COLUMNS and SCHEMA_SQL out of this file with regular expressions, so keep all three
 * simple literals (nothing inside the SQL that a template literal would interpret: no backtick,
 * dollar-brace or backslash).
 *
 * A separate, git-ignored file on purpose: everything from the book (Robertie's text, his
 * answers, the numbered positions) stays on this machine, while store.sqlite is committed to a
 * public repository. For the same reason the explanations and translations of book problems
 * live here, in tables that are exact copies of store.sqlite's (a test keeps the two copies
 * equal), and never in store.sqlite.
 *
 * Tables the importer owns (a re-import rewrites them): robertie_source, robertie_chapters,
 * robertie_problems, robertie_analyses. Tables the app owns (the importer never touches them):
 * explanations, translations and robertie_translations (only ever inserted), robertie_reports
 * (a problem reported as misread; resolved_at is set when it is dealt with). Keys: a problem is
 * its number in the book, problem_id "robertie-<n>" is its quiz id; analyses are kept per depth,
 * and the app uses the deepest. Image columns name files under data/robertie/: diagram "s003-L-1"
 * is diagrams/s003-L-1.png, a page "s003-L" is pages/s003-L.jpg.
 */
export const SCHEMA_VERSION = 1;

/** Columns added after a table was first created, one per line: table, column, type. */
export const ADDED_COLUMNS = `
`;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS robertie_source (
  id INTEGER PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  pages INTEGER NOT NULL,
  imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS robertie_chapters (
  number INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  first_problem INTEGER,
  last_problem INTEGER,
  categories TEXT NOT NULL,
  intro_page TEXT
);

CREATE TABLE IF NOT EXISTS robertie_problems (
  number INTEGER PRIMARY KEY,
  problem_id TEXT NOT NULL UNIQUE,
  chapter INTEGER,
  kind TEXT NOT NULL,
  caption TEXT NOT NULL,
  dice TEXT,
  problem_page TEXT,
  diagram TEXT,
  solution_pages TEXT NOT NULL,
  solution TEXT,
  solution_sha256 TEXT,
  play_as_printed TEXT,
  cube_verdict TEXT,
  book_answer TEXT,
  reading_status TEXT NOT NULL,
  reading_issues TEXT NOT NULL,
  reading_local TEXT,
  reading_claude TEXT,
  fix TEXT,
  xgid TEXT,
  imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS robertie_analyses (
  number INTEGER NOT NULL,
  plies INTEGER NOT NULL,
  engine TEXT NOT NULL,
  analysed_at TEXT NOT NULL,
  position_class TEXT,
  categories TEXT NOT NULL,
  features TEXT,
  answers TEXT NOT NULL,
  best_answer_id TEXT NOT NULL,
  book_answer_id TEXT,
  book_loss REAL,
  book_full_depth INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  PRIMARY KEY (number, plies)
);

CREATE TABLE IF NOT EXISTS robertie_reports (
  id INTEGER PRIMARY KEY,
  number INTEGER NOT NULL,
  note TEXT,
  reported_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS robertie_translations (
  id INTEGER PRIMARY KEY,
  number INTEGER NOT NULL,
  solution_sha256 TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS robertie_translations_number ON robertie_translations (number, language, id);

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
  effort TEXT,
  language TEXT
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
`;
