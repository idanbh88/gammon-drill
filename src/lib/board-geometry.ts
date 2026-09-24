/**
 * Board layout in SVG user units (viewBox 960 × 720), shared by the renderer (Board.tsx), the
 * checker animations and drag-and-drop hit-testing. "me" is the player drawn at the bottom,
 * "them" the one at the top; a point is given in that player's own numbering, with 25 = their
 * bar and 0 = their side of the bear-off tray. Pure and client-safe.
 */
import type { PerspectiveView } from "./board";

export const W = 960;
export const H = 720;
export const T = 40; // header height; the board frame starts here
export const BOARD_H = 640;
export const FRAME = 30; // frame thickness top/bottom
export const PW = 60; // point width
export const PH = 240; // point height
export const R = 23; // checker radius
export const LEFT = 80; // x where the left half starts (cube column before it)
export const BAR_X = LEFT + 6 * PW; // 440
export const BAR_W = 60;
export const RIGHT = BAR_X + BAR_W; // 500
export const TRAY_X = RIGHT + 6 * PW; // 860
export const TRAY_W = 80;
export const TOP_Y = T + FRAME; // top of the playing surface
export const BOT_Y = T + BOARD_H - FRAME; // bottom of the playing surface
export const MID_Y = (TOP_Y + BOT_Y) / 2;
export const HALF_H = (BOT_Y - TOP_Y) / 2;
export const MAX_STACK = 5;
/** Distance of the first checker on the bar from the middle of the board. */
export const BAR_OFFSET = 60;
/** Height of one borne-off chip in the tray, plus its gap. */
export const CHIP = 12;

export type Side = "me" | "them";

export interface Point2 {
  cx: number;
  cy: number;
}

export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Column (0..11, left to right) and half of a point in the bottom player's numbering. */
export function columnOf(point: number): { c: number; top: boolean } {
  return point <= 12 ? { c: 12 - point, top: false } : { c: point - 13, top: true };
}

export function columnX(c: number): number {
  return c < 6 ? LEFT + c * PW : RIGHT + (c - 6) * PW;
}

/** The bottom player's number of a point given in `side`'s numbering. */
export function bottomPoint(side: Side, point: number): number {
  return side === "me" || point === 0 || point === 25 ? point : 25 - point;
}

/** The half-column of a point, a bar half (25) or a tray half (0). */
export function areaOf(side: Side, point: number): Area {
  const bottom = side === "me";
  if (point === 25) return { x: BAR_X, y: bottom ? MID_Y : TOP_Y, w: BAR_W, h: HALF_H };
  if (point === 0) return { x: TRAY_X, y: bottom ? MID_Y : TOP_Y, w: TRAY_W, h: HALF_H };
  const { c, top } = columnOf(bottomPoint(side, point));
  return { x: columnX(c), y: top ? TOP_Y : MID_Y, w: PW, h: HALF_H };
}

/**
 * Centre of the checker at stack position `index` (0 = against the frame, or the first on the
 * bar, or the lowest chip in the tray). Stacks show at most MAX_STACK checkers, so a higher index
 * lands on the last one drawn.
 */
export function slotOf(side: Side, point: number, index: number): Point2 {
  const bottom = side === "me";
  const i = Math.max(0, index);
  if (point === 25) {
    const k = Math.min(i, MAX_STACK - 1);
    return { cx: BAR_X + BAR_W / 2, cy: bottom ? MID_Y + BAR_OFFSET + k * 2 * R : MID_Y - BAR_OFFSET - k * 2 * R };
  }
  if (point === 0) {
    return { cx: TRAY_X + TRAY_W / 2, cy: bottom ? BOT_Y - 1 - (i + 1) * CHIP : TOP_Y + 11 + i * CHIP };
  }
  const { c, top } = columnOf(bottomPoint(side, point));
  const k = Math.min(i, MAX_STACK - 1);
  return { cx: columnX(c) + PW / 2, cy: top ? TOP_Y + R + k * 2 * R : BOT_Y - R - k * 2 * R };
}

/** How many of `side`'s checkers are at `point` (its own numbering; 25 = bar, 0 = off). */
export function countAt(view: PerspectiveView, side: Side, point: number): number {
  if (point === 25) return side === "me" ? view.myBar : view.theirBar;
  if (point === 0) return side === "me" ? view.myOff : view.theirOff;
  const v = view.points[bottomPoint(side, point)];
  return side === "me" ? Math.max(0, v) : Math.max(0, -v);
}

/** Centre of the outermost of `side`'s checkers at `point` in `view` (where a new one would go when `next`). */
export function topSlot(view: PerspectiveView, side: Side, point: number, next = false): Point2 {
  const n = countAt(view, side, point);
  return slotOf(side, point, next ? n : n - 1);
}

/**
 * The bottom player's point under an SVG coordinate: 1..24, 25 for the bar (the bottom half,
 * where their checkers wait), 0 for the whole bear-off tray; null outside the playing area.
 */
export function pointAt(x: number, y: number): number | null {
  if (y < TOP_Y || y > BOT_Y) return null;
  if (x >= TRAY_X && x < TRAY_X + TRAY_W) return 0;
  if (x >= BAR_X && x < RIGHT) return y >= MID_Y ? 25 : null;
  let c: number;
  if (x >= LEFT && x < BAR_X) c = Math.floor((x - LEFT) / PW);
  else if (x >= RIGHT && x < TRAY_X) c = 6 + Math.floor((x - RIGHT) / PW);
  else return null;
  return y < MID_Y ? c + 13 : 12 - c;
}
