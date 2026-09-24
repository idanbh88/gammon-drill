import { describe, expect, it } from "vitest";
import { toPerspective } from "@/lib/board";
import { buildTimeline, dropFrames, snapBackFrames, stepFrames, timing, type Timing } from "@/lib/board-animation";
import { BOT_Y, MID_Y, R, RIGHT, TOP_Y, countAt, pointAt, slotOf, topSlot } from "@/lib/board-geometry";
import type { PlayEvent } from "@/lib/play-service";
import { parseXgid, toXgid } from "@/lib/xgid";

const OPENING = "-b----E-C---eE---c-e----B-";
const T: Timing = timing("normal")!;

describe("board geometry", () => {
  it("puts checkers where the board draws them", () => {
    expect(slotOf("me", 1, 0)).toEqual({ cx: RIGHT + 5 * 60 + 30, cy: BOT_Y - R });
    expect(slotOf("them", 1, 0)).toEqual({ cx: RIGHT + 5 * 60 + 30, cy: TOP_Y + R }); // their ace point is my 24
    expect(slotOf("me", 6, 1).cy).toBe(BOT_Y - R - 2 * R);
    expect(slotOf("me", 6, 9)).toEqual(slotOf("me", 6, 4)); // stacks show five
    expect(slotOf("me", 25, 0)).toEqual({ cx: 470, cy: MID_Y + 60 });
    expect(slotOf("them", 25, 0)).toEqual({ cx: 470, cy: MID_Y - 60 });
    expect(slotOf("me", 0, 0).cy).toBeGreaterThan(MID_Y);
  });

  it("finds the point under a coordinate", () => {
    for (let p = 1; p <= 24; p++) {
      const s = slotOf("me", p, 0);
      expect(pointAt(s.cx, s.cy)).toBe(p);
    }
    expect(pointAt(470, MID_Y + 60)).toBe(25);
    expect(pointAt(470, MID_Y - 60)).toBeNull();
    expect(pointAt(900, 200)).toBe(0);
    expect(pointAt(40, 300)).toBeNull(); // the cube column
    expect(pointAt(300, 10)).toBeNull();
  });

  it("counts checkers per side", () => {
    const view = toPerspective(parseXgid(`${OPENING}:0:0:1:31:0:0:0:7:10`), 1);
    expect([countAt(view, "me", 6), countAt(view, "me", 24), countAt(view, "them", 6), countAt(view, "them", 24), countAt(view, "them", 1)]).toEqual([5, 2, 5, 2, 0]);
    expect(topSlot(view, "me", 6)).toEqual(slotOf("me", 6, 4));
    expect(topSlot(view, "me", 5, true)).toEqual(slotOf("me", 5, 0));
  });
});

describe("step frames", () => {
  it("glides gnubg's checker from the top of its stack to where it lands", () => {
    const pos = parseXgid(`${OPENING}:0:0:-1:31:0:0:0:7:10`);
    const { frames, after } = stepFrames(pos, 2, [{ from: 24, to: 21, hit: false }], T);
    expect(frames).toHaveLength(1);
    expect(frames[0].hide).toEqual([{ side: "them", point: 24 }]);
    expect(frames[0].flights).toEqual([{ from: slotOf("them", 24, 1), to: slotOf("them", 21, 0), mine: false, ms: T.step }]);
    expect(toXgid(after)).toBe("-a--a-E-C---eE---c-e----B-:0:0:-1:31:0:0:0:7:10"); // White 24/21 = Blue's 1-point to Blue's 4-point
  });

  it("sends a hit checker to the bar after the hitter lands", () => {
    // White (gnubg) hits a Blue blot on White's 20-point (Blue's 5-point) with a 4 from its 24.
    const pos = parseXgid("-b---AD-C---eE---c-e----A-:0:0:-1:41:0:0:0:7:10");
    const { frames, after } = stepFrames(pos, 2, [{ from: 24, to: 20, hit: true }], T);
    expect(frames).toHaveLength(2);
    expect(frames[1].hide).toEqual([{ side: "me", point: 25 }]);
    expect(frames[1].flights?.[0]).toMatchObject({ from: slotOf("me", 5, 0), to: slotOf("me", 25, 0), mine: true });
    expect(toPerspective(after, 1).myBar).toBe(1);
  });

  it("settles a dropped checker and sends a cancelled one back", () => {
    const pos = parseXgid(`${OPENING}:0:0:1:31:0:0:0:7:10`);
    const at = { cx: 700, cy: 500 };
    const drop = dropFrames(pos, [{ from: 8, to: 5, hit: false }], at, T);
    expect(drop).toHaveLength(1);
    expect(drop[0].hide).toEqual([{ side: "me", point: 8 }]);
    expect(drop[0].flights?.[0]).toMatchObject({ from: at, to: slotOf("me", 5, 0), mine: true, ms: T.snap });
    const back = snapBackFrames(pos, 8, at, T);
    expect(back[0].flights?.[0]).toMatchObject({ from: at, to: slotOf("me", 8, 2) });
    expect(dropFrames(pos, [], at, T)).toEqual([]);
  });
});

