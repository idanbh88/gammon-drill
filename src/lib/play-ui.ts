/**
 * Text and board helpers for the play screen: what just happened, what to do now, how a
 * decision went, where the last move went, and the position after a candidate play.
 * Pure and client-safe (types only from the server modules).
 */
import { opponent, toPerspective, withState } from "./board";
import type { GameState } from "./game";
import { BLUNDER_THRESHOLD, ERROR_THRESHOLD, type MatchDecision } from "./matches";
import { applySteps, parsePlay, stateFromView } from "./moves";
import type { LogEntry, PlayEvent, PlayView } from "./play-service";
import { isCounted } from "./pr";
import { parseXgid, type Player, type Position } from "./xgid";

export const who = (p: Player) => (p === 1 ? "You" : "gnubg");
const dice = (d: [number, number]) => `${d[0]}${d[1]}`;

const HOW: Record<string, string> = { single: "a single game", gammon: "a gammon", backgammon: "a backgammon", pass: "on a pass" };

/** One line per thing that happened, e.g. "gnubg rolled 64: 24/18 13/9". */
export function eventLines(events: PlayEvent[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const next = events[i + 1];
    switch (e.type) {
      case "opening":
        out.push(`Game ${e.game}: you rolled ${e.dice[0]}, gnubg ${e.dice[1]}; ${e.first === 1 ? "you start" : "gnubg starts"} with ${Math.max(...e.dice)}${Math.min(...e.dice)}.`);
        break;
      case "roll":
        if (next?.type === "move" && next.player === e.player) {
          out.push(`${who(e.player)} rolled ${dice(e.dice)}: ${next.play}${next.forced ? " (forced)" : ""}.`);
          i++;
        } else if (next?.type === "no-move" && next.player === e.player) {
          out.push(`${who(e.player)} rolled ${dice(e.dice)} and cannot move.`);
          i++;
        } else {
          out.push(`${who(e.player)} rolled ${dice(e.dice)}.`);
        }
        break;
      case "move":
        out.push(`${who(e.player)} played ${e.play}${e.forced ? " (forced)" : ""}.`);
        break;
      case "no-move":
        out.push(`${who(e.player)} cannot move.`);
        break;
      case "double":
        out.push(`${who(e.player)} ${e.player === 1 ? "double" : "doubles"} to ${e.cube}.`);
        break;
      case "take":
      case "pass":
        out.push(`${who(e.player)} ${e.player === 1 ? e.type : e.type === "take" ? "takes" : "passes"}.`);
        break;
      case "game-over":
        out.push(`${e.winner === 1 ? "You win" : "gnubg wins"} ${e.points} point${e.points === 1 ? "" : "s"}, ${HOW[e.how]}${e.matchOver ? " and the match" : ""}.`);
        break;
    }
  }
  return out;
}

/** gnubg's last turn, from the game log: what a freshly loaded page shows instead of events. */
export function lastTurnLines(log: LogEntry[]): string[] {
  let i = log.length;
  while (i > 0 && log[i - 1].player === 2) i--;
  const out: string[] = [];
  for (const l of log.slice(i)) {
    if (l.kind === "checker") out.push(l.played ? `gnubg rolled ${l.dice}: ${l.played}${l.forced ? " (forced)" : ""}.` : `gnubg rolled ${l.dice} and cannot move.`);
    else if (l.kind === "take") out.push(`gnubg ${l.played === "take" ? "takes" : "passes"}.`);
    else if (l.played === "double") out.push("gnubg doubles.");
  }
  return out;
}

/** What the user has to do now. */
export function promptText(view: Pick<PlayView, "state" | "status">): string {
  const { state } = view;
  const ph = state.phase;
  if (ph.kind === "game-over") {
    if (ph.matchOver) return ph.winner === 1 ? "You won the match." : "gnubg won the match.";
    return view.status === "finished" ? "Session finished." : `${ph.winner === 1 ? "You win" : "gnubg wins"} ${ph.points} point${ph.points === 1 ? "" : "s"} (${HOW[ph.how]}).`;
  }
  if (ph.player !== 1) return "gnubg is thinking…";
  const pos = state.position;
  if (ph.kind === "pre-roll") return "Your turn: roll, or double.";
  if (ph.kind === "take") return `gnubg ${pos.cubeOwner === "center" ? "doubles" : "redoubles"} to ${pos.cubeValue * 2}. Take or pass?`;
  return `Your move: ${pos.dice![0]}${pos.dice![1]}.`;
}

/** The match and score line, from the user's side. */
export function scoreLine(state: GameState): string {
  const len = state.settings.matchLength;
  const parts = [len > 0 ? `${len}-point match` : "Money session", `game ${state.game}`, `you ${state.score[0]} – gnubg ${state.score[1]}`];
  if (state.crawford) parts.push("Crawford");
  return parts.join(" · ");
}

export type Tone = "best" | "fine" | "error" | "blunder" | "unscored";

/** How one graded decision went, in words. */
export function verdict(d: MatchDecision): { tone: Tone; text: string } {
  if (!d.played) return { tone: "unscored", text: `${d.playedText}: not scored by the engine.` };
  const loss = d.played.loss;
  const tone: Tone = loss === 0 ? "best" : loss < ERROR_THRESHOLD ? "fine" : loss < BLUNDER_THRESHOLD ? "error" : "blunder";
  const best = d.problem.answers[0];
  const cost = `−${loss.toFixed(3)}`;
  if (d.kind === "checker") {
    if (loss === 0) return { tone, text: `${d.played.label}: gnubg's best play.` };
    const word = tone === "fine" ? "Close" : tone === "error" ? "Error" : "Blunder";
    return { tone, text: `${word} ${cost}: you played ${d.played.label}, gnubg plays ${best.label}.` };
  }
  if (d.kind === "cube") {
    const doubled = d.playedText === "Double";
    if (loss === 0) return { tone, text: `${d.playedText}: right (gnubg: ${best.label}).` };
    const word = doubled ? "Wrong double" : "Missed double";
    return { tone, text: `${word} ${cost}: gnubg says ${best.label}.` };
  }
  if (loss === 0) return { tone, text: `${d.playedText}: right.` };
  return { tone, text: `Wrong ${d.playedText.toLowerCase()} ${cost}: gnubg would ${best.label.toLowerCase()}.` };
}

/** Whether a graded decision deserves a card: every play and cube action, and a no-double
 * that counts for PR (a close decision or a missed double). */
export function isNotable(d: MatchDecision): boolean {
  if (d.kind !== "cube" || d.playedText === "Double") return true;
  if (!d.played) return false;
  return d.played.loss > 0 || isCounted({ player: 1, kind: "cube", played: "no-double", forced: false, loss: d.played.loss, answers: d.problem.answers });
}

/** The position after `play` (in the acting player's notation) from a checker decision's XGID. */
export function positionAfter(xgid: string, play: string, mover: Player): Position | null {
  const pos = parseXgid(xgid);
  try {
    const state = applySteps(stateFromView(toPerspective(pos, mover)), parsePlay(play));
    if (!state) return null;
    return { ...withState(pos, mover, state), dice: null, turn: opponent(mover) };
  } catch {
    return null;
  }
}

/** Board marks for the last checker play (the Board maps the mover's numbering). */
export function marksFor(lastMove: PlayView["lastMove"]): { side: "me" | "them"; from: number; to: number }[] {
  if (!lastMove || !lastMove.play) return [];
  try {
    const side = lastMove.player === 1 ? "me" : "them";
    return parsePlay(lastMove.play).map((s) => ({ side, from: s.from, to: s.to }));
  } catch {
    return [];
  }
}
