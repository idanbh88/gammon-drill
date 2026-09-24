import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { actingView, decisionKind } from "@/lib/board";
import type { Engine, EngineRequest, EngineResult } from "@/lib/engine";
import type { GameState, MatchSettings, Phase } from "@/lib/game";
import { applySteps, generatePlays, parsePlay, stateFromView, stateKey } from "@/lib/moves";
import { PlayError, playAction, playView, startPlayMatch, type PlayDeps } from "@/lib/play-service";
import { loadPlay, PlayConflictError, savePlay, setQuizPick } from "@/lib/play-store";
import { getDecision, listGames, listMatches, openStore, readQuizPicks, storePath } from "@/lib/store";
import { parseXgid } from "@/lib/xgid";
import type { Answer } from "@/types/problem";

const MONEY: MatchSettings = { matchLength: 0, jacoby: true };
const NOW = "2026-09-24T12:00:00.000Z";

/** Ranks legal plays in generator order (0.01 apart); cube and take answers are canned. */
class FakeEngine implements Engine {
  calls: EngineRequest[] = [];
  cube: "double" | "no-double" = "no-double";
  take: "take" | "pass" = "take";

  async analyse(req: EngineRequest): Promise<EngineResult> {
    this.calls.push(req);
    const pos = parseXgid(req.xgid);
    const kind = decisionKind(pos);
    let answers: Answer[];
    let best: string;
    let played: string;
    let playedId: string | null;
    const cube = { nd: 0.5, dt: 0.4, dp: 1, proper: "No double, take" };
    if (kind === "checker") {
      const view = actingView(pos);
      const plays = generatePlays(view, pos.dice!);
      answers = plays.map((p, i) => ({ id: p.notation, label: p.notation, equity: -i / 100, equityLoss: i / 100 }));
      best = plays[0].notation;
      played = req.played ?? best;
      const result = applySteps(stateFromView(view), parsePlay(played));
      playedId = plays.find((p) => result && stateKey(p.result) === stateKey(result))?.notation ?? null;
    } else if (kind === "cube-double") {
      const d = this.cube === "double";
      answers = d
        ? [
            { id: "double-take", label: "Double, take", equity: 0.7, equityLoss: 0 },
            { id: "no-double", label: "No double, take", equity: 0.6, equityLoss: 0.1 },
            { id: "double-pass", label: "Double, pass", equity: 1, equityLoss: 0.3 },
            { id: "too-good", label: "No double, pass (too good)", equity: 0.6, equityLoss: 0.4 },
          ]
        : [
            { id: "no-double", label: "No double, take", equity: 0.5, equityLoss: 0 },
            { id: "double-take", label: "Double, take", equity: 0.4, equityLoss: 0.1 },
            { id: "too-good", label: "No double, pass (too good)", equity: 0.5, equityLoss: 0.6 },
            { id: "double-pass", label: "Double, pass", equity: 1, equityLoss: 0.7 },
          ];
      best = this.cube;
      played = req.played ?? best;
      const options = played === "double" ? ["double-take", "double-pass"] : ["no-double", "too-good"];
      playedId = answers.filter((a) => options.includes(a.id)).sort((a, b) => a.equityLoss - b.equityLoss)[0].id;
    } else {
      answers =
        this.take === "take"
          ? [
              { id: "take", label: "Take", equity: -0.4, equityLoss: 0 },
              { id: "pass", label: "Pass", equity: -1, equityLoss: 0.3 },
            ]
          : [
              { id: "pass", label: "Pass", equity: -1, equityLoss: 0 },
              { id: "take", label: "Take", equity: -1.3, equityLoss: 0.3 },
            ];
      best = this.take;
      played = req.played ?? best;
      playedId = played;
    }
    const pa = answers.find((a) => a.id === playedId) ?? null;
    return {
      kind: kind === "checker" ? "checker" : kind === "cube-take" ? "take" : "cube",
      best,
      played,
      answers,
      playedAnswerId: playedId,
      bestAnswerId: answers[0].id,
      bestEquity: answers[0].equity,
      playedEquity: pa?.equity ?? null,
      loss: pa?.equityLoss ?? null,
      positionClass: "contact",
      categories: ["opening"],
      features: null,
      warnings: [],
      cube: kind === "checker" ? null : cube,
      plies: 2,
      ms: 1,
    };
  }
}

