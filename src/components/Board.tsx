import {
  ME_NAME,
  THEM_NAME,
  actingPlayer,
  scoreCaption,
  toPerspective,
  type PerspectiveView,
} from "@/lib/board";
import type { Player, Position } from "@/lib/xgid";

/**
 * SVG backgammon board. The `perspective` player (default: the player who has to act) is
 * drawn at the bottom as Blue, moving counter-clockwise: home board bottom-right (points 1-6),
 * 7-12 bottom-left, 13-18 top-left, 19-24 top-right.
 */

const W = 960;
const H = 720;
const T = 40; // header height; the board frame starts here
const BOARD_H = 640;
const FRAME = 30; // frame thickness top/bottom
const PW = 60; // point width
const PH = 240; // point height
const R = 23; // checker radius
const LEFT = 80; // x where the left half starts (cube column before it)
const BAR_X = LEFT + 6 * PW; // 440
const BAR_W = 60;
const RIGHT = BAR_X + BAR_W; // 500
const TRAY_X = RIGHT + 6 * PW; // 860
const TRAY_W = 80;
const TOP_Y = T + FRAME; // top of the playing surface
const BOT_Y = T + BOARD_H - FRAME; // bottom of the playing surface
const MID_Y = (TOP_Y + BOT_Y) / 2;
const MAX_STACK = 5;

const BLUE = "var(--color-blue-checker)";
const BLUE_DARK = "var(--color-blue-checker-dark)";
const WHITE = "var(--color-white-checker)";
const WHITE_DARK = "var(--color-white-checker-dark)";

function columnOf(point: number): { c: number; top: boolean } {
  return point <= 12 ? { c: 12 - point, top: false } : { c: point - 13, top: true };
}

function columnX(c: number): number {
  return c < 6 ? LEFT + c * PW : RIGHT + (c - 6) * PW;
}

function Checker({ cx, cy, mine, label }: { cx: number; cy: number; mine: boolean; label?: string }) {
  return (
    <g>
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

function Die({ cx, cy, value }: { cx: number; cy: number; value: number }) {
  return (
    <g>
      <rect x={cx - 24} y={cy - 24} width={48} height={48} rx={8} fill="#fffdf7" stroke="#333" strokeWidth={2} />
      {PIPS[value].map(([dx, dy], i) => (
        <circle key={i} cx={cx + dx * 13} cy={cy + dy * 13} r={5} fill="#222" />
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

export interface BoardProps {
  position: Position;
  /** Player drawn at the bottom. Defaults to the player who has to act. */
  perspective?: Player;
  className?: string;
}

export default function Board({ position, perspective, className }: BoardProps) {
  const me = perspective ?? actingPlayer(position);
  const view: PerspectiveView = toPerspective(position, me);

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
    const v = view.points[p];
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

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className ?? "h-auto w-full font-sans"}
      role="img"
      aria-label={`Backgammon board, ${ME_NAME} ${view.myPips} pips, ${THEM_NAME} ${view.theirPips} pips`}
      data-my-pips={view.myPips}
      data-their-pips={view.theirPips}
      data-my-off={view.myOff}
      data-their-off={view.theirOff}
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

      {points}

      {/* bar */}
      {view.myBar > 0 && (
        <Stack cx={BAR_X + BAR_W / 2} startY={MID_Y + 60} dir={1} count={view.myBar} mine={true} />
      )}
      {view.theirBar > 0 && (
        <Stack cx={BAR_X + BAR_W / 2} startY={MID_Y - 60} dir={-1} count={view.theirBar} mine={false} />
      )}

      {/* bear-off tray */}
      <rect x={TRAY_X + 10} y={TOP_Y} width={TRAY_W - 20} height={BOT_Y - TOP_Y} rx={4} fill="var(--color-frame-dark)" />
      {Array.from({ length: view.myOff }, (_, k) => (
        <rect
          key={`mo${k}`}
          x={TRAY_X + 14}
          y={BOT_Y - 6 - (k + 1) * 12}
          width={TRAY_W - 28}
          height={10}
          rx={2}
          fill={BLUE}
          stroke={BLUE_DARK}
        />
      ))}
      {Array.from({ length: view.theirOff }, (_, k) => (
        <rect
          key={`to${k}`}
          x={TRAY_X + 14}
          y={TOP_Y + 6 + k * 12}
          width={TRAY_W - 28}
          height={10}
          rx={2}
          fill={WHITE}
          stroke={WHITE_DARK}
        />
      ))}
      {view.myOff > 0 && (
        <text x={TRAY_X + TRAY_W / 2} y={BOT_Y - 12 - view.myOff * 12} textAnchor="middle" fontSize={14} fill="#f3efe4">
          {view.myOff} off
        </text>
      )}
      {view.theirOff > 0 && (
        <text x={TRAY_X + TRAY_W / 2} y={TOP_Y + 22 + view.theirOff * 12} textAnchor="middle" fontSize={14} fill="#f3efe4">
          {view.theirOff} off
        </text>
      )}

      {/* cube */}
      <Cube y={cubeY} value={cubeValue} offered={position.cubeAction === "double"} />

      {/* dice, for the player on roll */}
      {position.dice && position.turn === me && (
        <>
          <Die cx={RIGHT + 3 * PW - 30} cy={MID_Y} value={position.dice[0]} />
          <Die cx={RIGHT + 3 * PW + 40} cy={MID_Y} value={position.dice[1]} />
        </>
      )}
      {position.dice && position.turn !== me && (
        <>
          <Die cx={LEFT + 3 * PW - 30} cy={MID_Y} value={position.dice[0]} />
          <Die cx={LEFT + 3 * PW + 40} cy={MID_Y} value={position.dice[1]} />
        </>
      )}

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
