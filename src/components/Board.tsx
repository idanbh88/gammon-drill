import {
  ME_NAME,
  THEM_NAME,
  actingPlayer,
  scoreCaption,
  toPerspective,
  type PerspectiveView,
} from "@/lib/board";
import {
  BAR_OFFSET,
  BAR_W,
  BAR_X,
  BOARD_H,
  BOT_Y,
  CHIP,
  H,
  LEFT,
  MAX_STACK,
  MID_Y,
  PH,
  PW,
  R,
  RIGHT,
  T,
  TOP_Y,
  TRAY_W,
  TRAY_X,
  W,
  areaOf,
  columnOf,
  columnX,
  topSlot,
  type Side,
} from "@/lib/board-geometry";
import type { Player, Position } from "@/lib/xgid";

/**
 * SVG backgammon board. The `perspective` player (default: the player who has to act) is
 * drawn at the bottom as Blue, moving counter-clockwise: home board bottom-right (points 1-6),
 * 7-12 bottom-left, 13-18 top-left, 19-24 top-right. Layout constants and checker positions
 * live in board-geometry.ts. Without the optional play props below the board is a static
 * picture (quiz, match review, /board); no hooks here, so server pages can render it.
 */

const BLUE = "var(--color-blue-checker)";
const BLUE_DARK = "var(--color-blue-checker-dark)";
const WHITE = "var(--color-white-checker)";
const WHITE_DARK = "var(--color-white-checker-dark)";

export function Checker({ cx, cy, mine, label, lifted }: { cx: number; cy: number; mine: boolean; label?: string; lifted?: boolean }) {
  return (
    <g>
      {lifted && <circle cx={cx + 3} cy={cy + 5} r={R} fill="rgb(0 0 0 / 0.25)" />}
      <circle cx={cx} cy={cy} r={R} fill={mine ? BLUE : WHITE} stroke={mine ? BLUE_DARK : WHITE_DARK} strokeWidth={2} />
      {label && (
        <text x={cx} y={cy + 6} textAnchor="middle" fontSize={18} fontWeight={700} fill={mine ? "#fff" : "#333"}>
          {label}
        </text>
      )}
    </g>
  );
}

function Stack({
  cx,
  startY,
  dir,
  count,
  mine,
}: {
  cx: number;
  startY: number;
  dir: 1 | -1;
  count: number;
  mine: boolean;
}) {
  const n = Math.min(count, MAX_STACK);
  return (
    <>
      {Array.from({ length: n }, (_, k) => (
        <Checker
          key={k}
          cx={cx}
          cy={startY + dir * k * 2 * R}
          mine={mine}
          label={k === n - 1 && count > MAX_STACK ? String(count) : undefined}
        />
      ))}
    </>
  );
}

const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ],
};

function Die({ cx, cy, value, size = 48, used = false }: { cx: number; cy: number; value: number; size?: number; used?: boolean }) {
  const h = size / 2;
  const step = size * 0.27;
  return (
    <g opacity={used ? 0.35 : 1} data-die={value} data-used={used || undefined}>
      <rect x={cx - h} y={cy - h} width={size} height={size} rx={size / 6} fill="#fffdf7" stroke="#333" strokeWidth={2} />
      {PIPS[value].map(([dx, dy], i) => (
        <circle key={i} cx={cx + dx * step} cy={cy + dy * step} r={size / 9.6} fill="#222" />
      ))}
    </g>
  );
}

function Cube({ y, value, offered }: { y: number; value: number; offered: boolean }) {
  return (
    <g transform={`translate(40 ${y})`}>
      <rect
        x={-28}
        y={-28}
        width={56}
        height={56}
        rx={8}
        fill="#f8f4e8"
        stroke={offered ? "#e0a800" : "#333"}
        strokeWidth={offered ? 4 : 2}
      />
      <text y={9} textAnchor="middle" fontSize={26} fontWeight={700} fill="#222">
        {value}
      </text>
      {offered && (
        <text y={48} textAnchor="middle" fontSize={13} fill="#333">
          offered
        </text>
      )}
    </g>
  );
}

function cubeCaption(pos: Position, me: Player): string {
  if (pos.cubeAction === "double") {
    const doubler = pos.turn === me ? ME_NAME : THEM_NAME;
    return `${doubler} offers the cube at ${pos.cubeValue * 2}`;
  }
  if (pos.cubeOwner === "center") return `Cube centered at ${pos.cubeValue}`;
  return `Cube ${pos.cubeValue}, ${pos.cubeOwner === me ? ME_NAME : THEM_NAME} owns`;
}

