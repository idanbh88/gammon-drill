/**
 * Lesson pictures: GET /api/lessons/images/<quiz id>/<file> serves
 * data/lessons/<quiz id>/images/<file>, a PNG written by pipeline/import_lessons.py. Only names
 * the importer writes are accepted (lessonImagePath). A picture's bytes can change on a
 * re-import, but the page's URL carries ?v=<md5 prefix>, so a response may be cached for good.
 */
import { readFile } from "node:fs/promises";
import { lessonImagePath } from "@/lib/lesson-store";
import { DATA_DIR } from "@/lib/problems";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound() {
  return new Response("not found", { status: 404, headers: { "cache-control": "no-store" } });
}

export async function GET(_req: Request, ctx: { params: Promise<{ quizId: string; file: string }> }) {
  const { quizId, file } = await ctx.params;
  const full = lessonImagePath(DATA_DIR, quizId, file);
  if (!full) return notFound();
  let data: Buffer;
  try {
    data = await readFile(full);
  } catch {
    return notFound();
  }
  return new Response(new Uint8Array(data), {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" },
  });
}
