/**
 * Robertie's text for one problem: GET /api/robertie/text/<n> -> BookText (the solution as
 * printed, its pages, the diagram and the newest Hebrew translation of exactly that text). Asked
 * for by the card under a book problem once it is answered.
 */
import { NextResponse } from "next/server";
import { DATA_DIR } from "@/lib/problems";
import { readRobertieText } from "@/lib/robertie-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ number: string }> }) {
  const { number } = await ctx.params;
  const n = /^\d{1,3}$/.test(number) ? Number(number) : NaN;
  const text = Number.isInteger(n) && n >= 1 && n <= 501 ? readRobertieText(DATA_DIR, n) : null;
  if (!text) return NextResponse.json({ error: `no problem ${number}` }, { status: 404 });
  return NextResponse.json(text);
}