/** Lit points while moving: in the bottom player's numbering, 25 = their bar, 0 = the tray. */
export interface BoardHighlight {
  /** Checkers that can move. */
  sources: ReadonlySet<number>;
  /** Where the checker being dragged can land. */
  targets: ReadonlySet<number>;
  /** The point a checker is being dragged from. */
  selected?: number | null;
}

/** One checker step to mark (the last move), in the mover's own numbering (25 = bar, 0 = off). */
export interface BoardMark {
  side: Side;
  from: number;
  to: number;
}

/** The bottom player's dice while they move: in tap order, used ones dimmed. */
export interface BoardDice {
  values: number[];
  used: boolean[];
  /** The play is complete: pressing the dice plays it. */
  ready?: boolean;
  onPress?: () => void;
}

/** One checker left out of the drawing (being dragged or in flight), in `side`'s numbering. */
export interface BoardHide {
  side: Side;
  point: number;
}

export interface BoardProps {
  position: Position;
  /** Player drawn at the bottom. Defaults to the player who has to act. */
  perspective?: Player;
  className?: string;
  highlight?: BoardHighlight;
  /** Steps of the last move, marked on the board. */
  marks?: BoardMark[];
  /** Replaces the default dice with the bottom player's, in tap order. */
  dice?: BoardDice;
  /** The opening roll, [the bottom player's die, the top player's]: one die on each side. */
  openingDice?: [number, number];
  /** Tumble the dice as they appear. */
  rolling?: boolean;
  hide?: BoardHide[];
  /** Drawn last, above everything: checkers in flight or being dragged. */
  overlay?: React.ReactNode;
  /** Pointer input for playing: no text selection or scrolling on the board, and click targets for tests. */
  interactive?: boolean;
  svgRef?: React.Ref<SVGSVGElement>;
  onPointerDown?: React.PointerEventHandler<SVGSVGElement>;
  onPointerMove?: React.PointerEventHandler<SVGSVGElement>;
  onPointerUp?: React.PointerEventHandler<SVGSVGElement>;
  onPointerCancel?: React.PointerEventHandler<SVGSVGElement>;
}

/** The view with hidden checkers taken off the drawing (counts only; pips stay true). */
function drawnCounts(view: PerspectiveView, hide: BoardHide[] | undefined) {
  const points = view.points.slice();
  let { myBar, theirBar, myOff, theirOff } = view;
  for (const h of hide ?? []) {
    const bottom = h.side === "me";
    if (h.point === 25) {
      if (bottom) myBar = Math.max(0, myBar - 1);
      else theirBar = Math.max(0, theirBar - 1);
    } else if (h.point === 0) {
      if (bottom) myOff = Math.max(0, myOff - 1);
      else theirOff = Math.max(0, theirOff - 1);
    } else if (bottom) {
      if (points[h.point] > 0) points[h.point]--;
    } else if (points[25 - h.point] < 0) {
      points[25 - h.point]++;
    }
  }
  return { points, myBar, theirBar, myOff, theirOff };
}

function DiceRow({ values, used, cx, cy, rolling }: { values: number[]; used?: boolean[]; cx: number; cy: number; rolling?: boolean }) {
  const size = values.length > 2 ? 40 : 48;
  const gap = values.length > 2 ? 10 : 22;
  const width = values.length * size + (values.length - 1) * gap;
  const x0 = cx - width / 2 + size / 2;
  return (
    <g className={rolling ? "dice-roll" : undefined}>
      {values.map((v, i) => (
        <Die key={i} cx={x0 + i * (size + gap)} cy={cy} value={v} size={size} used={used?.[i]} />
      ))}
    </g>
  );
}

