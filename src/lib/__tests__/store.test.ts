import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyStore,
  countExplanations,
  explanationHistory,
  hasColumn,
  getDecision,
  insertExplanation,
  latestExplanations,
  listDecisions,
  listGames,
  listMatches,
  matchSummaries,
  openStore,
  readDecision,
  readLatestExplanations,
  readMatch,
  readMatches,
  schemaVersion,
  StoreError,
  storePath,
  type NewExplanation,
} from "@/lib/store";
import { SCHEMA_VERSION } from "@/lib/store-schema";
import type { Problem } from "@/types/problem";

const XGID = "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10";
const THRESHOLDS = { error: 0.02, blunder: 0.08 };

function row(over: Partial<NewExplanation> = {}): NewExplanation {
  return {
    xgid: XGID,
    problemId: "seed-001",
    requestedModel: "claude-opus-5",
    model: "claude-opus-5",
    promptVersion: "v2",
    promptSha256: "abc",
    explanation: "Make the 5-point.",
    rawText: "Make the 5-point.",
    generatedAt: "2026-09-03T18:00:00.000Z",
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    requestId: "req_1",
    servedByFallback: false,
    effort: null,
    ...over,
  };
}

function problem(id: string, xgid: string, explanation = ""): Problem {
  return {
    id,
    xgid,
    type: "checker",
    categories: ["opening"],
    explanation,
    answers: [
      { id: "8/5 6/5", label: "8/5 6/5", equity: 0.2, equityLoss: 0 },
      { id: "13/9", label: "13/9", equity: 0, equityLoss: 0.2 },
    ],
  };
}

