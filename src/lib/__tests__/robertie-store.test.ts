import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  insertRobertieReport,
  openRobertieStore,
  readRobertieChapter,
  readRobertieChapters,
  readRobertieChecks,
  readRobertieDisagreements,
  readRobertieProblem,
  readRobertieProblems,
  readRobertieText,
  robertieDir,
  robertieImagePath,
} from "@/lib/robertie-store";
import { validateProblem } from "@/lib/validate";
import { insertExplanation } from "@/lib/store";

const OPENING = "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:0:10";
const ANSWERS = JSON.stringify([
  { id: "8/5 6/5", label: "8/5 6/5", equity: 0.22, equityLoss: 0 },
  { id: "13/10 6/5", label: "13/10 6/5", equity: 0.17, equityLoss: 0.05 },
  { id: "24/23 13/10", label: "24/23 13/10", equity: 0.12, equityLoss: 0.1 },
]);

/** Invented rows as the importer writes them (nothing from the book). */
function fill(db: DatabaseSync) {
  db.exec(`
    INSERT INTO robertie_source (id, file_name, file_sha256, pages, imported_at) VALUES (1, 'scan.pdf', 'x', 350, '2026-09-28');
    INSERT INTO robertie_chapters (number, title, first_problem, last_problem, categories, intro_page) VALUES
      (5, 'The Opening', 1, 3, '["opening"]', 's001-R'), (9, 'The Blitz', 4, 4, '["blitz"]', 's040-L'),
      (31, 'Next Steps', NULL, NULL, '[]', 's175-L');
    INSERT INTO robertie_problems (number, problem_id, chapter, kind, caption, dice, problem_page, diagram, solution_pages, solution, solution_sha256,
      play_as_printed, cube_verdict, book_answer, reading_status, reading_issues, reading_local, reading_claude, fix, xgid, imported_at) VALUES
      (1, 'robertie-1', 5, 'checker', 'Problem 1: Black to play 31.', '31', 's001-R', 's001-R-1', '["s002-L"]', 'Invented text one.', 'h1', '8/5 6/5!', NULL, '8/5 6/5', 'ok', '[]', NULL, NULL, NULL, '${OPENING}', 'now'),
      (2, 'robertie-2', 5, 'checker', 'Problem 2: Black to play 31.', '31', 's001-R', 's001-R-2', '["s002-L"]', 'Invented text two.', 'h2', '13/10 6/5', NULL, '13/10 6/5', 'fixed', '[]', NULL, NULL, '{"note":"set by hand"}', '${OPENING}', 'now'),
      (3, 'robertie-3', 5, 'checker', 'Problem 3: Black to play 31.', '31', 's001-R', 's001-R-3', '[]', NULL, NULL, NULL, NULL, NULL, 'check', '["readings differ"]', NULL, NULL, NULL, NULL, 'now'),
      (4, 'robertie-4', 9, 'checker', 'Problem 4: Black to play 31.', '31', 's040-L', 's040-L-1', '["s041-L"]', 'Invented text four.', 'h4', '24/23 13/10', NULL, '24/23 13/10', 'ok', '[]', NULL, NULL, NULL, '${OPENING}', 'now');
    INSERT INTO robertie_analyses (number, plies, engine, analysed_at, position_class, categories, features, answers, best_answer_id, book_answer_id, book_loss, book_full_depth, notes) VALUES
      (1, 2, 'gnubg', '2026-09-28', 'contact', '["opening"]', NULL, '${ANSWERS}', '8/5 6/5', '8/5 6/5', 0, 1, NULL),
      (2, 2, 'gnubg', '2026-09-28', 'contact', '["opening"]', NULL, '${ANSWERS}', '8/5 6/5', '13/10 6/5', 0.05, 1, NULL),
      (4, 2, 'gnubg', '2026-09-28', 'contact', '["blitz","not-a-category"]', NULL, '${ANSWERS}', '8/5 6/5', '24/23 13/10', 0.1, 1, NULL),
      (4, 3, 'gnubg', '2026-09-28', 'contact', '["blitz"]', NULL, '${ANSWERS.replace("0.1}", "0.09}")}', '8/5 6/5', '24/23 13/10', 0.09, 1, NULL);
    INSERT INTO robertie_translations (number, solution_sha256, language, requested_model, model, prompt_version, prompt_sha256, text, raw_text, generated_at, effort) VALUES
      (1, 'old-hash', 'he', 'm', 'm', 'rb-he-v1', 's', 'תרגום ישן', 'x', '2026-09-27', 'low'),
      (1, 'h1', 'he', 'm', 'claude-opus-5', 'rb-he-v1', 's', 'תרגום', 'x', '2026-09-28T10:00:00Z', 'low');
  `);
}

