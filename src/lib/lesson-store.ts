/**
 * data/lessons/lessons.sqlite: the Backgammon Galaxy lessons written by
 * pipeline/import_lessons.py. Server-only (node:sqlite); the app only reads it. The database,
 * the original exports and the pictures all live in data/lessons/, which is git-ignored because
 * it is Galaxy's material. Schema: lesson-store-schema.ts (also read by bgpipeline/lesson_store.py).
 */
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./lesson-store-schema";
import {
  IMAGE_FILE_RE,
  imageSrc,
  isQuizKey,
  type LessonChoice,
  type LessonImage,
  type LessonKind,
  type LessonProblem,
  type LessonSet,
  type LessonSetSummary,
} from "./lessons";
import { openStore, withReadOnlyFile, type StoreSchema } from "./store";

export const LESSON_SCHEMA: StoreSchema = { version: SCHEMA_VERSION, sql: SCHEMA_SQL };
export const LESSON_STORE_FILE = "lessons.sqlite";

export function lessonsDir(dataDir: string): string {
  return path.join(dataDir, "lessons");
}

export function lessonStorePath(dataDir: string): string {
  return path.join(lessonsDir(dataDir), LESSON_STORE_FILE);
}

export function openLessonStore(file: string, opts: { readOnly?: boolean } = {}): DatabaseSync {
  return openStore(file, { ...opts, schema: LESSON_SCHEMA });
}

type Row = Record<string, unknown>;

const text = (v: unknown): string | null => (v == null ? null : String(v));

function toImage(storedPath: unknown, md5: unknown, width: unknown, height: unknown): LessonImage | null {
  if (storedPath == null) return null;
  const src = imageSrc(String(storedPath), text(md5));
  return src ? { src, width: Number(width ?? 0), height: Number(height ?? 0) } : null;
}

/** Every imported set, in import order (the page groups and sorts them). */
export function listLessonSets(db: DatabaseSync): LessonSetSummary[] {
  const sets = db.prepare("SELECT id, site_quiz_id, name, author, collection, imported_at FROM lesson_sets ORDER BY id").all() as Row[];
  const problems = db
    .prepare("SELECT set_id, problem_id, kind, analysis IS NOT NULL AS has_analysis FROM lesson_problems ORDER BY set_id, number")
    .all() as Row[];
  const bySet = new Map<number, Row[]>();
  for (const p of problems) {
    const list = bySet.get(Number(p.set_id));
    if (list) list.push(p);
    else bySet.set(Number(p.set_id), [p]);
  }
  return sets.map((s) => {
    const list = bySet.get(Number(s.id)) ?? [];
    const checker = list.filter((p) => p.kind === "checker").length;
    return {
      key: String(s.site_quiz_id),
      name: String(s.name),
      author: text(s.author),
      collection: text(s.collection),
      problemIds: list.map((p) => String(p.problem_id)),
      checker,
      cube: list.length - checker,
      withAnalysis: list.filter((p) => Number(p.has_analysis) !== 0).length,
      importedAt: String(s.imported_at),
    };
  });
}

/** One set with its problems and choices in order, or null. */
export function getLessonSet(db: DatabaseSync, key: string): LessonSet | null {
  const s = db
    .prepare("SELECT id, site_quiz_id, name, author, collection, file_name, imported_at FROM lesson_sets WHERE site_quiz_id = ?")
    .get(key) as Row | undefined;
  if (!s) return null;
  const problemRows = db
    .prepare(
      "SELECT p.problem_id, p.number, p.kind, p.analysis, p.image, i.md5, i.width, i.height FROM lesson_problems p " +
        "LEFT JOIN lesson_images i ON i.path = p.image WHERE p.set_id = ? ORDER BY p.number",
    )
    .all(Number(s.id)) as Row[];
  const choiceRows = db
    .prepare(
      "SELECT c.problem_id, c.number, c.site_choice_id, c.answer, c.description, c.loss, c.correct, c.image, i.md5, i.width, i.height " +
        "FROM lesson_choices c JOIN lesson_problems p ON p.problem_id = c.problem_id LEFT JOIN lesson_images i ON i.path = c.image " +
        "WHERE p.set_id = ? ORDER BY p.number, c.number",
    )
    .all(Number(s.id)) as Row[];
  const choices = new Map<string, LessonChoice[]>();
  for (const c of choiceRows) {
    const choice: LessonChoice = {
      id: String(c.site_choice_id),
      number: Number(c.number),
      answer: String(c.answer),
      description: text(c.description),
      loss: c.loss == null ? null : Number(c.loss),
      correct: Number(c.correct) !== 0,
      image: toImage(c.image, c.md5, c.width, c.height),
    };
    const list = choices.get(String(c.problem_id));
    if (list) list.push(choice);
    else choices.set(String(c.problem_id), [choice]);
  }
  const problems: LessonProblem[] = problemRows.map((p) => ({
    id: String(p.problem_id),
    number: Number(p.number),
    kind: (p.kind === "cube" ? "cube" : "checker") as LessonKind,
    image: toImage(p.image, p.md5, p.width, p.height),
    analysis: text(p.analysis),
    choices: choices.get(String(p.problem_id)) ?? [],
  }));
  const checker = problems.filter((p) => p.kind === "checker").length;
  return {
    key: String(s.site_quiz_id),
    name: String(s.name),
    author: text(s.author),
    collection: text(s.collection),
    problemIds: problems.map((p) => p.id),
    checker,
    cube: problems.length - checker,
    withAnalysis: problems.filter((p) => p.analysis).length,
    importedAt: String(s.imported_at),
    fileName: String(s.file_name),
    problems,
  };
}

/** Every imported set, or [] before the first import. */
export function readLessonSets(dataDir: string): LessonSetSummary[] {
  return withReadOnlyFile(lessonStorePath(dataDir), LESSON_SCHEMA, [], listLessonSets);
}

export function readLessonSet(dataDir: string, key: string): LessonSet | null {
  if (!isQuizKey(key)) return null;
  return withReadOnlyFile(lessonStorePath(dataDir), LESSON_SCHEMA, null, (db) => getLessonSet(db, key));
}

/** The file behind /api/lessons/images/<quiz id>/<file>, or null for any name the importer
 * does not write (so nothing outside data/lessons/<quiz id>/images/ can be reached). */
export function lessonImagePath(dataDir: string, quizId: string, file: string): string | null {
  if (!isQuizKey(quizId) || !IMAGE_FILE_RE.test(file)) return null;
  const root = path.resolve(lessonsDir(dataDir));
  const full = path.resolve(root, quizId, "images", file);
  return full.startsWith(root + path.sep) ? full : null;
}
