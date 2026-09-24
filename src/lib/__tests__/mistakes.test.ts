import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EngineResult } from "@/lib/engine";
import { newMatch, type DecisionRecord } from "@/lib/game";
import { inQuiz, isAutoMistake, mistakeProblem, mistakeProblems, type MistakeRow } from "@/lib/mistakes";
import { createPlayMatch, insertPlayDecision, setQuizPick } from "@/lib/play-store";
import { offeredAnswers } from "@/lib/problem-utils";
import { matchRatings, matchSummaries, mistakeRows, openStore, readMistakeProblems, readQuizPicks, storePath } from "@/lib/store";
import type { Answer } from "@/types/problem";

const XGID = "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10";
const NOW = "2026-09-24T12:00:00.000Z";
const ANSWERS: Answer[] = [
  { id: "8/5 6/5", label: "8/5 6/5", equity: 0.2, equityLoss: 0 },
  { id: "24/23 13/10", label: "24/23 13/10", equity: 0.1, equityLoss: 0.1 },
  { id: "13/10 6/5", label: "13/10 6/5", equity: 0.19, equityLoss: 0.01 },
  { id: "24/20", label: "24/20", equity: 0.15, equityLoss: 0.05 },
  { id: "13/9", label: "13/9", equity: 0.12, equityLoss: 0.08 },
  { id: "24/21 6/5", label: "24/21 6/5", equity: 0.18, equityLoss: 0.02 },
  { id: "6/2", label: "6/2", equity: 0.0, equityLoss: 0.2 },
].sort((a, b) => a.equityLoss - b.equityLoss);

function row(over: Partial<MistakeRow> = {}): MistakeRow {
  return {
    id: 1,
    matchId: 3,
    gameId: 1,
    decisionId: "play-3-g1-m1-checker",
    gameNumber: 1,
    moveNumber: 1,
    player: 1,
    kind: "checker",
    xgid: XGID,
    dice: "31",
    played: "6/2",
    playedAnswerId: "6/2",
    bestAnswerId: "8/5 6/5",
    bestEquity: 0.2,
    playedEquity: 0,
    loss: 0.2,
    forced: false,
    positionClass: "contact",
    categories: ["opening"],
    features: null,
    answers: ANSWERS,
    plies: 2,
    analysedAt: "2026-09-24",
    site: "gnubg",
    opponent: "gnubg",
    playedAt: NOW,
    userPlayer: 1,
    ...over,
  };
}

describe("the automatic rule and picks", () => {
  it("takes the user's scored errors of 0.02 or more", () => {
    expect(isAutoMistake(row(), 1)).toBe(true);
    expect(isAutoMistake(row({ loss: 0.019 }), 1)).toBe(false);
    expect(isAutoMistake(row({ loss: 0.02 }), 1)).toBe(true);
    expect(isAutoMistake(row({ player: 2 }), 1)).toBe(false);
    expect(isAutoMistake(row({ forced: true }), 1)).toBe(false);
    expect(isAutoMistake(row({ loss: null }), 1)).toBe(false);
  });

  it("lets a pick add or remove a decision", () => {
    const picks = new Map([
      ["play-3-g1-m1-checker", false],
      ["play-3-g1-m2-checker", true],
    ]);
    expect(inQuiz(row(), 1, picks)).toBe(false);
    expect(inQuiz(row({ decisionId: "play-3-g1-m2-checker", loss: 0 }), 1, picks)).toBe(true);
    expect(inQuiz(row({ decisionId: "other" }), 1, picks)).toBe(true);
  });
});

