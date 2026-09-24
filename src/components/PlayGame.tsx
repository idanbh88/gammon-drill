"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toPerspective, withState } from "@/lib/board";
import { buildTimeline, dropFrames, snapBackFrames, SPEEDS, stepFrames, timing, type Frame, type Speed } from "@/lib/board-animation";
import type { Point2 } from "@/lib/board-geometry";
import { cubeAvailable } from "@/lib/game";
import { ERROR_THRESHOLD, formatLoss, lossClass, type MatchDecision } from "@/lib/matches";
import {
  boardAfter,
  clear,
  destinations,
  enter,
  enteredSteps,
  entryNotation,
  isComplete,
  remainingDice,
  startEntry,
  swapDice,
  tapGroup,
  undo,
  type MoveEntry,
} from "@/lib/move-input";
import { isLegalPlay } from "@/lib/moves";
import type { PlayEvent, PlayView, UserAction } from "@/lib/play-service";
import { dropStartEvents, loadPlaySettings, readStartEvents, savePlaySettings } from "@/lib/play-settings";
import { eventLines, isNotable, lastTurnLines, marksFor, promptText, scoreLine, who } from "@/lib/play-ui";
import type { PlayerRating } from "@/lib/pr";
import type { Position } from "@/lib/xgid";
import Board from "./Board";
import DecisionFeedback from "./DecisionFeedback";
import PlayBoard from "./PlayBoard";

/** Frames playing on the board: gnubg's turn (blocking: input only skips it) or the user's own short flights. */
interface Anim {
  frames: Frame[];
  i: number;
  blocking: boolean;
}

function entryFor(v: PlayView): MoveEntry | null {
  const { phase, position } = v.state;
  if (v.status !== "playing" || phase.kind !== "move" || phase.player !== 1 || !position.dice) return null;
  return startEntry(toPerspective(position, 1), position.dice);
}

/** The position with what the user has entered so far. */
function livePosition(v: PlayView, entry: MoveEntry | null): Position {
  const pos = v.state.position;
  if (!entry || enteredSteps(entry).length === 0) return pos;
  return withState(pos, 1, boardAfter(toPerspective(pos, 1), entry));
}

function PrLine({ label, r }: { label: string; r: PlayerRating }) {
  return (
    <tr>
      <td className="py-0.5 pr-3">{label}</td>
      <td className="py-0.5 pr-3 text-right font-mono">{r.pr === null ? "—" : r.pr.toFixed(1)}</td>
      <td className="py-0.5 pr-3 text-stone-500">{r.rating ?? ""}</td>
      <td className="py-0.5 pr-3 text-right font-mono">{r.decisions}</td>
      <td className="py-0.5 text-right font-mono">
        {r.errors}/{r.blunders}
      </td>
    </tr>
  );
}

function Ratings({ view }: { view: PlayView }) {
  return (
    <table className="text-sm" data-ratings>
      <thead className="text-xs text-stone-500">
        <tr>
          <th className="pr-3 text-left font-normal"></th>
          <th className="pr-3 text-right font-normal">PR</th>
          <th className="pr-3 text-left font-normal"></th>
          <th className="pr-3 text-right font-normal">decisions</th>
          <th className="text-right font-normal">errors/blunders</th>
        </tr>
      </thead>
      <tbody>
        <PrLine label="You, this game" r={view.ratings.game[0]} />
        <PrLine label="You, match" r={view.ratings.match[0]} />
        <PrLine label="gnubg, match" r={view.ratings.match[1]} />
      </tbody>
    </table>
  );
}

const SPEED_LABEL: Record<Speed, string> = { slow: "Slow", normal: "Normal", fast: "Fast", off: "Off" };

const BUTTON = "rounded-lg px-4 py-2 font-medium shadow-sm disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400";
const PRIMARY = `${BUTTON} bg-blue-600 text-white hover:bg-blue-700`;
const SECONDARY = `${BUTTON} border border-stone-300 bg-white text-stone-800 hover:bg-stone-50`;

/**
 * A match against gnubg: the board you move on (tap, drag, dice), gnubg's turn replayed on the
 * board checker by checker, and gnubg's verdict on each of your decisions. Client-only (see
 * PlayLoader): the animation speed and the opening's events come from browser storage.
 */