/** A store file exactly as version 1 of the app wrote it (no match tables). */
function writeV1(file: string) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE explanations (
      id INTEGER PRIMARY KEY, xgid TEXT NOT NULL, problem_id TEXT NOT NULL, requested_model TEXT NOT NULL,
      model TEXT NOT NULL, prompt_version TEXT NOT NULL, prompt_sha256 TEXT NOT NULL, explanation TEXT NOT NULL,
      raw_text TEXT NOT NULL, generated_at TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
      cache_read_tokens INTEGER, request_id TEXT, served_by_fallback INTEGER NOT NULL DEFAULT 0);
    INSERT INTO meta VALUES ('schema_version', '1');
    INSERT INTO explanations (xgid, problem_id, requested_model, model, prompt_version, prompt_sha256, explanation, raw_text, generated_at)
      VALUES ('${XGID}', 'seed-001', 'claude-opus-5', 'claude-opus-5', 'v1', 'x', 'Old text.', 'Old text.', '2026-09-03T10:00:00.000Z');
  `);
  db.close();
}

function insertMatchFixture(db: DatabaseSync) {
  db.exec(`
    INSERT INTO matches (id, site, site_match_id, player1, player2, match_length, played_at, file_name, file_sha256, mat_text,
      analysed_player, engine, plies, imported_at)
      VALUES (7, 'BackgammonGalaxy', '45552673', 'me', 'them', 1, '2026-09-03T18:37:00', 'x.mat', 'deadbeef', '1 point match', 1, 'gnubg', 2, '2026-09-04T08:00:00Z');
    INSERT INTO games (id, match_id, number, score1, score2, crawford, winner, points) VALUES (3, 7, 1, 0, 0, 0, 2, 1);
    INSERT INTO decisions (match_id, game_id, decision_id, game_number, move_number, player, kind, xgid, dice, played, played_answer_id,
      best_answer_id, best_equity, played_equity, loss, forced, position_class, categories, features, answers, plies, analysed_at) VALUES
      (7, 3, 'match-45552673-g1-m1-checker', 1, 1, 1, 'checker', '${XGID}', '31', '24/23 13/9', '24/23 13/9', '8/5 6/5', 0.22, 0.05, 0.17, 0,
        'contact', '["opening"]', '{"pips_me":167,"can_hit":false}',
        '[{"id":"8/5 6/5","label":"8/5 6/5","equity":0.22,"equityLoss":0},{"id":"24/23 13/9","label":"24/23 13/9","equity":0.05,"equityLoss":0.17}]',
        2, '2026-09-04'),
      (7, 3, 'match-45552673-g1-m2-checker', 1, 2, 1, 'checker', '${XGID}', '66', '13/7(2) 8/2(2)', '13/7(2) 8/2(2)', '13/7(2) 8/2(2)', 0.3, 0.3, 0, 0,
        'contact', '["early-game"]', NULL, '[{"id":"13/7(2) 8/2(2)","label":"13/7(2) 8/2(2)","equity":0.3,"equityLoss":0}]', 2, '2026-09-04'),
      (7, 3, 'match-45552673-g1-m3-checker', 1, 3, 1, 'checker', '${XGID}', '55', '', NULL, NULL, NULL, NULL, NULL, 1,
        NULL, '[]', NULL, '[]', 2, '2026-09-04'),
      (7, 3, 'match-45552673-g1-m4-cube', 1, 4, 1, 'cube', '${XGID}', NULL, 'no-double', 'no-double', 'double-take', 0.5, 0.46, 0.04, 0,
        'contact', '["contact-cube"]', NULL, '[{"id":"double-take","label":"Double, take","equity":0.5,"equityLoss":0},{"id":"no-double","label":"No double, take","equity":0.46,"equityLoss":0.04}]',
        2, '2026-09-04');
  `);
}

describe("store", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "gammon-drill-store-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the schema and only ever appends", () => {
    const file = storePath(dir);
    const db = openStore(file);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(["decisions", "explanations", "games", "matches", "meta", "play_state", "quiz_picks"]);
    expect(countExplanations(db)).toBe(0);
    const first = insertExplanation(db, row());
    const second = insertExplanation(db, row({ explanation: "Newer text.", model: "claude-fable-5-1", servedByFallback: true, effort: "xhigh" }));
    expect(second).toBeGreaterThan(first);
    expect(countExplanations(db)).toBe(2);

    const latest = latestExplanations(db);
    expect(latest.get(XGID)?.explanation).toBe("Newer text.");
    expect(latest.get(XGID)?.servedByFallback).toBe(true);
    expect(latest.get(XGID)?.effort).toBe("xhigh");
    expect(applyStore([problem("p", XGID)], latest)[0].explanationMeta).toEqual({ model: "claude-fable-5-1", generatedAt: "2026-09-03", effort: "xhigh" });

    const history = explanationHistory(db, XGID);
    expect(history.map((h) => h.explanation)).toEqual(["Newer text.", "Make the 5-point."]);
    expect(history[1]).toMatchObject({ requestId: "req_1", inputTokens: 10, servedByFallback: false, effort: null });
    expect(applyStore([problem("p", XGID)], new Map([[XGID, history[1]]]))[0].explanationMeta).toEqual({ model: "claude-opus-5", generatedAt: "2026-09-03" });
    db.close();

    // Reopening read-only sees the same rows and the same schema version.
    const ro = openStore(file, { readOnly: true });
    expect(countExplanations(ro)).toBe(2);
    expect(listMatches(ro)).toEqual([]);
    ro.close();
  });

  it("upgrades a version 1 file and reads it as it is until then", () => {
    const file = storePath(dir);
    writeV1(file);
    // Read-only: an older file is accepted and the match tables simply read as empty.
    const ro = openStore(file, { readOnly: true });
    expect(schemaVersion(ro)).toBe(1);
    expect(latestExplanations(ro).get(XGID)?.explanation).toBe("Old text.");
    expect(hasColumn(ro, "explanations", "effort")).toBe(false);
    expect(latestExplanations(ro).get(XGID)?.effort).toBeNull(); // read as NULL, no error
    expect(listMatches(ro)).toEqual([]);
    expect(getDecision(ro, "anything")).toBeNull();
    expect(matchSummaries(ro, THRESHOLDS).size).toBe(0);
    ro.close();
    expect(readMatches(dir, THRESHOLDS).matches).toEqual([]);

    // Writable: the additive migration runs and the old rows survive.
    const db = openStore(file);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(countExplanations(db)).toBe(1);
    expect(hasColumn(db, "explanations", "effort")).toBe(true); // ADDED_COLUMNS
    insertExplanation(db, row({ explanation: "New text.", effort: "low" }));
    expect(explanationHistory(db, XGID).map((h) => h.effort)).toEqual(["low", null]);
    insertMatchFixture(db);
    expect(listMatches(db)).toHaveLength(1);
    db.close();
    const again = openStore(file, { readOnly: true });
    expect(schemaVersion(again)).toBe(SCHEMA_VERSION);
    again.close();
  });

  it("refuses a read-only open of a missing file and a newer schema version", () => {
    expect(() => openStore(storePath(dir), { readOnly: true })).toThrow(StoreError);
    const db = openStore(storePath(dir));
    db.exec("UPDATE meta SET value = '99' WHERE key = 'schema_version'");
    db.close();
    expect(() => openStore(storePath(dir))).toThrow(/schema version 99/);
    expect(() => openStore(storePath(dir), { readOnly: true })).toThrow(/schema version 99/);
  });

  it("rejects a file that is not a store", () => {
    writeFileSync(storePath(dir), "not sqlite at all");
    expect(() => openStore(storePath(dir), { readOnly: true })).toThrow();
  });

  it("overlays the latest row onto problems and leaves the rest alone", () => {
    expect(readLatestExplanations(dir).size).toBe(0);
    const db = openStore(storePath(dir));
    insertExplanation(db, row({ explanation: "Old." }));
    insertExplanation(db, row({ explanation: "New.", generatedAt: "2026-09-04T09:30:00.000Z", model: "claude-fable-5-1" }));
    db.close();

    const problems = [problem("a", XGID, "hand-written"), problem("b", "other-xgid", "kept")];
    const out = applyStore(problems, readLatestExplanations(dir));
    expect(out[0].explanation).toBe("New.");
    expect(out[0].explanationMeta).toEqual({ model: "claude-fable-5-1", generatedAt: "2026-09-04" });
    expect(out[1].explanation).toBe("kept");
    expect(out[1].explanationMeta).toBeUndefined();
    expect(problems[0].explanation).toBe("hand-written"); // input not mutated
  });

  it("reads matches, games and decisions written by the importer", () => {
    const db = openStore(storePath(dir));
    try {
      checkMatchReads(db);
    } finally {
      db.close();
    }

    const read = readMatch(dir, 7)!;
    expect(read.match.id).toBe(7);
    expect(read.games).toHaveLength(1);
    expect(read.decisions).toHaveLength(4);
    expect(readMatch(dir, 8)).toBeNull();
    expect(readDecision(dir, "match-45552673-g1-m1-checker")?.played).toBe("24/23 13/9");
    const all = readMatches(dir, THRESHOLDS);
    expect(all.summaries.get(7)?.errors).toBe(2);
    expect(all.games.get(7)?.map((g) => g.number)).toEqual([1]);
  });

  function checkMatchReads(db: DatabaseSync) {
    insertMatchFixture(db);
    const [match] = listMatches(db);
    expect(match).toMatchObject({ id: 7, site: "BackgammonGalaxy", siteMatchId: "45552673", player1: "me", matchLength: 1, analysedPlayer: 1, plies: 2 });
    expect(listGames(db, 7)).toEqual([{ id: 3, matchId: 7, number: 1, score1: 0, score2: 0, crawford: false, winner: 2, points: 1 }]);

    const decisions = listDecisions(db, 7);
    expect(decisions.map((d) => d.moveNumber)).toEqual([1, 2, 3, 4]);
    expect(decisions[0]).toMatchObject({
      decisionId: "match-45552673-g1-m1-checker",
      kind: "checker",
      dice: "31",
      played: "24/23 13/9",
      playedAnswerId: "24/23 13/9",
      bestAnswerId: "8/5 6/5",
      loss: 0.17,
      forced: false,
      positionClass: "contact",
      categories: ["opening"],
      features: { pips_me: 167, can_hit: false },
    });
    expect(decisions[0].answers).toHaveLength(2);
    expect(decisions[2]).toMatchObject({ forced: true, loss: null, playedAnswerId: null, categories: [], answers: [], features: null });
    expect(decisions[3]).toMatchObject({ kind: "cube", dice: null, played: "no-double", loss: 0.04 });
    expect(getDecision(db, "match-45552673-g1-m4-cube")?.bestAnswerId).toBe("double-take");
    expect(getDecision(db, "nope")).toBeNull();

    const summary = matchSummaries(db, THRESHOLDS).get(7);
    expect(summary).toEqual({ matchId: 7, decisions: 3, forced: 1, errors: 2, blunders: 1, totalLoss: 0.21 });
  }
});