export default function Board({
  position,
  perspective,
  className,
  highlight,
  marks,
  dice,
  openingDice,
  rolling,
  hide,
  overlay,
  interactive,
  svgRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: BoardProps) {
  const me = perspective ?? actingPlayer(position);
  const view: PerspectiveView = toPerspective(position, me);
  const drawn = drawnCounts(view, hide);

  const cubeY =
    position.cubeAction === "double" || position.cubeOwner === "center"
      ? MID_Y
      : position.cubeOwner === me
        ? BOT_Y - 40
        : TOP_Y + 40;
  const cubeValue =
    position.cubeAction === "double"
      ? position.cubeValue * 2
      : position.cubeOwner === "center" && position.cubeValue === 1
        ? 64
        : position.cubeValue;

  const points: React.ReactNode[] = [];
  for (let p = 1; p <= 24; p++) {
    const v = drawn.points[p];
    if (v === 0) continue;
    const { c, top } = columnOf(p);
    points.push(
      <Stack
        key={p}
        cx={columnX(c) + PW / 2}
        startY={top ? TOP_Y + R : BOT_Y - R}
        dir={top ? 1 : -1}
        count={Math.abs(v)}
        mine={v > 0}
      />,
    );
  }

  const myDiceX = RIGHT + 3 * PW;
  const theirDiceX = LEFT + 3 * PW;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className={className ?? "h-auto w-full font-sans"}
      role="img"
      aria-label={`Backgammon board, ${ME_NAME} ${view.myPips} pips, ${THEM_NAME} ${view.theirPips} pips`}
      data-my-pips={view.myPips}
      data-their-pips={view.theirPips}
      data-my-off={view.myOff}
      data-their-off={view.theirOff}
      style={interactive ? { touchAction: "none", userSelect: "none" } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {/* header */}
      <text x={8} y={27} fontSize={18} fill="#333">
        {scoreCaption(position, me)}
      </text>
      <text x={W - 8} y={27} textAnchor="end" fontSize={18} fill="#333">
        {THEM_NAME} · {view.theirPips} pips
      </text>

      {/* frame and surface */}
      <rect x={0} y={T} width={W} height={BOARD_H} rx={10} fill="var(--color-frame)" />
      <rect x={LEFT} y={TOP_Y} width={6 * PW} height={BOT_Y - TOP_Y} fill="var(--color-felt)" />
      <rect x={RIGHT} y={TOP_Y} width={6 * PW} height={BOT_Y - TOP_Y} fill="var(--color-felt)" />
      <rect x={BAR_X} y={T} width={BAR_W} height={BOARD_H} fill="var(--color-frame-dark)" />

      {/* points */}
      {Array.from({ length: 12 }, (_, c) => {
        const x = columnX(c);
        const fill = c % 2 === 0 ? "var(--color-point-dark)" : "var(--color-point-light)";
        return (
          <g key={c}>
            <polygon points={`${x},${TOP_Y} ${x + PW},${TOP_Y} ${x + PW / 2},${TOP_Y + PH}`} fill={fill} />
            <polygon
              points={`${x},${BOT_Y} ${x + PW},${BOT_Y} ${x + PW / 2},${BOT_Y - PH}`}
              fill={c % 2 === 0 ? "var(--color-point-light)" : "var(--color-point-dark)"}
            />
          </g>
        );
      })}

      {/* point numbers, from the bottom player's view */}
      {Array.from({ length: 24 }, (_, i) => {
        const p = i + 1;
        const { c, top } = columnOf(p);
        return (
          <text
            key={p}
            x={columnX(c) + PW / 2}
            y={top ? T + 20 : BOT_Y + 21}
            textAnchor="middle"
            fontSize={13}
            fill="#e8dcc0"
          >
            {p}
          </text>
        );
      })}

      {/* move highlights, under the checkers */}
      {highlight && (
        <g aria-hidden>
          {[...highlight.sources].map((p) => {
            const a = areaOf("me", p);
            const on = p === highlight.selected;
            return <rect key={`s${p}`} x={a.x} y={a.y} width={a.w} height={a.h} fill={on ? "var(--color-select)" : "var(--color-movable)"} />;
          })}
          {[...highlight.targets].map((p) => {
            const a = areaOf("me", p);
            return <rect key={`t${p}`} x={a.x} y={a.y} width={a.w} height={a.h} fill="var(--color-target)" data-target={p} />;
          })}
        </g>
      )}

      {points}

      {/* bar */}
      {drawn.myBar > 0 && <Stack cx={BAR_X + BAR_W / 2} startY={MID_Y + BAR_OFFSET} dir={1} count={drawn.myBar} mine={true} />}
      {drawn.theirBar > 0 && <Stack cx={BAR_X + BAR_W / 2} startY={MID_Y - BAR_OFFSET} dir={-1} count={drawn.theirBar} mine={false} />}

      {/* bear-off tray */}
      <rect x={TRAY_X + 10} y={TOP_Y} width={TRAY_W - 20} height={BOT_Y - TOP_Y} rx={4} fill="var(--color-frame-dark)" />
      {Array.from({ length: drawn.myOff }, (_, k) => (
        <rect
          key={`mo${k}`}
          x={TRAY_X + 14}
          y={BOT_Y - 6 - (k + 1) * CHIP}
          width={TRAY_W - 28}
          height={10}
          rx={2}
          fill={BLUE}
          stroke={BLUE_DARK}
        />
      ))}
      {Array.from({ length: drawn.theirOff }, (_, k) => (
        <rect
          key={`to${k}`}
          x={TRAY_X + 14}
          y={TOP_Y + 6 + k * CHIP}
          width={TRAY_W - 28}
          height={10}
          rx={2}
          fill={WHITE}
          stroke={WHITE_DARK}
        />
      ))}
      {drawn.myOff > 0 && (
        <text x={TRAY_X + TRAY_W / 2} y={BOT_Y - 12 - drawn.myOff * CHIP} textAnchor="middle" fontSize={14} fill="#f3efe4">
          {drawn.myOff} off
        </text>
      )}
      {drawn.theirOff > 0 && (
        <text x={TRAY_X + TRAY_W / 2} y={TOP_Y + 22 + drawn.theirOff * CHIP} textAnchor="middle" fontSize={14} fill="#f3efe4">
          {drawn.theirOff} off
        </text>
      )}

      {/* the last move: a dot where each checker came from, a ring where it landed */}
      {marks?.map((m, i) => {
        const from = areaOf(m.side, m.from);
        const fromTip = m.from === 25 || m.from === 0 ? from.y + from.h / 2 : from.y === TOP_Y ? TOP_Y + PH - 12 : BOT_Y - PH + 12;
        const to = topSlot(view, m.side, m.to);
        return (
          <g key={`m${i}`} aria-hidden data-mark={`${m.side}:${m.from}/${m.to}`}>
            <circle cx={from.x + from.w / 2} cy={fromTip} r={7} fill="var(--color-mark)" opacity={0.85} />
            {m.to === 0 ? (
              <rect x={TRAY_X + 11} y={to.cy - 7} width={TRAY_W - 22} height={14} rx={3} fill="none" stroke="var(--color-mark)" strokeWidth={3} />
            ) : (
              <circle cx={to.cx} cy={to.cy} r={R + 3} fill="none" stroke="var(--color-mark)" strokeWidth={4} />
            )}
          </g>
        );
      })}

      {/* cube */}
      <Cube y={cubeY} value={cubeValue} offered={position.cubeAction === "double"} />

      {/* dice */}
      {dice ? (
        <g
          data-dice
          data-ready={dice.ready || undefined}
          style={dice.onPress ? { cursor: "pointer" } : undefined}
          onPointerDown={
            dice.onPress
              ? (e) => {
                  e.stopPropagation();
                  dice.onPress!();
                }
              : undefined
          }
        >
          {dice.ready && (
            <rect x={myDiceX - 100} y={MID_Y - 36} width={200} height={72} rx={12} fill="rgb(74 222 128 / 0.25)" stroke="#4ade80" strokeWidth={2} />
          )}
          <DiceRow values={dice.values} used={dice.used} cx={myDiceX} cy={MID_Y} rolling={rolling} />
          {dice.ready && (
            <text x={myDiceX} y={MID_Y + 52} textAnchor="middle" fontSize={13} fill="#f3efe4">
              tap to play
            </text>
          )}
        </g>
      ) : openingDice ? (
        <>
          <DiceRow values={[openingDice[0]]} cx={myDiceX} cy={MID_Y} rolling={rolling} />
          <DiceRow values={[openingDice[1]]} cx={theirDiceX} cy={MID_Y} rolling={rolling} />
        </>
      ) : (
        position.dice && (
          <DiceRow values={[position.dice[0], position.dice[1]]} cx={position.turn === me ? myDiceX : theirDiceX} cy={MID_Y} rolling={rolling} />
        )
      )}

      {/* point outlines for tests (data-point); input is hit-tested from the pointer's coordinates */}
      {interactive && (
        <g fill="transparent" pointerEvents="none">
          {[...Array.from({ length: 24 }, (_, i) => i + 1), 25, 0].map((p) => {
            const a = areaOf("me", p);
            return <rect key={`h${p}`} x={a.x} y={a.y} width={a.w} height={a.h} data-point={p} />;
          })}
        </g>
      )}

      <g pointerEvents="none">{overlay}</g>

      {/* footer */}
      <text x={8} y={H - 13} fontSize={18} fill="#333">
        {cubeCaption(position, me)}
      </text>
      <text x={W - 8} y={H - 13} textAnchor="end" fontSize={18} fill="#333">
        {ME_NAME} · {view.myPips} pips
      </text>
    </svg>
  );
}
