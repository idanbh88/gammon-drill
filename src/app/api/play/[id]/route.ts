/**
 * One match against gnubg.
 *
 *   GET  /api/play/<id>                     -> the match as it stands (PlayView)
 *   POST /api/play/<id> { action, version } -> the user's action, graded, then gnubg's turn (PlayView with events and graded)
 *
 * `version` is the one the client last saw; a stale one gets 409 (the match moved on in another tab).
 * Actions: roll, double, take, pass, move { play }, next-game, end (a money session).
 */
import { NextResponse } from "next/server";
import { playAction, playView } from "@/lib/play-service";
import { jsonError, parseAction, playErrorResponse, withPlayDeps } from "@/lib/play-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function matchId(params: Promise<{ id: string }>): Promise<number | null> {
  const n = Number((await params).id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = await matchId(params);
  if (id === null) return jsonError("bad match id", 400);
  try {
    return NextResponse.json(await withPlayDeps((deps) => playView(deps.db, id)));
  } catch (e) {
    return playErrorResponse(e);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = await matchId(params);
  if (id === null) return jsonError("bad match id", 400);
  let body: { action?: unknown; version?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError("expected a JSON body { action, version }", 400);
  }
  const action = parseAction(body.action);
  if (!action) return jsonError("unknown action", 400);
  if (typeof body.version !== "number") return jsonError("version is required", 400);
  const version = body.version;
  try {
    return NextResponse.json(await withPlayDeps((deps) => playAction(deps, id, action, version)));
  } catch (e) {
    return playErrorResponse(e);
  }
}