describe("mistake problems", () => {
  it("carries the origin and offers the move played in the game", () => {
    const p = mistakeProblem(row())!;
    expect(p.id).toBe("play-3-g1-m1-checker");
    expect(p.origin).toEqual({ site: "gnubg", matchId: 3, opponent: "gnubg", playedAt: NOW, played: "6/2", loss: 0.2 });
    expect(p.source).toBe("game vs gnubg");
    expect(mistakeProblem(row({ site: "BackgammonGalaxy", opponent: "dcrc2" }))!.source).toBe("BackgammonGalaxy match");
    const offered = offeredAnswers(p).map((a) => a.id);
    expect(offered).toHaveLength(4);
    expect(offered).toContain("8/5 6/5");
    expect(offered[3]).toBe("6/2");
    // A played move already in the top four changes nothing.
    const near = mistakeProblem(row({ playedAnswerId: "24/21 6/5", played: "24/21 6/5", loss: 0.02 }))!;
    expect(offeredAnswers(near)).toEqual(ANSWERS.slice(0, 4));
  });

  it("skips what cannot be quizzed", () => {
    expect(mistakeProblem(row({ forced: true }))).toBeNull();
    expect(mistakeProblem(row({ playedAnswerId: null }))).toBeNull();
    expect(mistakeProblem(row({ answers: ANSWERS.slice(0, 1) }))).toBeNull();
    const picks = new Map([["play-3-g1-m1-checker", false]]);
    expect(mistakeProblems([row(), row({ decisionId: "b", loss: 0.05 })], picks).map((p) => p.id)).toEqual(["b"]);
  });
});

describe("the store", () => {
  let dir: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "bg-mistakes-"));
    db = openStore(storePath(dir));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function analysis(playedId: string): EngineResult {
    const a = ANSWERS.find((x) => x.id === playedId)!;
    return {
      kind: "checker",
      best: "8/5 6/5",
      played: playedId,
      answers: ANSWERS,
      playedAnswerId: playedId,
      bestAnswerId: "8/5 6/5",
      bestEquity: 0.2,
      playedEquity: a.equity,
      loss: a.equityLoss,
      positionClass: "contact",
      categories: ["opening"],
      features: null,
      warnings: [],
      cube: null,
      plies: 2,
      ms: 1,
    };
  }

  function decision(player: 1 | 2, move: number, played: string): DecisionRecord {
    return { player, kind: "checker", xgid: XGID, dice: [3, 1], played, forced: false, game: 1, move };
  }

  it("finds the user's errors and rates both players", () => {
    const settings = { matchLength: 7, jacoby: false };
    const matchId = createPlayMatch(db, { settings, state: newMatch(settings, [3, 1]), playerName: "You", plies: 2, now: NOW });
    const ins = (d: DecisionRecord, playedId: string) => insertPlayDecision(db, { matchId, record: d, analysis: analysis(playedId), plies: 2, now: NOW });
    ins(decision(1, 1, "6/2"), "6/2"); // error 0.2
    ins(decision(1, 2, "8/5 6/5"), "8/5 6/5"); // best
    ins(decision(1, 3, "13/10 6/5"), "13/10 6/5"); // 0.01
    ins(decision(2, 1, "24/20"), "24/20"); // gnubg's own error, never in the quiz

    expect(mistakeRows(db, 0.02).map((r) => r.decisionId)).toEqual([`play-${matchId}-g1-m1-checker`]);
    setQuizPick(db, `play-${matchId}-g1-m3-checker`, true, NOW);
    setQuizPick(db, `play-${matchId}-g1-m1-checker`, false, NOW);
    expect(readQuizPicks(db).size).toBe(2);
    expect(readMistakeProblems(dir, 0.02).map((p) => p.id)).toEqual([`play-${matchId}-g1-m3-checker`]);

    const [user, gnubg] = matchRatings(db).get(matchId)!;
    expect([user.decisions, user.totalLoss, user.pr]).toEqual([3, 0.21, 35]);
    expect([gnubg.decisions, gnubg.pr]).toEqual([1, 25]);
    const s = matchSummaries(db, { error: 0.02, blunder: 0.08 }).get(matchId)!;
    expect([s.decisions, s.errors, s.blunders]).toEqual([3, 1, 1]);
  });
});
