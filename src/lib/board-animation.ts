/**
 * Checker animations for the play screen, as frames the board shows one after another: a still
 * (a position, a caption, a pause) or a flight (the position with the moving checker left out,
 * and that checker gliding from one slot to another). Built from the server's events for gnubg's
 * turn, and from single steps for the user's own taps, drops and cancelled drags. The board is
 * drawn from the user's side (player 1 at the bottom). Pure and client-safe.
 */
import { opponent, toPerspective, withState } from "./board";
import { countAt, slotOf, topSlot, type Point2, type Side } from "./board-geometry";
import { applySteps, parsePlay, stateFromView, type MoveStep } from "./moves";
import type { PlayEvent } from "./play-service";
import { parseXgid, type Player, type Position } from "./xgid";

export interface Flight {
  from: Point2;
  to: Point2;
  /** The bottom player's checker (Blue). */
  mine: boolean;
  ms: number;
}

export interface Frame {
  position: Position;
  /** Checkers left out of the drawing while they fly. */
  hide?: { side: Side; point: number }[];
  flights?: Flight[];
  ms: number;
  caption?: string;
  /** The opening roll, [the user's die, gnubg's die]. */
  openingDice?: [number, number];
  /** The dice tumble as this frame appears. */
  rolling?: boolean;
}

export const SPEEDS = ["slow", "normal", "fast", "off"] as const;
export type Speed = (typeof SPEEDS)[number];

export interface Timing {
  /** gnubg's dice on the board before it moves. */
  roll: number;
  /** One checker of gnubg's gliding to its point. */
  step: number;
  /** A hit checker gliding to the bar. */
  hit: number;
  /** A still after a move or an event of the user's. */
  pause: number;
  /** gnubg's double, take or pass. */
  cube: number;
  opening: number;
  /** The user's own roll. */
  userRoll: number;
  /** The user's own checker after a tap. */
  userStep: number;
  /** A dropped checker settling, or a cancelled drag going back. */
  snap: number;
}

// "Normal": gnubg takes about the time a person would, a second or two per move; the user's own taps stay quick.
const BASE: Timing = { roll: 900, step: 560, hit: 380, pause: 550, cube: 1200, opening: 1500, userRoll: 450, userStep: 190, snap: 140 };

/** Frame lengths for a speed; null when animations are off. */
export function timing(speed: Speed): Timing | null {
  if (speed === "off") return null;
  const k = speed === "slow" ? 1.6 : speed === "fast" ? 0.5 : 1;
  const out = { ...BASE };
  for (const key of Object.keys(out) as (keyof Timing)[]) out[key] = Math.round(BASE[key] * k);
  return out;
}

const sideOf = (p: Player): Side => (p === 1 ? "me" : "them");
const who = (p: Player) => (p === 1 ? "You" : "gnubg");
const verb = (p: Player, you: string, it: string) => (p === 1 ? you : it);

function applyStep(pos: Position, mover: Player, step: MoveStep): Position | null {
  const state = applySteps(stateFromView(toPerspective(pos, mover)), [step]);
  return state ? withState(pos, mover, state) : null;
}

/**
 * Frames for `steps` of `mover` from `pos`: each checker glides from the top of its stack to where
 * it lands, then a checker it hit glides to the bar. Returns the frames and the position after.
 */
export function stepFrames(pos: Position, mover: Player, steps: MoveStep[], t: Pick<Timing, "step" | "hit">): { frames: Frame[]; after: Position } {
  const frames: Frame[] = [];
  const side = sideOf(mover);
  const other = sideOf(opponent(mover));
  let cur = pos;
  for (const step of steps) {
    const next = applyStep(cur, mover, step);
    if (!next) break;
    const before = toPerspective(cur, 1);
    const after = toPerspective(next, 1);
    frames.push({
      position: cur,
      hide: [{ side, point: step.from }],
      flights: [{ from: topSlot(before, side, step.from), to: topSlot(after, side, step.to), mine: mover === 1, ms: t.step }],
      ms: t.step,
    });
    if (step.to !== 0 && countAt(before, other, 25 - step.to) === 1) {
      frames.push({
        position: next,
        hide: [{ side: other, point: 25 }],
        flights: [{ from: slotOf(other, 25 - step.to, 0), to: topSlot(after, other, 25), mine: mover !== 1, ms: t.hit }],
        ms: t.hit,
      });
    }
    cur = next;
  }
  return { frames, after: cur };
}

/**
 * A checker dropped at `at` settling where its steps end, then a checker it hit on the last step
 * going to the bar. While it settles the board shows the position before that last step (the hit
 * checker still on its point), without the dropped checker.
 */
