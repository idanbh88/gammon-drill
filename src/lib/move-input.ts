/**
 * Entering a play on the board, Backgammon Galaxy style: a tap moves a checker by the first die
 * that works for it (the higher die unless the dice were swapped), a drag goes to any landing
 * point the checker can reach, and every entered prefix must extend to a complete legal play, so
 * the entry can never get stuck. Steps are compared by origin, landing point and die (hits follow
 * from the board). The mover's numbering: 25 = bar, 0 = off. Pure and client-safe.
 */
import type { PerspectiveView } from "./board";
import { applySteps, formatPlay, legalSequences, stateFromView, type BoardState, type LegalSequence, type MoveStep } from "./moves";

/** What one tap or drop enters: one or more steps of the same checker, and the die of each. */
export interface EntryGroup {
  steps: MoveStep[];
  dice: number[];
}

export interface MoveEntry {
  /** Every complete legal play, in every order, with the die of each step. */
  sequences: LegalSequence[];
  /** Steps in a complete play (0 = no legal move). */
  length: number;
  /** The dice in the order a tap tries them: the higher first unless swapped; a double four times. */
  order: number[];
  /** What was entered, one group per tap or drop, so undo takes back a whole one. */
  groups: EntryGroup[];
}

export function startEntry(view: PerspectiveView, dice: [number, number]): MoveEntry {
  const sequences = legalSequences(view, dice);
  const [a, b] = dice;
  const order = a === b ? [a, a, a, a] : [Math.max(a, b), Math.min(a, b)];
  return { sequences, length: sequences[0]?.steps.length ?? 0, order, groups: [] };
}

export function enteredSteps(e: MoveEntry): MoveStep[] {
  return e.groups.flatMap((g) => g.steps);
}

function enteredDice(e: MoveEntry): number[] {
  return e.groups.flatMap((g) => g.dice);
}

/** For each die in `order`, whether it has been used (for dimming it). */
export function diceUsage(e: MoveEntry): boolean[] {
  const used = e.order.map(() => false);
  for (const d of enteredDice(e)) {
    const i = e.order.findIndex((x, k) => x === d && !used[k]);
    if (i >= 0) used[i] = true;
  }
  return used;
}

/** The dice not used yet, in tap order. */
export function remainingDice(e: MoveEntry): number[] {
  const used = diceUsage(e);
  return e.order.filter((_, k) => !used[k]);
}

/** Tap order reversed (two different dice); a double has nothing to swap. */
export function swapDice(e: MoveEntry): MoveEntry {
  if (e.order.length !== 2 || e.order[0] === e.order[1]) return e;
  return { ...e, order: [e.order[1], e.order[0]] };
}

function continues(seq: LegalSequence, steps: MoveStep[], dice: number[]): boolean {
  if (steps.length > seq.steps.length) return false;
  return steps.every((s, i) => seq.steps[i].from === s.from && seq.steps[i].to === s.to && seq.dice[i] === dice[i]);
}

/** The complete plays still possible after what was entered. */
function remaining(e: MoveEntry): LegalSequence[] {
  const steps = enteredSteps(e);
  const dice = enteredDice(e);
  return e.sequences.filter((s) => continues(s, steps, dice));
}

export function isComplete(e: MoveEntry): boolean {
  return enteredSteps(e).length === e.length;
}

/** Points (25 = bar) a checker can be moved from next. */
export function movableFrom(e: MoveEntry): Set<number> {
  const n = enteredSteps(e).length;
  const out = new Set<number>();
  if (n >= e.length) return out;
  for (const s of remaining(e)) out.add(s.steps[n].from);
  return out;
}

/**
 * What a tap on the checker at `from` enters: one step with the first die in tap order that
 * continues a legal play from there, or null when none does.
 */
export function tapGroup(e: MoveEntry, from: number): EntryGroup | null {
  const n = enteredSteps(e).length;
  const next = remaining(e).filter((s) => s.steps[n]?.from === from);
  for (const die of new Set(remainingDice(e))) {
    const seq = next.find((s) => s.dice[n] === die);
    if (seq) return { steps: [seq.steps[n]], dice: [die] };
  }
  return null;
}

/**
 * Where the checker on `from` can be dropped (0 = off), each with what it enters: one die, or
 * several dice moving the same checker on. The fewest steps win; then a path that does not hit
 * on the way (drop one die at a time to hit and continue); then the smallest dice (bearing off
 * with the exact number keeps the bigger die).
 */
export function destinations(e: MoveEntry, from: number): Map<number, EntryGroup> {
  const n = enteredSteps(e).length;
  const out = new Map<number, EntryGroup>();
  const score = (g: EntryGroup) => [g.steps.length, g.steps.slice(0, -1).filter((s) => s.hit).length, g.dice.reduce((a, b) => a + b, 0)];
  const better = (a: EntryGroup, b: EntryGroup) => {
    const [x, y] = [score(a), score(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i];
    return false;
  };
  for (const seq of remaining(e)) {
    if (seq.steps[n]?.from !== from) continue;
    for (let j = n; j < seq.steps.length; j++) {
      if (j > n && seq.steps[j].from !== seq.steps[j - 1].to) break;
      const group = { steps: seq.steps.slice(n, j + 1), dice: seq.dice.slice(n, j + 1) };
      const to = seq.steps[j].to;
      const current = out.get(to);
      if (!current || better(group, current)) out.set(to, group);
      if (to === 0) break;
    }
  }
  return out;
}

/** Enter a group from `tapGroup` or `destinations`. Throws when it does not continue a legal play. */
export function enter(e: MoveEntry, group: EntryGroup): MoveEntry {
  const next = { ...e, groups: [...e.groups, group] };
  if (group.steps.length === 0 || group.steps.length !== group.dice.length || remaining(next).length === 0) {
    throw new Error("not a legal continuation");
  }
  return next;
}

export function undo(e: MoveEntry): MoveEntry {
  return { ...e, groups: e.groups.slice(0, -1) };
}

export function clear(e: MoveEntry): MoveEntry {
  return { ...e, groups: [] };
}

/** The mover's board after the entered steps. */
export function boardAfter(view: PerspectiveView, e: MoveEntry): BoardState {
  return applySteps(stateFromView(view), enteredSteps(e)) ?? stateFromView(view);
}

/** The entered steps in gnubg notation ("" before the first move). */
export function entryNotation(e: MoveEntry): string {
  return formatPlay(enteredSteps(e));
}
