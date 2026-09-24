/**
 * Schema of data/lessons/lessons.sqlite, the imported Backgammon Galaxy lessons. Same rules as
 * store-schema.ts: no imports, and the Python pipeline (bgpipeline/lesson_store.py) reads the two
 * constants below out of this file with a regular expression, so keep both as simple literals
 * (nothing inside the SQL that a template literal would interpret: no backtick, dollar-brace or
 * backslash).
 *
 * A separate file from data/store.sqlite on purpose: the lessons are Galaxy's material, so all of
 * data/lessons/ (this database, the original exports and their pictures) is git-ignored, while
 * store.sqlite is committed. Lesson rows are a copy of an export, so a re-import may delete and
 * rewrite one set (the only delete in this database). Bump the version when a table changes
 * shape and write the migration in lesson-store.ts and lesson_store.py.
 *
 * Keys are Galaxy's own ids, so they survive a rebuilt database: a set is its Galaxy quiz id
 * (site_quiz_id, also the URL /lessons/<id> and the folder name), a problem is
 * "lesson-<galaxy problem id>" (the progress key in localStorage). Image columns hold paths
 * relative to data/lessons/ with forward slashes: "<quiz id>/images/p01.png" is problem 1's
 * position, "<quiz id>/images/p01-c2.png" the position after its choice 2.
 */
export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lesson_sets (
  id INTEGER PRIMARY KEY,
  site TEXT NOT NULL,
  site_quiz_id TEXT NOT NULL,
  name TEXT NOT NULL,
  author TEXT,
  collection TEXT,
  problem_count INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  UNIQUE (site, site_quiz_id)
);

CREATE TABLE IF NOT EXISTS lesson_problems (
  id INTEGER PRIMARY KEY,
  set_id INTEGER NOT NULL,
  problem_id TEXT NOT NULL UNIQUE,
  number INTEGER NOT NULL,
  site_problem_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  image TEXT NOT NULL,
  analysis TEXT,
  UNIQUE (set_id, number)
);

CREATE TABLE IF NOT EXISTS lesson_choices (
  id INTEGER PRIMARY KEY,
  problem_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  site_choice_id TEXT NOT NULL,
  answer TEXT NOT NULL,
  description TEXT,
  loss REAL,
  correct INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  UNIQUE (problem_id, number)
);

CREATE TABLE IF NOT EXISTS lesson_images (
  path TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  md5 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL
);
`;