describe("robertie store", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "gammon-drill-robertie-"));
    mkdirSync(robertieDir(dir), { recursive: true });
    const db = openRobertieStore(dir);
    fill(db);
    db.close();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("loads only read, checked and analysed problems, with the deepest analysis", () => {
    const problems = readRobertieProblems(dir);
    expect(problems.map((p) => p.id)).toEqual(["robertie-1", "robertie-2", "robertie-4"]);
    for (const p of problems) expect(validateProblem(p)).toEqual([]);
    const four = problems[2];
    expect(four.book).toMatchObject({ number: 4, chapter: 9, chapterTitle: "The Blitz", answerId: "24/23 13/10", loss: 0.09, agreement: "blunder", plies: 3 });
    expect(four.categories).toEqual(["blitz"]);
    expect(four.analysis).toMatchObject({ engine: "gnubg", plies: 3, positionClass: "contact" });
    expect(four.source).toBe("Robertie 501 #4");
    expect(readRobertieProblem(dir, "robertie-2")?.book?.agreement).toBe("differs");
    expect(readRobertieProblem(dir, "robertie-3")).toBeNull();
    expect(readRobertieProblem(dir, "seed-001")).toBeNull();
  });

  it("summarises the chapters that have problems and lists disagreements", () => {
    const chapters = readRobertieChapters(dir);
    expect(chapters.map((c) => [c.number, c.checker, c.cube, c.playable, c.waiting])).toEqual([
      [5, 3, 0, 2, 1],
      [9, 1, 0, 1, 0],
    ]);
    expect(chapters[0].marks).toEqual({ same: 1, close: 0, differs: 1, blunder: 0 });
    expect(readRobertieChapter(dir, 5)?.problems.map((p) => p.book?.number)).toEqual([1, 2]);
    expect(readRobertieChapter(dir, 7)).toBeNull();
    expect(readRobertieDisagreements(dir).map((d) => [d.number, d.book, d.best, d.loss])).toEqual([
      [4, "24/23 13/10", "8/5 6/5", 0.09],
      [2, "13/10 6/5", "8/5 6/5", 0.05],
    ]);
  });

  it("gives the text with the translation of exactly that text", () => {
    const t = readRobertieText(dir, 1)!;
    expect(t.text).toBe("Invented text one.");
    expect(t.pages).toEqual(["s002-L"]);
    expect(t.translation).toEqual({ text: "תרגום", model: "claude-opus-5", generatedAt: "2026-09-28" });
    expect(readRobertieText(dir, 4)!.translation).toBeNull();
    expect(readRobertieText(dir, 99)).toBeNull();
  });

  it("takes a reported problem out of the quiz and puts it first on the check page", () => {
    insertRobertieReport(dir, 4, "the 6-point looks short");
    expect(readRobertieProblems(dir).map((p) => p.id)).toEqual(["robertie-1", "robertie-2"]);
    const checks = readRobertieChecks(dir);
    expect(checks.map((c) => [c.number, c.status, c.reported])).toEqual([
      [4, "ok", true],
      [3, "check", false],
      [2, "fixed", false],
      [1, "ok", false],
    ]);
    expect(checks[2].fixNote).toBe("set by hand");
    expect(() => insertRobertieReport(dir, 99, null)).toThrow();
  });

  it("overlays explanations stored in the book's database", () => {
    const db = openRobertieStore(dir);
    insertExplanation(db, {
      xgid: OPENING, problemId: "robertie-1", requestedModel: "claude-opus-5", model: "claude-opus-5", promptVersion: "v5", promptSha256: "s",
      explanation: "הסבר", rawText: "הסבר", generatedAt: "2026-09-28T10:00:00Z", inputTokens: 1, outputTokens: 1, cacheReadTokens: null,
      requestId: null, servedByFallback: false, effort: "high", language: "he",
    });
    db.close();
    expect(readRobertieProblems(dir)[0].explanation).toBe("הסבר");
  });

  it("works without the database", () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), "gammon-drill-norobertie-"));
    try {
      expect(readRobertieProblems(empty)).toEqual([]);
      expect(readRobertieChapters(empty)).toEqual([]);
      expect(readRobertieText(empty, 1)).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("serves only file names the importer writes", () => {
    expect(robertieImagePath(dir, "diagram", "s003-L-1.png")).toBe(path.resolve(robertieDir(dir), "diagrams", "s003-L-1.png"));
    expect(robertieImagePath(dir, "page", "s003-L.jpg")).toBe(path.resolve(robertieDir(dir), "pages", "s003-L.jpg"));
    for (const bad of ["../robertie.sqlite", "s003-L-1.jpg", "s003-X-1.png", "s3-L-1.png", "robertie.sqlite"]) expect(robertieImagePath(dir, "diagram", bad)).toBeNull();
    expect(robertieImagePath(dir, "page", "s003-L-1.jpg")).toBeNull();
  });
});

describe("robertie schema", () => {
  const ROOT = path.resolve(__dirname, "..", "..", "..");
  const tables = (file: string) => {
    const sql = /SCHEMA_SQL\s*=\s*`([^`]*)`/.exec(readFileSync(path.join(ROOT, "src", "lib", file), "utf8"))![1];
    return Object.fromEntries([...sql.matchAll(/CREATE (?:TABLE|INDEX) IF NOT EXISTS (\w+)[^;]*;/g)].map((m) => [m[1], m[0]]));
  };

  it("copies store.sqlite's explanation tables exactly", () => {
    const book = tables("robertie-store-schema.ts");
    const main = tables("store-schema.ts");
    for (const name of ["explanations", "explanations_xgid", "translations", "translations_explanation"]) expect(book[name]).toBe(main[name]);
  });
});

describe("the public repository", () => {
  const ROOT = path.resolve(__dirname, "..", "..", "..");

  it("never holds a problem of the book in the committed data", async () => {
    const { readdirSync, existsSync } = await import("node:fs");
    const dataDir = path.join(ROOT, "data");
    for (const f of readdirSync(dataDir).filter((n) => n.endsWith(".json"))) {
      expect(readFileSync(path.join(dataDir, f), "utf8")).not.toMatch(/robertie-\d/);
    }
    const store = path.join(dataDir, "store.sqlite");
    if (!existsSync(store)) return;
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(store, { readOnly: true });
    try {
      const n = db.prepare("SELECT COUNT(*) AS n FROM explanations WHERE problem_id LIKE 'robertie-%'").get() as { n: number };
      expect(Number(n.n)).toBe(0);
    } finally {
      db.close();
    }
  });
});
