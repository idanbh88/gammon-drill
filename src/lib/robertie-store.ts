/**
 * data/robertie/robertie.sqlite: Robertie's "501 Essential Backgammon Problems" as
 * pipeline/import_robertie.py wrote it (schema: robertie-store-schema.ts). Server-only
 * (node:sqlite). Pages read it with short read-only connections and work without the file (a
 * clone of the public repository has none: the whole folder is git-ignored). The app writes only
 * its own tables: explanations and translations of book problems (never into store.sqlite),
 * translations of Robertie's text, and reports of misread boards.
 */
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CATEGORIES, POSITION_CLASSES, type Answer, type Category, type PositionClass, type Problem } from "@/types/problem";
import { storedExplanationFields } from "./matches";
import { ADDED_COLUMNS, SCHEMA_SQL, SCHEMA_VERSION } from "./robertie-store-schema";
import {
  AGREEMENTS,
  agreementOf,
  BOOK_NAME,
  DIAGRAM_RE,
  PAGE_RE,
  robertieNumber,
  type BoardCheck,
  type BookText,
  type ChapterSummary,
  type Disagreement,
  type ImageKind,
} from "./robertie";
import { latestExplanations, openStore, withReadOnlyFile, type StoreSchema } from "./store";

export const ROBERTIE_SCHEMA: StoreSchema = { version: SCHEMA_VERSION, sql: SCHEMA_SQL, addedColumns: ADDED_COLUMNS };
export const ROBERTIE_STORE_FILE = "robertie.sqlite";

export function robertieDir(dataDir: string): string {
  return path.join(dataDir, "robertie");
}

export function robertieStorePath(dataDir: string): string {
  return path.join(robertieDir(dataDir), ROBERTIE_STORE_FILE);
}

export function openRobertieStore(dataDir: string, opts: { readOnly?: boolean } = {}): DatabaseSync {
  return openStore(robertieStorePath(dataDir), { ...opts, schema: ROBERTIE_SCHEMA });
}

function read<T>(dataDir: string, empty: T, fn: (db: DatabaseSync) => T): T {
  return withReadOnlyFile(robertieStorePath(dataDir), ROBERTIE_SCHEMA, empty, fn);
}

type Row = Record<string, unknown>;

const json = <T>(v: unknown, fallback: T): T => {
  if (v == null) return fallback;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
};

const categoriesOf = (raw: string[]): Category[] => raw.filter((c): c is Category => (CATEGORIES as readonly string[]).includes(c));
const positionClassOf = (raw: unknown): PositionClass | undefined =>
  typeof raw === "string" && (POSITION_CLASSES as readonly string[]).includes(raw) ? (raw as PositionClass) : undefined;

/**
 * Problems a page may show: read and checked (status ok or fixed), analysed, and not reported
 * as misread since their last fix. Each comes with its deepest analysis.
 */
const PLAYABLE_SQL = `
  SELECT p.number, p.problem_id, p.chapter, p.kind, p.caption, p.xgid, p.fix, c.title AS chapter_title,
         a.plies, a.analysed_at, a.position_class, a.categories, a.features, a.answers, a.best_answer_id,
         a.book_answer_id, a.book_loss
  FROM robertie_problems p
  JOIN robertie_analyses a ON a.number = p.number
       AND a.plies = (SELECT MAX(plies) FROM robertie_analyses WHERE number = p.number)
  LEFT JOIN robertie_chapters c ON c.number = p.chapter
  WHERE p.reading_status IN ('ok', 'fixed') AND p.xgid IS NOT NULL AND a.book_answer_id IS NOT NULL AND a.book_loss IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM robertie_reports r WHERE r.number = p.number AND r.resolved_at IS NULL)
`;

function toProblem(r: Row, explanations: ReturnType<typeof latestExplanations>): Problem | null {
  const answers = json<Answer[]>(r.answers, []);
  const bookId = String(r.book_answer_id);
  if (answers.length < 2 || !answers.some((a) => a.id === bookId)) return null;
  const loss = Number(r.book_loss);
  const xgid = String(r.xgid);
  const stored = explanations.get(xgid);
  const problem: Problem = {
    id: String(r.problem_id),
    xgid,
    type: r.kind === "cube" ? "cube" : "checker",
    answers,
    categories: categoriesOf(json<string[]>(r.categories, [])),
    explanation: "",
    source: `${BOOK_NAME} #${Number(r.number)}`,
    analysis: { engine: "gnubg", plies: Number(r.plies), positionClass: positionClassOf(r.position_class), analysedAt: String(r.analysed_at) },
    book: {
      number: Number(r.number),
      chapter: Number(r.chapter ?? 0),
      chapterTitle: String(r.chapter_title ?? ""),
      caption: String(r.caption ?? ""),
      answerId: bookId,
      loss,
      agreement: agreementOf(loss),
      plies: Number(r.plies),
    },
    ...(stored ? storedExplanationFields(stored) : {}),
  };
  const features = json<Problem["features"] | null>(r.features, null);
  if (features) problem.features = features;
  return problem;
}

