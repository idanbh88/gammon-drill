"use client";

import { useMemo, useRef, useState } from "react";
import type { Frame } from "@/lib/board-animation";
import { pointAt, type Point2 } from "@/lib/board-geometry";
import { destinations, diceUsage, isComplete, movableFrom, type MoveEntry } from "@/lib/move-input";
import type { Position } from "@/lib/xgid";
import Board, { Checker, type BoardMark } from "./Board";
import FlyingChecker from "./FlyingChecker";

/** Pointer travel (SVG units) that turns a press into a drag instead of a tap. */
const DRAG_START = 8;

interface Drag {
  from: number;
  at: Point2;
  start: Point2;
  moved: boolean;
}

/**
 * The play screen's board. Draws an animation frame when one is running, else the live position.
 * While the user moves: a tap on a checker moves it by the first die that works (onTap), a drag
 * shows the landing points and drops there (onDrop) or goes back (onCancelDrag), and pressing the
 * dice swaps them or, once the play is complete, plays it (onDice). During gnubg's animation any
 * press skips it (onSkip).
 */
export default function PlayBoard({
  position,
  frame,
  blocking,
  entry,
  marks,
  onTap,
  onDrop,
  onCancelDrag,
  onDice,
  onSkip,
}: {
  position: Position;
  frame: Frame | null;
  /** gnubg's animation is running: input only skips it. */
  blocking: boolean;
  /** The user's move in progress, or null when it is not their move. */
  entry: MoveEntry | null;
  marks: BoardMark[];
  onTap: (from: number) => void;
  onDrop: (from: number, to: number, at: Point2) => void;
  onCancelDrag: (from: number, at: Point2) => void;
  onDice: () => void;
  onSkip: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const live = entry && !blocking;
  const sources = useMemo(() => (live ? movableFrom(entry) : new Set<number>()), [live, entry]);
  const targets = useMemo(() => (live && drag?.moved ? new Set(destinations(entry, drag.from).keys()) : new Set<number>()), [live, entry, drag]);

  function toSvg(e: React.PointerEvent): Point2 | null {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { cx: p.x, cy: p.y };
  }

  function down(e: React.PointerEvent<SVGSVGElement>) {
    if (blocking) {
      onSkip();
      return;
    }
    if (!live) return;
    const at = toSvg(e);
    if (!at) return;
    const from = pointAt(at.cx, at.cy);
    if (from === null || !sources.has(from)) return;
    try {
      // Keep receiving the pointer while it leaves the board.
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // a pointer the browser no longer tracks: the drag still works while over the board
    }
    setDrag({ from, at, start: at, moved: false });
  }

  function move(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const at = toSvg(e);
    if (!at) return;
    const moved = drag.moved || Math.hypot(at.cx - drag.start.cx, at.cy - drag.start.cy) > DRAG_START;
    setDrag({ ...drag, at, moved });
  }

  function up(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag || !entry) return;
    const d = drag;
    setDrag(null);
    if (!d.moved) {
      onTap(d.from);
      return;
    }
    const at = toSvg(e) ?? d.at;
    const to = pointAt(at.cx, at.cy);
    if (to !== null && destinations(entry, d.from).has(to)) onDrop(d.from, to, at);
    else onCancelDrag(d.from, at);
  }

  const dice =
    entry && !blocking
      ? { values: entry.order, used: diceUsage(entry), ready: isComplete(entry) && entry.length > 0, onPress: onDice }
      : undefined;

  if (frame) {
    return (
      <Board
        position={frame.position}
        perspective={1}
        hide={frame.hide}
        openingDice={frame.openingDice}
        rolling={frame.rolling}
        dice={blocking ? undefined : dice}
        overlay={frame.flights?.map((f, i) => (
          <FlyingChecker key={`${i}:${f.from.cx},${f.from.cy}>${f.to.cx},${f.to.cy}`} flight={f} />
        ))}
        interactive
        svgRef={svgRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => setDrag(null)}
      />
    );
  }

  return (
    <Board
      position={position}
      perspective={1}
      marks={drag ? [] : marks}
      highlight={live ? { sources, targets, selected: drag?.moved ? drag.from : null } : undefined}
      dice={dice}
      hide={drag?.moved ? [{ side: "me", point: drag.from }] : undefined}
      overlay={drag?.moved ? <Checker cx={drag.at.cx} cy={drag.at.cy} mine lifted /> : undefined}
      interactive
      svgRef={svgRef}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => setDrag(null)}
    />
  );
}