let dir: string;
let db: DatabaseSync;
let engine: FakeEngine;
let dice: [number, number][];

function deps(): PlayDeps {
  return {
    db,
    engine,
    roll: () => {
      const d = dice.shift();
      if (!d) throw new Error("the test ran out of dice");
      return d;
    },
    now: () => NOW,
    plies: 2,
  };
}

/** Overwrite the stored state (to jump to an interesting position). */
function force(matchId: number, patch: (s: GameState) => GameState): number {
  const rec = loadPlay(db, matchId)!;
  return savePlay(db, matchId, patch(rec.state), rec.status, rec.version, NOW);
}

function position(state: GameState, xgid: string, phase: Phase): GameState {
  const pos = parseXgid(xgid);
  return { ...state, position: pos, score: pos.score, phase };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "bg-play-"));
  db = openStore(storePath(dir));
  engine = new FakeEngine();
  dice = [];
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("a match against gnubg", () => {
  it("starts with the opening roll and waits for the user's first play", async () => {
    dice = [[5, 3]];
    const v = await startPlayMatch(deps(), MONEY, "You");
    expect(v.state.phase).toEqual({ kind: "move", player: 1 });
    expect(v.events).toEqual([{ type: "opening", game: 1, dice: [5, 3], first: 1 }]);
    expect([v.version, v.status, v.log]).toEqual([2, "playing", []]);
    expect(v.ratings.match[0].pr).toBeNull();
    const [m] = listMatches(db);
    expect([m.site, m.siteMatchId, m.player1, m.player2, m.matchLength, m.analysedPlayer]).toEqual(["gnubg", String(m.id), "You", "gnubg", 0, 1]);
    expect(listGames(db, m.id).map((g) => [g.number, g.winner])).toEqual([[1, null]]);
    expect(engine.calls).toEqual([]);
  });

  it("lets gnubg open when it wins the opening roll", async () => {
    dice = [[2, 6]];
    const v = await startPlayMatch(deps(), MONEY, "You");
    expect(v.events.map((e) => e.type)).toEqual(["opening", "move"]);
    expect(v.state.phase).toEqual({ kind: "pre-roll", player: 1 });
    expect(v.log.map((l) => l.decisionId)).toEqual([`play-${v.matchId}-g1-m1-p2-checker`]);
  });

  it("grades the user's play, then gnubg rolls and plays until the user decides again", async () => {
    dice = [[5, 3], [6, 4]];
    const start = await startPlayMatch(deps(), MONEY, "You");
    const v = await playAction(deps(), start.matchId, { type: "move", play: "13/8 13/10" }, start.version);
    const id = start.matchId;
    expect(v.graded.map((d) => d.problem.id)).toEqual([`play-${id}-g1-m1-checker`]);
    const graded = v.graded[0];
    expect(graded.played?.id).toBe("13/10 13/8");
    expect(graded.played?.loss).toBe(graded.problem.answers.find((a) => a.id === "13/10 13/8")!.equityLoss);
    expect(v.events.map((e) => e.type)).toEqual(["move", "roll", "move"]);
    expect(v.events[1]).toEqual({ type: "roll", player: 2, dice: [6, 4] });
    expect(v.state.phase).toEqual({ kind: "pre-roll", player: 1 });
    expect(v.log.map((l) => l.decisionId)).toEqual([`play-${id}-g1-m1-checker`, `play-${id}-g1-m1-p2-cube`, `play-${id}-g1-m1-p2-checker`]);
    expect(v.lastMove?.player).toBe(2);
    expect(engine.calls.map((c) => c.played ?? null)).toEqual(["13/10 13/8", null, null]);
    expect(v.ratings.game[1]).toMatchObject({ decisions: 2, pr: 0 });
    expect(v.ratings.game[0].decisions).toBe(1);
    expect(v.version).toBe(3);

    // A roll with the cube available is a graded no-double.
    dice = [[3, 1]];
    const r = await playAction(deps(), id, { type: "roll" }, v.version);
    expect(r.graded.map((d) => [d.kind, d.playedText])).toEqual([["cube", "No double"]]);
    expect(r.state.phase).toEqual({ kind: "move", player: 1 });
    await expect(playAction(deps(), id, { type: "double" }, r.version)).rejects.toThrow(PlayError);
    await expect(playAction(deps(), id, { type: "move", play: "13/7" }, r.version)).rejects.toThrow(PlayError);
    await expect(playAction(deps(), id, { type: "move", play: "8/5 6/5" }, v.version)).rejects.toThrow(PlayConflictError);
  });

  it("handles the user's double: gnubg takes and the user rolls on", async () => {
    dice = [[2, 6]];
    const start = await startPlayMatch(deps(), MONEY, "You");
    dice = [[4, 2]];
    const v = await playAction(deps(), start.matchId, { type: "double" }, start.version);
    expect(v.graded.map((d) => d.playedText)).toEqual(["Double"]);
    expect(v.graded[0].played?.loss).toBe(0.1);
    expect(v.events.map((e) => e.type)).toEqual(["double", "take", "roll"]);
    expect(v.state.phase).toEqual({ kind: "move", player: 1 });
    expect([v.state.position.cubeValue, v.state.position.cubeOwner]).toEqual([2, 2]);
    const take = getDecision(db, `play-${start.matchId}-g1-m2-p2-take`);
    expect([take?.played, take?.loss]).toEqual(["take", 0]);
  });

  it("ends a game on a pass and starts the next one", async () => {
    dice = [[2, 6]];
    const start = await startPlayMatch(deps(), MONEY, "You");
    engine.take = "pass";
    const v = await playAction(deps(), start.matchId, { type: "double" }, start.version);
    expect(v.events.map((e) => e.type)).toEqual(["double", "pass", "game-over"]);
    expect(v.state.phase).toEqual({ kind: "game-over", winner: 1, points: 1, how: "pass", matchOver: false });
    expect(listGames(db, start.matchId).map((g) => [g.number, g.winner, g.points])).toEqual([[1, 1, 1]]);
    await expect(playAction(deps(), start.matchId, { type: "roll" }, v.version)).rejects.toThrow(PlayError);
    dice = [[1, 5]];
    const next = await playAction(deps(), start.matchId, { type: "next-game" }, v.version);
    expect(next.events.map((e) => e.type)).toEqual(["opening", "move"]);
    expect([next.state.game, next.state.score]).toEqual([2, [1, 0]]);
    expect(next.log.map((l) => l.decisionId)).toEqual([`play-${start.matchId}-g2-m1-p2-checker`]);
    expect(listGames(db, start.matchId).map((g) => [g.number, g.score1, g.score2])).toEqual([
      [1, 0, 0],
      [2, 1, 0],
    ]);
  });

  it("finishes a match on the last checker, and a money session on request", async () => {
    dice = [[5, 3]];
    const one = await startPlayMatch(deps(), { matchLength: 1, jacoby: false }, "You");
    const version = force(one.matchId, (s) => position(s, "-A----------------------c-:0:0:1:21:0:0:0:1:10", { kind: "move", player: 1 }));
    const v = await playAction(deps(), one.matchId, { type: "move", play: "1/off" }, version);
    expect(v.graded).toEqual([]); // forced: nothing to grade
    expect(v.state.phase).toMatchObject({ kind: "game-over", winner: 1, matchOver: true });
    expect(v.status).toBe("finished");
    await expect(playAction(deps(), one.matchId, { type: "next-game" }, v.version)).rejects.toThrow("finished");

    dice = [[5, 3]];
    const money = await startPlayMatch(deps(), MONEY, "You");
    await expect(playAction(deps(), money.matchId, { type: "end" }, money.version)).rejects.toThrow(PlayError);
    const over = force(money.matchId, (s) => ({ ...s, phase: { kind: "game-over", winner: 2, points: 2, how: "gammon", matchOver: false } }));
    const ended = await playAction(deps(), money.matchId, { type: "end" }, over);
    expect(ended.status).toBe("finished");
    expect(playView(db, money.matchId).status).toBe("finished");
  });
});

describe("quiz picks", () => {
  it("stores the latest choice per decision", () => {
    setQuizPick(db, "play-1-g1-m1-checker", true, NOW);
    setQuizPick(db, "match-9-g1-m2-checker", false, NOW);
    setQuizPick(db, "play-1-g1-m1-checker", false, NOW);
    expect(readQuizPicks(db)).toEqual(
      new Map([
        ["play-1-g1-m1-checker", false],
        ["match-9-g1-m2-checker", false],
      ]),
    );
  });
});