describe("timeline", () => {
  it("replays gnubg's turn after the user's own play, which is already on the board", () => {
    const events: PlayEvent[] = [
      { type: "move", player: 1, play: "8/5 6/5", forced: false, xgid: `${OPENING}:0:0:1:31:0:0:0:7:10` },
      { type: "roll", player: 2, dice: [6, 4] },
      { type: "move", player: 2, play: "24/18 13/9", forced: false, xgid: "-b---BD-B---eE---c-e----B-:0:0:-1:64:0:0:0:7:10" },
    ];
    const frames = buildTimeline(events, parseXgid(`${OPENING}:0:0:1:31:0:0:0:7:10`), T, { skipFirstUserMove: true, final: parseXgid(`${OPENING}:0:0:1:00:0:0:0:7:10`) });
    expect(frames.map((f) => [f.ms, Boolean(f.rolling), f.flights?.length ?? 0])).toEqual([
      [T.roll, true, 0],
      [T.step, false, 1],
      [T.step, false, 1],
      [T.pause, false, 0],
    ]);
    expect(frames[0].position.dice).toEqual([6, 4]);
    expect(frames[0].caption).toBe("gnubg rolled 64: 24/18 13/9.");
  });

  it("shows cube actions, the user's roll and the opening", () => {
    const start = parseXgid(`${OPENING}:0:0:1:00:0:0:0:7:10`);
    const frames = buildTimeline(
      [
        { type: "double", player: 1, cube: 2 },
        { type: "take", player: 2 },
        { type: "roll", player: 1, dice: [4, 2] },
      ],
      start,
      T,
      { skipFirstUserMove: false, final: start },
    );
    expect(frames.map((f) => f.caption)).toEqual(["You double to 2.", "gnubg takes.", "You rolled 42."]);
    expect(frames[0].position.cubeAction).toBe("double");
    expect([frames[1].position.cubeValue, frames[1].position.cubeOwner]).toEqual([2, 2]);
    expect([frames[2].position.dice, frames[2].position.turn, frames[2].rolling]).toEqual([[4, 2], 1, true]);

    const opening = buildTimeline([{ type: "opening", game: 2, dice: [5, 3], first: 1 }], start, T, { skipFirstUserMove: false, final: parseXgid(`${OPENING}:0:0:1:53:1:0:0:7:10`) });
    expect(opening).toHaveLength(1);
    expect(opening[0]).toMatchObject({ openingDice: [5, 3], rolling: true, ms: T.opening });
    expect(opening[0].position.dice).toBeNull();
  });

  it("has lengths for every speed, and none when off", () => {
    expect(timing("off")).toBeNull();
    expect(timing("slow")!.step).toBeGreaterThan(T.step);
    expect(timing("fast")!.step).toBeLessThan(T.step);
  });
});
