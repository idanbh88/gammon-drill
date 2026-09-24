/**
 * Matches against gnubg.
 *
 *   POST /api/play { matchLength, jacoby? } -> the new match (PlayView); gnubg plays first when it wins the opening roll
 *
 * gnubg runs in one long-lived process (src/lib/engine.ts); the match lives in data/store.sqlite.
 */
import { NextResponse } from "next/server";
import { startPlayMatch } from "@/lib/play-service";
import { jsonError, PLAYER_NAME, playErrorResponse, withPlayDeps } from "@/lib/play-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MATCH_LENGTH = 25;

export async function POST(req: Request) {
  let body: { matchLength?: unknown; jacoby?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError("expected a JSON body { matchLength, jacoby }", 400);
  }
  const { matchLength } = body;
  if (typeof matchLength !== "number" || !Number.isInteger(matchLength) || matchLength < 0 || matchLength > MAX_MATCH_LENGTH) {
    return jsonError(`matchLength must be 0 (money) to ${MAX_MATCH_LENGTH}`, 400);
  }
  const jacoby = matchLength === 0 && body.jacoby !== false;
  try {
    return NextResponse.json(await withPlayDeps((deps) => startPlayMatch(deps, { matchLength, jacoby }, PLAYER_NAME)));
  } catch (e) {
    return playErrorResponse(e);
  }
}
