/**
 * What the play routes and pages share: a store connection with the live engine, fair dice
 * and the clock, and the mapping of errors to HTTP statuses. Server-only.
 */
import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { ENGINE_PLIES, EngineError, getEngine, warmEngine } from "./engine";
import { PlayError, type PlayDeps, type UserAction } from "./play-service";
import { PlayConflictError } from "./play-store";
import { DATA_DIR } from "./problems";
import { openStore, storePath } from "./store";

export const PLAYER_NAME = "You";

export function rollDice(): [number, number] {
  return [randomInt(1, 7), randomInt(1, 7)];
}

/** Local date-time without a zone ("2026-09-24T10:32:05.123"), like the dates of imported matches. */
export function localIso(d: Date = new Date()): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 23);
}

/** Run `fn` with a writable store connection (closed afterwards) and the live engine. */
export async function withPlayDeps<T>(fn: (deps: PlayDeps) => Promise<T> | T): Promise<T> {
  const db = openStore(storePath(DATA_DIR));
  try {
    return await fn({ db, engine: getEngine(), roll: rollDice, now: () => localIso(), plies: ENGINE_PLIES });
  } finally {
    db.close();
  }
}

export function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export function playErrorResponse(e: unknown) {
  if (e instanceof PlayConflictError) return jsonError(e.message, 409);
  if (e instanceof PlayError) return jsonError(e.message, e.status);
  if (e instanceof EngineError) return jsonError(e.message, 503);
  return jsonError(e instanceof Error ? e.message : String(e), 500);
}

const SIMPLE = new Set(["roll", "double", "take", "pass", "next-game", "end"]);

/** A user action from a request body, or null when it is malformed. */
export function parseAction(x: unknown): UserAction | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (o.type === "move") return typeof o.play === "string" && o.play.length <= 100 ? { type: "move", play: o.play } : null;
  return typeof o.type === "string" && SIMPLE.has(o.type) ? ({ type: o.type } as UserAction) : null;
}

/** Start gnubg in the background so the first move does not wait for it. */
export function warmUp(): void {
  warmEngine();
}