function playable(db: DatabaseSync, where = "", params: (string | number)[] = []): Problem[] {
  const explanations = latestExplanations(db);
  const rows = db.prepare(`${PLAYABLE_SQL} ${where} ORDER BY p.number`).all(...params) as Row[];
  return rows.map((r) => toProblem(r, explanations)).filter((p): p is Problem => p !== null);
}

/** Every playable book problem, in book order, or [] without the database. */
export function readRobertieProblems(dataDir: string): Problem[] {
  return read(dataDir, [], (db) => playable(db));
}

/** One playable book problem by its quiz id (the explanation route), or null. */
export function readRobertieProblem(dataDir: string, id: string): Problem | null {
  const n = robertieNumber(id);
  if (n === null) return null;
  return read(dataDir, null, (db) => playable(db, "AND p.number = ?", [n])[0] ?? null);
}

/** One chapter's playable problems, in book order. */
export function readRobertieChapter(dataDir: string, chapter: number): { summary: ChapterSummary; problems: Problem[] } | null {
  return read(dataDir, null, (db) => {
    const summary = chapterSummaries(db).find((c) => c.number === chapter);
    if (!summary) return null;
    return { summary, problems: playable(db, "AND p.chapter = ?", [chapter]) };
  });
}

function chapterSummaries(db: DatabaseSync): ChapterSummary[] {
  // Chapters with problems only (the book's last chapter has none).
  const chapters = db
    .prepare("SELECT number, title, first_problem, last_problem FROM robertie_chapters WHERE first_problem IS NOT NULL ORDER BY number")
    .all() as Row[];
  const counts = db.prepare("SELECT chapter, kind, reading_status FROM robertie_problems").all() as Row[];
  const ready = playable(db);
  return chapters.map((c) => {
    const n = Number(c.number);
    const mine = counts.filter((r) => Number(r.chapter) === n);
    const play = ready.filter((p) => p.book!.chapter === n);
    const marks = Object.fromEntries(AGREEMENTS.map((a) => [a, play.filter((p) => p.book!.agreement === a).length])) as ChapterSummary["marks"];
    return {
      number: n,
      title: String(c.title),
      firstProblem: c.first_problem == null ? null : Number(c.first_problem),
      lastProblem: c.last_problem == null ? null : Number(c.last_problem),
      checker: mine.filter((r) => r.kind === "checker").length,
      cube: mine.filter((r) => r.kind === "cube").length,
      playable: play.length,
      waiting: mine.length - play.length,
      marks,
      ids: play.map((p) => p.id),
    };
  });
}

/** Every chapter with its counts, or [] without the database. */
export function readRobertieChapters(dataDir: string): ChapterSummary[] {
  return read(dataDir, [], chapterSummaries);
}

/** Where gnubg rates the book's answer 0.02 or more worse than its own best, largest first. */
export function readRobertieDisagreements(dataDir: string): Disagreement[] {
  return read(dataDir, [], (db) =>
    playable(db)
      .filter((p) => p.book!.loss >= 0.02)
      .sort((a, b) => b.book!.loss - a.book!.loss)
      .map((p) => ({
        number: p.book!.number,
        chapter: p.book!.chapter,
        chapterTitle: p.book!.chapterTitle,
        caption: p.book!.caption,
        book: p.answers.find((a) => a.id === p.book!.answerId)?.label ?? p.book!.answerId,
        best: p.answers[0].label,
        loss: p.book!.loss,
        plies: p.book!.plies,
        agreement: p.book!.agreement,
      })),
  );
}

/** Every problem's reading for the check page, the ones needing a look first. */
export function readRobertieChecks(dataDir: string): BoardCheck[] {
  return read(dataDir, [], (db) => {
    const rows = db
      .prepare(
        `SELECT p.number, p.chapter, p.caption, p.reading_status, p.reading_issues, p.diagram, p.problem_page, p.xgid, p.fix,
                EXISTS (SELECT 1 FROM robertie_reports r WHERE r.number = p.number AND r.resolved_at IS NULL) AS reported
         FROM robertie_problems p ORDER BY p.number`,
      )
      .all() as Row[];
    const order = { check: 0, fixed: 1, ok: 2 } as const;
    return rows
      .map((r) => {
        const status = (["ok", "fixed", "check"].includes(String(r.reading_status)) ? r.reading_status : "check") as BoardCheck["status"];
        const fix = json<{ note?: string } | null>(r.fix, null);
        return {
          number: Number(r.number),
          chapter: r.chapter == null ? null : Number(r.chapter),
          caption: String(r.caption ?? ""),
          status,
          issues: json<string[]>(r.reading_issues, []),
          diagram: r.diagram == null ? null : String(r.diagram),
          page: r.problem_page == null ? null : String(r.problem_page),
          xgid: r.xgid == null ? null : String(r.xgid),
          fixNote: fix?.note ?? null,
          reported: Boolean(Number(r.reported)),
        };
      })
      .sort((a, b) => Number(b.reported) - Number(a.reported) || order[a.status] - order[b.status] || a.number - b.number);
  });
}