export function dropFrames(pos: Position, steps: MoveStep[], at: Point2, t: Pick<Timing, "snap" | "hit">): Frame[] {
  if (steps.length === 0) return [];
  let beforeLast = pos;
  for (const step of steps.slice(0, -1)) {
    const next = applyStep(beforeLast, 1, step);
    if (!next) return [];
    beforeLast = next;
  }
  const last = steps[steps.length - 1];
  const after = applyStep(beforeLast, 1, last);
  if (!after) return [];
  const afterView = toPerspective(after, 1);
  const frames: Frame[] = [
    {
      position: beforeLast,
      hide: [{ side: "me", point: last.from }],
      flights: [{ from: at, to: topSlot(afterView, "me", last.to), mine: true, ms: t.snap }],
      ms: t.snap,
    },
  ];
  if (last.to !== 0 && countAt(toPerspective(beforeLast, 1), "them", 25 - last.to) === 1) {
    frames.push({
      position: after,
      hide: [{ side: "them", point: 25 }],
      flights: [{ from: slotOf("them", 25 - last.to, 0), to: topSlot(afterView, "them", 25), mine: false, ms: t.hit }],
      ms: t.hit,
    });
  }
  return frames;
}

/** A dragged checker that was not dropped on a landing point going back to its stack. */
export function snapBackFrames(pos: Position, from: number, at: Point2, t: Pick<Timing, "snap">): Frame[] {
  const to = topSlot(toPerspective(pos, 1), "me", from);
  return [{ position: pos, hide: [{ side: "me", point: from }], flights: [{ from: at, to, mine: true, ms: t.snap }], ms: t.snap }];
}

function steps(play: string): MoveStep[] {
  try {
    return parsePlay(play);
  } catch {
    return [];
  }
}

/**
 * The frames for what happened on the server after the user's action: gnubg's rolls and moves
 * checker by checker, cube actions, the user's automatic rolls and plays, the opening roll of a
 * new game, the end of a game. `start` is the position on the board before; `final` is the
 * position the server ended on. The user's own play is already on the board, so with
 * `skipFirstUserMove` it is not replayed.
 */
export function buildTimeline(events: PlayEvent[], start: Position, t: Timing, opts: { skipFirstUserMove: boolean; final: Position }): Frame[] {
  const frames: Frame[] = [];
  let cur = start;
  events.forEach((e, idx) => {
    const prev = events[idx - 1];
    const next = events[idx + 1];
    switch (e.type) {
      case "opening": {
        const pos = next?.type === "move" ? parseXgid(next.xgid) : opts.final;
        frames.push({
          position: { ...pos, dice: null },
          openingDice: [e.dice[0], e.dice[1]],
          rolling: true,
          ms: t.opening,
          caption: `Game ${e.game}: you roll ${e.dice[0]}, gnubg ${e.dice[1]}. ${e.first === 1 ? "You start." : "gnubg starts."}`,
        });
        cur = pos;
        break;
      }
      case "roll": {
        if (next?.type === "move" && next.player === e.player) break; // the move shows its roll
        cur = { ...cur, turn: e.player, dice: e.dice, cubeAction: "none" };
        frames.push({ position: cur, rolling: true, ms: e.player === 1 ? t.userRoll : t.roll, caption: `${who(e.player)} rolled ${e.dice[0]}${e.dice[1]}.` });
        break;
      }
      case "move": {
        const pre = parseXgid(e.xgid);
        const { frames: flights, after } = stepFrames(pre, e.player, steps(e.play), t);
        const done = { ...after, dice: null, turn: opponent(e.player), cubeAction: "none" as const };
        if (opts.skipFirstUserMove && idx === 0 && e.player === 1) {
          cur = done;
          break;
        }
        const dice = `${pre.dice?.[0] ?? ""}${pre.dice?.[1] ?? ""}`;
        const caption = `${who(e.player)} rolled ${dice}: ${e.play}${e.forced ? " (forced)" : ""}.`;
        if (prev?.type !== "opening") frames.push({ position: pre, rolling: true, ms: e.player === 1 ? t.userRoll : t.roll, caption });
        frames.push(...flights.map((f) => ({ ...f, caption })));
        frames.push({ position: after, ms: t.pause, caption });
        cur = done;
        break;
      }
      case "no-move":
        frames.push({ position: { ...cur, turn: e.player, dice: e.dice }, ms: t.pause * 2, caption: `${who(e.player)} rolled ${e.dice[0]}${e.dice[1]} and cannot move.` });
        cur = { ...cur, turn: opponent(e.player), dice: null };
        break;
      case "double":
        cur = { ...cur, turn: e.player, dice: null, cubeAction: "double" };
        frames.push({ position: cur, ms: e.player === 2 ? t.cube : t.pause, caption: `${who(e.player)} ${verb(e.player, "double", "doubles")} to ${e.cube}.` });
        break;
      case "take":
        cur = { ...cur, cubeValue: cur.cubeValue * 2, cubeOwner: e.player, cubeAction: "none" };
        frames.push({ position: cur, ms: e.player === 2 ? t.cube : t.pause, caption: `${who(e.player)} ${verb(e.player, "take", "takes")}.` });
        break;
      case "pass":
        cur = { ...cur, cubeAction: "none" };
        frames.push({ position: cur, ms: e.player === 2 ? t.cube : t.pause, caption: `${who(e.player)} ${verb(e.player, "pass", "passes")}.` });
        break;
      case "game-over":
        frames.push({
          position: cur,
          ms: t.pause * 2,
          caption: `${e.winner === 1 ? "You win" : "gnubg wins"} ${e.points} point${e.points === 1 ? "" : "s"}${e.matchOver ? " and the match" : ""}.`,
        });
        break;
    }
  });
  return frames;
}
