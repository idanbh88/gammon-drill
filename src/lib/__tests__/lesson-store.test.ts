import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getLessonSet,
  LESSON_SCHEMA,
  lessonImagePath,
  lessonsDir,
  lessonStorePath,
  listLessonSets,
  openLessonStore,
  readLessonSet,
  readLessonSets,
} from "@/lib/lesson-store";
import { openStore, schemaVersion, StoreError, storePath } from "@/lib/store";

const A = "5a5a5a5a5a5a5a5a5a5a5a5a";
const B = "6b6b6b6b6b6b6b6b6b6b6b6b";

/** Two sets as the importer writes them; rows deliberately out of order. */
function fill(db: DatabaseSync) {
  db.exec(`
    INSERT INTO lesson_sets (id, site, site_quiz_id, name, author, collection, problem_count, file_name, file_sha256, imported_at) VALUES
      (1, 'BackgammonGalaxy', '${A}', 'Lesson 10: Later', 'GM Test', 'Medium', 2, 'Medium - Lesson 10.json', 'x', '2026-09-11T10:00:00Z'),
      (2, 'BackgammonGalaxy', '${B}', 'Quiz without analysis', NULL, NULL, 1, 'quiz.json', 'y', '2026-09-11T10:05:00Z');
    INSERT INTO lesson_images (path, url, md5, bytes, width, height) VALUES
      ('${A}/images/p01.png', 'https://cdn/1.png', '0123456789abcdef0123456789abcdef', 100, 2280, 1732),
      ('${A}/images/p01-c2.png', 'https://cdn/1_2.png', 'fedcba9876543210fedcba9876543210', 100, 2280, 1732),
      ('${A}/images/p02.png', 'https://cdn/2.png', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 100, 2280, 1732);
    INSERT INTO lesson_problems (set_id, problem_id, number, site_problem_id, kind, image, analysis) VALUES
      (1, 'lesson-p2', 2, 'p2', 'cube', '${A}/images/p02.png', NULL),
      (1, 'lesson-p1', 1, 'p1', 'checker', '${A}/images/p01.png', 'Make the point.'),
      (2, 'lesson-p3', 1, 'p3', 'checker', '${B}/images/p01.png', NULL);
    INSERT INTO lesson_choices (problem_id, number, site_choice_id, answer, description, loss, correct, image) VALUES
      ('lesson-p1', 2, 'c12', '7/5 6/5', '+0.458', 0, 1, '${A}/images/p01-c2.png'),
      ('lesson-p1', 1, 'c11', '13/10', '(-0.062)', 0.062, 0, NULL),
      ('lesson-p2', 1, 'c21', 'No double', 'Wrong', NULL, 0, NULL),
      ('lesson-p2', 2, 'c22', 'Double/Take', '+0.639', 0, 1, NULL),
      ('lesson-p3', 1, 'c31', '24/14', '-0.249', 0, 1, NULL),
      ('lesson-p3', 2, 'c32', '13/3', NULL, NULL, 0, NULL);
  `);
}

describe("lesson store", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "gammon-drill-lessons-"));
    mkdirSync(lessonsDir(dir), { recursive: true });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates its own schema, apart from the main store", () => {
    const db = openLessonStore(lessonStorePath(dir));
    try {
      expect(schemaVersion(db)).toBe(LESSON_SCHEMA.version);
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
      expect(tables).toEqual(["lesson_choices", "lesson_images", "lesson_problems", "lesson_sets", "meta"]);
    } finally {
      db.close();
    }
  });

  it("lists sets and reads one with its problems and choices in order", () => {
    const db = openLessonStore(lessonStorePath(dir));
    try {
      fill(db);
      const sets = listLessonSets(db);
      expect(sets.map((s) => s.key)).toEqual([A, B]);
      expect(sets[0]).toMatchObject({ name: "Lesson 10: Later", author: "GM Test", collection: "Medium", problemIds: ["lesson-p1", "lesson-p2"] });
      expect(sets[0]).toMatchObject({ checker: 1, cube: 1, withAnalysis: 1, importedAt: "2026-09-11T10:00:00Z" });
      expect(sets[1]).toMatchObject({ author: null, collection: null, problemIds: ["lesson-p3"], checker: 1, cube: 0, withAnalysis: 0 });

      const set = getLessonSet(db, A)!;
      expect(set.fileName).toBe("Medium - Lesson 10.json");
      expect(set.problems.map((p) => [p.id, p.number, p.kind])).toEqual([
        ["lesson-p1", 1, "checker"],
        ["lesson-p2", 2, "cube"],
      ]);
      const [p1, p2] = set.problems;
      expect(p1.image).toEqual({ src: `/api/lessons/images/${A}/p01.png?v=01234567`, width: 2280, height: 1732 });
      expect(p1.analysis).toBe("Make the point.");
      expect(p1.choices.map((c) => [c.id, c.number, c.answer, c.description, c.loss, c.correct])).toEqual([
        ["c11", 1, "13/10", "(-0.062)", 0.062, false],
        ["c12", 2, "7/5 6/5", "+0.458", 0, true],
      ]);
      expect(p1.choices[0].image).toBeNull();
      expect(p1.choices[1].image?.src).toBe(`/api/lessons/images/${A}/p01-c2.png?v=fedcba98`);
      expect(p2.analysis).toBeNull();
      expect(p2.choices[0]).toMatchObject({ description: "Wrong", loss: null, correct: false });

      // a picture without a row still gets a URL, just no size and no cache buster
      expect(getLessonSet(db, B)!.problems[0].image).toEqual({ src: `/api/lessons/images/${B}/p01.png`, width: 0, height: 0 });
      expect(getLessonSet(db, "0".repeat(24))).toBeNull();
    } finally {
      db.close();
    }
  });

  it("reads through the data folder, empty before the first import", () => {
    expect(readLessonSets(dir)).toEqual([]);
    expect(readLessonSet(dir, A)).toBeNull();
    const db = openLessonStore(lessonStorePath(dir));
    fill(db);
    db.close();
    expect(readLessonSets(dir).map((s) => s.key)).toEqual([A, B]);
    expect(readLessonSet(dir, A)?.problems).toHaveLength(2);
    expect(readLessonSet(dir, "../store")).toBeNull();
  });

  it("refuses the main store and newer files", () => {
    openStore(storePath(dir)).close();
    expect(() => openStore(storePath(dir), { readOnly: true, schema: LESSON_SCHEMA })).toThrow(StoreError);
    const db = openLessonStore(lessonStorePath(dir));
    db.exec("UPDATE meta SET value = '99' WHERE key = 'schema_version'");
    db.close();
    expect(() => readLessonSets(dir)).toThrow(/schema version 99/);
  });

  it("maps image URLs to files inside data/lessons only", () => {
    expect(lessonImagePath(dir, A, "p01.png")).toBe(path.join(path.resolve(lessonsDir(dir)), A, "images", "p01.png"));
    expect(lessonImagePath(dir, A, "p12-c3.png")).not.toBeNull();
    for (const [key, file] of [
      ["..", "p01.png"],
      [A, "..\\p01.png"],
      [A, "../p01.png"],
      [A, "p1.png"],
      [A, "p01.PNG"],
      [A, "quiz.json"],
      [A.toUpperCase(), "p01.png"],
    ]) {
      expect(lessonImagePath(dir, key, file)).toBeNull();
    }
  });
});
