/**
 * "Reading looks wrong" on the check page: POST /api/robertie/reports { number, note? } records
 * that a board of Robertie's book seems misread. The problem leaves the quiz until the report is
 * resolved (after a fix in data/robertie/fixes.json and a re-import).
 */
import { NextResponse } from "next/server";
import { DATA_DIR } from "@/lib/problems";
import { insertRobertieReport } from "@/lib/robertie-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { number?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "expected a JSON body { number, note? }" }, { status: 400 });
  }
  const n = typeof body.number === "number" && Number.isInteger(body.number) ? body.number : NaN;
  if (!(n >= 1 && n <= 501)) return NextResponse.json({ error: "number is required (1-501)" }, { status: 400 });
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  try {
    const id = insertRobertieReport(DATA_DIR, n, note);
    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
