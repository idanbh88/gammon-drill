/**
 * Which of the user's decisions the quiz shows. Every error (loss >= 0.02) is in by default; a
 * pick adds any other decision of the user or takes one out.
 *
 *   POST /api/quiz-picks { decisionId, included } -> { decisionId, included }
 */
import { NextResponse } from "next/server";
import { setQuizPick } from "@/lib/play-store";
import { DATA_DIR } from "@/lib/problems";
import { getDecision, getMatch, openStore, storePath } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request) {
  let body: { decisionId?: unknown; included?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("expected a JSON body { decisionId, included }");
  }
  const { decisionId, included } = body;
  if (typeof decisionId !== "string" || typeof included !== "boolean") return bad("decisionId (string) and included (boolean) are required");
  const db = openStore(storePath(DATA_DIR));
  try {
    const row = getDecision(db, decisionId);
    if (!row) return bad(`unknown decision "${decisionId}"`, 404);
    if (row.player !== getMatch(db, row.matchId)?.analysedPlayer) return bad("only your own decisions can go into the quiz");
    if (row.forced || row.answers.length < 2) return bad("a forced play has nothing to quiz");
    setQuizPick(db, decisionId, included, new Date().toISOString());
    return NextResponse.json({ decisionId, included });
  } finally {
    db.close();
  }
}