export default function PlayGame({ initial }: { initial: PlayView }) {
  const [speed, setSpeed] = useState<Speed>(() => loadPlaySettings().speed);
  const [view, setView] = useState<PlayView>(initial);
  const [entry, setEntry] = useState<MoveEntry | null>(() => entryFor(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [graded, setGraded] = useState<MatchDecision[]>(initial.graded);
  // A match just started on /play hands its events over, so gnubg's opening can be replayed.
  const [events, setEvents] = useState<PlayEvent[]>(() => (initial.events.length > 0 ? initial.events : readStartEvents(initial.matchId)));
  const [anim, setAnim] = useState<Anim | null>(() => {
    const t = timing(loadPlaySettings().speed);
    const start = readStartEvents(initial.matchId);
    if (!t || start.length === 0) return null;
    const frames = buildTimeline(start, initial.state.position, t, { skipFirstUserMove: false, final: initial.state.position });
    return frames.length > 0 ? { frames, i: 0, blocking: true } : null;
  });
  const [preview, setPreview] = useState<{ pos: Position; label: string } | null>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => dropStartEvents(initial.matchId), [initial.matchId]);

  // Play the frames: each one stays up for its length, then the next; the last hands back to the live board.
  useEffect(() => {
    if (!anim) return;
    const timer = setTimeout(
      () => setAnim((a) => (a !== anim ? a : a.i + 1 < a.frames.length ? { ...a, i: a.i + 1 } : null)),
      anim.frames[anim.i]?.ms ?? 0,
    );
    return () => clearTimeout(timer);
  }, [anim]);

  const t = useMemo(() => timing(speed), [speed]);
  const { state } = view;
  const pos = state.position;
  const phase = state.phase;
  const playing = view.status === "playing";
  const blocking = Boolean(anim?.blocking);
  const frame = anim ? anim.frames[anim.i] ?? null : null;
  const mine = playing && !blocking && phase.kind !== "game-over" && phase.player === 1;
  const live = useMemo(() => livePosition(view, entry), [view, entry]);

  const show = useCallback(
    (v: PlayView, action: UserAction | null, before: Position) => {
      setView(v);
      setEntry(entryFor(v));
      setPreview(null);
      setGraded(v.graded);
      setEvents(v.events);
      setTyped("");
      setHint(null);
      const frames = t && v.events.length > 0 ? buildTimeline(v.events, before, t, { skipFirstUserMove: action?.type === "move", final: v.state.position }) : [];
      setAnim(frames.length > 0 ? { frames, i: 0, blocking: true } : null);
    },
    [t],
  );

  const reload = useCallback(async () => {
    const res = await fetch(`/api/play/${view.matchId}`);
    if (res.ok) {
      const v = (await res.json()) as PlayView;
      show(v, null, v.state.position);
    }
  }, [view.matchId, show]);

  const send = useCallback(
    async (action: UserAction) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      const before = live;
      try {
        const res = await fetch(`/api/play/${view.matchId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, version: view.version }),
        });
        const data = (await res.json().catch(() => ({}))) as PlayView & { error?: string };
        if (!res.ok) {
          setError(data.error ?? `HTTP ${res.status}`);
          if (res.status === 409) await reload();
          return;
        }
        show(data, action, before);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [busy, live, view.matchId, view.version, show, reload],
  );

  const confirm = useCallback(() => {
    if (entry && isComplete(entry) && entry.length > 0) void send({ type: "move", play: entryNotation(entry) });
  }, [entry, send]);

  // Tap: the first die (in the dice's order) that works for that checker.
  const tap = useCallback(
    (from: number) => {
      if (!entry) return;
      const group = tapGroup(entry, from);
      if (!group) {
        setHint(`That checker cannot move with ${remainingDice(entry).join(" or ")}.`);
        return;
      }
      setHint(null);
      setEntry(enter(entry, group));
      if (t) setAnim({ frames: stepFrames(live, 1, group.steps, { step: t.userStep, hit: t.userStep }).frames, i: 0, blocking: false });
    },
    [entry, live, t],
  );

  const drop = useCallback(
    (from: number, to: number, at: Point2) => {
      if (!entry) return;
      const group = destinations(entry, from).get(to);
      if (!group) return;
      setHint(null);
      setEntry(enter(entry, group));
      if (t) setAnim({ frames: dropFrames(live, group.steps, at, t), i: 0, blocking: false });
    },
    [entry, live, t],
  );

  const cancelDrag = useCallback(
    (from: number, at: Point2) => {
      if (t) setAnim({ frames: snapBackFrames(live, from, at, t), i: 0, blocking: false });
    },
    [live, t],
  );

  // The dice: swap them while moving; once the play is complete, play it.
  const pressDice = useCallback(() => {
    if (!entry) return;
    if (isComplete(entry)) confirm();
    else setEntry(swapDice(entry));
  }, [entry, confirm]);

  const skip = useCallback(() => setAnim(null), []);

  function changeSpeed(s: Speed) {
    setSpeed(s);
    savePlaySettings({ speed: s });
    if (s === "off") setAnim(null);
  }

  function submitTyped(e: React.FormEvent) {
    e.preventDefault();
    const play = typed.trim();
    if (!play || !pos.dice) return;
    if (!isLegalPlay(toPerspective(pos, 1), pos.dice, play)) {
      setError(`"${play}" is not a legal play with ${pos.dice[0]}${pos.dice[1]}.`);
      return;
    }
    void send({ type: "move", play });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if (e.target instanceof HTMLElement && e.target.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
      const k = e.key.toLowerCase();
      if (blocking) {
        if (k === " " || k === "escape") {
          skip();
          e.preventDefault();
        }
        return;
      }
      if (busy || !playing) return;
      if (phase.kind === "pre-roll" && mine && k === "r") void send({ type: "roll" });
      else if (phase.kind === "pre-roll" && mine && k === "d") void send({ type: "double" });
      else if (phase.kind === "take" && mine && k === "t") void send({ type: "take" });
      else if (phase.kind === "take" && mine && k === "p") void send({ type: "pass" });
      else if (entry && k === " ") pressDice();
      else if (entry && k === "enter") confirm();
      else if (entry && (k === "backspace" || k === "u")) setEntry(undo(entry));
      else if (k === "escape") setPreview(null);
      else if (phase.kind === "game-over" && !phase.matchOver && k === "n") void send({ type: "next-game" });
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [blocking, busy, playing, phase, mine, entry, send, confirm, pressDice, skip]);

  const lines = events.length > 0 ? eventLines(events) : lastTurnLines(view.log);
  const cards = graded.filter(isNotable);
  const errors = view.log.filter((l) => l.player === 1 && l.loss !== null && l.loss >= ERROR_THRESHOLD);
  const prompt = busy ? "gnubg is thinking…" : blocking ? (frame?.caption ?? "gnubg is playing…") : promptText(view);

  return (
    <div className="mx-auto max-w-7xl p-4">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="Board" className="flex flex-col gap-2">
          {preview ? (
            <Board position={preview.pos} perspective={1} />
          ) : (
            <PlayBoard
              position={live}
              frame={frame}
              blocking={blocking}
              entry={busy ? null : entry}
              marks={marksFor(view.lastMove)}
              onTap={tap}
              onDrop={drop}
              onCancelDrag={cancelDrag}
              onDice={pressDice}
              onSkip={skip}
            />
          )}
          {preview && (
            <p className="rounded bg-stone-800 px-3 py-1.5 text-sm text-white">
              Showing the position after {preview.label}.{" "}
              <button type="button" className="underline" onClick={() => setPreview(null)}>
                Back to the game
              </button>
            </p>
          )}
          {blocking && (
            <p className="text-sm text-stone-500">
              <button type="button" className="text-blue-700 underline" onClick={skip}>
                Skip
              </button>{" "}
              (or click the board, or press Space)
            </p>
          )}
        </section>

        <section className="flex flex-col gap-4" aria-label="Game">
          <header>
            <p className="text-sm text-stone-500">
              <Link href="/play" className="text-blue-700 underline">
                Play
              </Link>{" "}
              · {scoreLine(state)} · you are Blue
            </p>
            <h1 className="mt-1 text-2xl font-semibold" data-prompt>
              {prompt}
            </h1>
            {hint && !blocking && (
              <p className="mt-1 text-sm text-amber-800" role="status">
                {hint}
              </p>
            )}
          </header>

          {!blocking && lines.length > 0 && (
            <ul className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700" aria-label="What just happened" data-events>
              {lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}

          {error && (
            <p className="rounded bg-red-100 px-3 py-2 text-sm text-red-800" role="alert">
              {error}
            </p>
          )}

          {!blocking && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Actions">
              {mine && phase.kind === "pre-roll" && (
                <>
                  <button type="button" className={PRIMARY} disabled={busy} onClick={() => send({ type: "roll" })}>
                    Roll <span className="text-xs opacity-70">R</span>
                  </button>
                  {cubeAvailable(pos, 1) && (
                    <button type="button" className={SECONDARY} disabled={busy} onClick={() => send({ type: "double" })}>
                      {pos.cubeOwner === "center" ? "Double" : "Redouble"} to {pos.cubeValue * 2} <span className="text-xs opacity-60">D</span>
                    </button>
                  )}
                </>
              )}
              {mine && phase.kind === "take" && (
                <>
                  <button type="button" className={PRIMARY} disabled={busy} onClick={() => send({ type: "take" })}>
                    Take <span className="text-xs opacity-70">T</span>
                  </button>
                  <button type="button" className={SECONDARY} disabled={busy} onClick={() => send({ type: "pass" })}>
                    Pass <span className="text-xs opacity-60">P</span>
                  </button>
                </>
              )}
              {entry && (
                <>
                  <button type="button" className={PRIMARY} disabled={busy || !isComplete(entry)} onClick={confirm}>
                    Play {entryNotation(entry) || "…"} <span className="text-xs opacity-70">Enter</span>
                  </button>
                  <button type="button" className={SECONDARY} disabled={busy || enteredSteps(entry).length === 0} onClick={() => setEntry(undo(entry))}>
                    Undo <span className="text-xs opacity-60">U</span>
                  </button>
                  <button type="button" className={SECONDARY} disabled={busy || enteredSteps(entry).length === 0} onClick={() => setEntry(clear(entry))}>
                    Clear
                  </button>
                </>
              )}
              {playing && phase.kind === "game-over" && !phase.matchOver && (
                <>
                  <button type="button" className={PRIMARY} disabled={busy} onClick={() => send({ type: "next-game" })}>
                    Next game <span className="text-xs opacity-70">N</span>
                  </button>
                  {state.settings.matchLength === 0 && (
                    <button type="button" className={SECONDARY} disabled={busy} onClick={() => send({ type: "end" })}>
                      End session
                    </button>
                  )}
                </>
              )}
              {!playing && (
                <Link href="/play" className={PRIMARY}>
                  New match
                </Link>
              )}
              <Link href={`/matches/${view.matchId}`} className="text-sm text-blue-700 underline">
                Review
              </Link>
            </div>
          )}

          {entry && !blocking && (
            <form onSubmit={submitTyped} className="flex gap-2 text-sm">
              <label className="sr-only" htmlFor="typed-move">
                Type a play
              </label>
              <input
                id="typed-move"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="or type it: 13/7 8/7"
                className="w-56 rounded border border-stone-300 px-2 py-1 font-mono"
                autoComplete="off"
              />
              <button type="submit" className="rounded border border-stone-300 bg-white px-3 py-1 hover:bg-stone-50" disabled={busy}>
                Play
              </button>
            </form>
          )}

          {cards.map((d) => (
            <DecisionFeedback
              key={d.problem.id}
              decision={d}
              previewing={preview?.label ?? null}
              onPreview={(p, label) => setPreview(p && label ? { pos: p, label } : null)}
            />
          ))}

          {!blocking && phase.kind === "game-over" && errors.length > 0 && (
            <section className="rounded-lg border border-stone-200 bg-white p-3 text-sm" aria-label="Your errors this game">
              <h2 className="font-semibold">Your errors this game</h2>
              <ul className="mt-1">
                {errors.map((l) => (
                  <li key={l.decisionId} className="flex gap-3">
                    <span className="w-16 text-stone-500">move {l.move}</span>
                    <span className="font-mono">{l.kind === "checker" ? `${l.dice} ${l.played}` : l.played}</span>
                    <span className={`font-mono ${lossClass(l.loss ?? 0)}`}>{formatLoss(l.loss ?? 0)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-stone-500">They are in your quiz now. The match review has each one with gnubg&apos;s ranking and an explanation.</p>
            </section>
          )}

          <Ratings view={view} />

          <details className="text-sm">
            <summary className="cursor-pointer text-stone-600">Game {state.game} log</summary>
            <ol className="mt-1 font-mono text-xs" data-log>
              {view.log.map((l) => (
                <li key={l.decisionId} className="flex gap-2">
                  <span className="w-10 text-stone-400">{l.move}</span>
                  <span className="w-12">{who(l.player)}</span>
                  <span className="w-6 text-stone-500">{l.dice ?? ""}</span>
                  <span className="flex-1">{l.kind === "checker" ? l.played || "no move" : l.played}</span>
                  <span className={lossClass(l.loss ?? 0)}>{l.player === 1 && l.loss !== null ? formatLoss(l.loss) : ""}</span>
                </li>
              ))}
            </ol>
          </details>

          <div className="flex flex-wrap items-center gap-2 text-sm text-stone-600">
            <label htmlFor="anim-speed">gnubg&apos;s moves:</label>
            <select id="anim-speed" value={speed} onChange={(e) => changeSpeed(e.target.value as Speed)} className="rounded border border-stone-300 bg-white px-2 py-1">
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {SPEED_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-stone-500">
            Tap a checker to move it by the first die (tap the dice to swap them), or drag it where it should go. When every die is used, tap the dice
            (or press Enter) to play. Keys: R roll, D double, T take, P pass, Space swap dice or skip gnubg&apos;s animation, Enter play, U undo, N next
            game.
          </p>
        </section>
      </div>
    </div>
  );
}
