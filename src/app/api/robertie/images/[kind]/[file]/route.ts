/**
 * Scans from Robertie's book: GET /api/robertie/images/diagram/<s003-L-1>.png (a board as the
 * importer cropped it) and /api/robertie/images/page/<s003-L>.jpg (a book page). Only names the
 * importer writes are accepted (robertieImagePath), so nothing else under data/ can be reached.
 */
import { readFile } from "node:fs/promises";
import { DATA_DIR } from "@/lib/problems";
import { robertieImagePath } from "@/lib/robertie-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound() {
  return new Response("not found", { status: 404, headers: { "cache-control": "no-store" } });
}

export async function GET(_req: Request, ctx: { params: Promise<{ kind: string; file: string }> }) {
  const { kind, file } = await ctx.params;
  if (kind !== "diagram" && kind !== "page") return notFound();
  const full = robertieImagePath(DATA_DIR, kind, file);
  if (!full) return notFound();
  let data: Buffer;
  try {
    data = await readFile(full);
  } catch {
    return notFound();
  }
  // A re-import can rewrite a crop under the same name, so the browser checks back after an hour.
  return new Response(new Uint8Array(data), {
    headers: { "content-type": kind === "diagram" ? "image/png" : "image/jpeg", "cache-control": "private, max-age=3600" },
  });
}