/** Robertie's text for one problem with the newest Hebrew translation of exactly that text. */
export function readRobertieText(dataDir: string, n: number): BookText | null {
  return read(dataDir, null, (db) => {
    const r = db.prepare("SELECT number, caption, solution, solution_sha256, solution_pages, problem_page, diagram FROM robertie_problems WHERE number = ?").get(n) as Row | undefined;
    if (!r) return null;
    const t = r.solution_sha256
      ? (db
          .prepare("SELECT text, model, generated_at FROM robertie_translations WHERE number = ? AND solution_sha256 = ? AND language = 'he' ORDER BY id DESC LIMIT 1")
          .get(n, String(r.solution_sha256)) as Row | undefined)
      : undefined;
    return {
      number: Number(r.number),
      caption: String(r.caption ?? ""),
      text: r.solution == null ? null : String(r.solution),
      pages: json<string[]>(r.solution_pages, []),
      problemPage: r.problem_page == null ? null : String(r.problem_page),
      diagram: r.diagram == null ? null : String(r.diagram),
      translation: t ? { text: String(t.text), model: String(t.model), generatedAt: String(t.generated_at).slice(0, 10) } : null,
    };
  });
}

/** The text a translation is made from, with the hash that ties the translation to it. */
export function readSolutionForTranslation(dataDir: string, n: number): { text: string; sha256: string } | null {
  return read(dataDir, null, (db) => {
    const r = db.prepare("SELECT solution, solution_sha256 FROM robertie_problems WHERE number = ?").get(n) as Row | undefined;
    return r?.solution && r.solution_sha256 ? { text: String(r.solution), sha256: String(r.solution_sha256) } : null;
  });
}

export interface NewRobertieTranslation {
  number: number;
  solutionSha256: string;
  language: string;
  requestedModel: string;
  model: string;
  promptVersion: string;
  promptSha256: string;
  text: string;
  rawText: string;
  generatedAt: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  requestId: string | null;
  servedByFallback: boolean;
  effort: string;
}

/** Appends a translation of Robertie's text; returns its row id. */
export function insertRobertieTranslation(dataDir: string, t: NewRobertieTranslation): number {
  const db = openRobertieStore(dataDir);
  try {
    const result = db
      .prepare(
        "INSERT INTO robertie_translations (number, solution_sha256, language, requested_model, model, prompt_version, prompt_sha256, text, raw_text, " +
          "generated_at, input_tokens, output_tokens, cache_read_tokens, request_id, served_by_fallback, effort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        t.number, t.solutionSha256, t.language, t.requestedModel, t.model, t.promptVersion, t.promptSha256, t.text, t.rawText,
        t.generatedAt, t.inputTokens, t.outputTokens, t.cacheReadTokens, t.requestId, t.servedByFallback ? 1 : 0, t.effort,
      );
    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
}

/** Records a board reported as misread; the problem leaves the quiz until the report is resolved. */
export function insertRobertieReport(dataDir: string, n: number, note: string | null): number {
  const db = openRobertieStore(dataDir);
  try {
    const exists = db.prepare("SELECT 1 FROM robertie_problems WHERE number = ?").get(n);
    if (!exists) throw new Error(`no problem ${n}`);
    const result = db.prepare("INSERT INTO robertie_reports (number, note, reported_at) VALUES (?, ?, ?)").run(n, note, new Date().toISOString());
    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
}

/** Whether a book database exists (pages show how to import the book when it does not). */
export function hasRobertieStore(dataDir: string): boolean {
  return read(dataDir, false, () => true);
}

/** The file behind /api/robertie/images/<kind>/<file>, or null for any name the importer does not
 * write (so nothing outside data/robertie/diagrams or data/robertie/pages can be reached). */
export function robertieImagePath(dataDir: string, kind: ImageKind, file: string): string | null {
  const dir = kind === "diagram" ? "diagrams" : "pages";
  const ext = kind === "diagram" ? ".png" : ".jpg";
  if (!file.endsWith(ext)) return null;
  const key = file.slice(0, -ext.length);
  if (!(kind === "diagram" ? DIAGRAM_RE : PAGE_RE).test(key)) return null;
  const root = path.resolve(robertieDir(dataDir), dir);
  const full = path.resolve(root, file);
  return full.startsWith(root + path.sep) ? full : null;
}

