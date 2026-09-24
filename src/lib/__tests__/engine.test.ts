import path from "node:path";
import { describe, expect, it } from "vitest";
import { asciiDir, findGnubg, getEngine } from "@/lib/engine";

const OPENING_31 = "-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:7:10";
const RACE_OFFERED = "---BCCD-B-A--a-a-b-dcca---:0:0:1:D:2:1:0:7:10";

describe("engine helpers", () => {
  it("prefers BG_GNUBG, then PATH", () => {
    expect(findGnubg({ BG_GNUBG: __filename, PATH: "" })).toBe(__filename);
    const onPath = findGnubg({ PATH: path.dirname(__filename) });
    // No gnubg-cli next to this test: falls through to the install folders (or null).
    expect(onPath === null || /gnubg/i.test(onPath)).toBe(true);
  });

  it("picks a folder gnubg can open", () => {
    expect(asciiDir({}, "C:\\Users\\SHORT~1\\AppData\\Local\\Temp")).toBe(path.join("C:\\Users\\SHORT~1\\AppData\\Local\\Temp", "bg-engine"));
    expect(asciiDir({ PUBLIC: "C:\\Users\\Public" }, "C:\\Users\\עידן\\AppData\\Local\\Temp")).toBe(path.join("C:\\Users\\Public", "bg-engine"));
  });
});

// A real gnubg round trip (about 3 s), skipped where gnubg is not installed.
describe.skipIf(findGnubg() === null)("the live engine", () => {
  it("grades a play and a take with gnubg", { timeout: 120_000 }, async () => {
    const engine = getEngine();
    const [best, mine, take] = await Promise.all([
      engine.analyse({ xgid: OPENING_31 }),
      engine.analyse({ xgid: OPENING_31, played: "24/23 13/10" }),
      engine.analyse({ xgid: RACE_OFFERED, played: "pass" }),
    ]);
    expect([best.kind, best.best, best.loss]).toEqual(["checker", "8/5 6/5", 0]);
    expect(mine.playedAnswerId).toBe("24/23 13/10");
    expect(mine.loss).toBeGreaterThan(0.1);
    expect([take.kind, take.best, take.played]).toEqual(["take", "take", "pass"]);
    expect(take.loss).toBeCloseTo(0.208, 3);
    expect(take.cube).toMatchObject({ proper: "Double, take" });
    expect(take.answers.map((a) => a.id)).toEqual(["take", "pass"]);
  });
});
