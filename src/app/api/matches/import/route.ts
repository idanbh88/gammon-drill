/**
 * Match upload. Saves the .mat file under data/matches/ and runs the Python importer
 * (pipeline/import_match.py via uv) as a child process, streaming its NDJSON progress back to
 * the browser as it happens; the importer writes the match into data/store.sqlite.
 *
 *   POST /api/matches/import  multipart: file=<.mat>, replace=1 (optional)
 *   -> application/x-ndjson, one {"event": ...} object per line (see import_match.py), plus
 *      "saved", "log" (the importer's stderr) and "exit" events from this route.
 *
 * uv is found through BG_UV or on PATH. Errors before the import starts are plain JSON
 * { error } responses; anything after that arrives as an "error" event in the stream.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { findUv, PIPELINE_DIR, safeFileName, streamProcess, UV_MISSING } from "@/lib/pipeline-process";
import { DATA_DIR } from "@/lib/problems";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MATCHES_DIR = path.join(DATA_DIR, "matches");
const MAX_BYTES = 1_000_000;

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return bad("expected a multipart form with the .mat file in the 'file' field");
  if (file.size > MAX_BYTES) return bad("file too large (1 MB max)");
  const text = await file.text();
  if (!/^\s*\d+\s+point\s+match/im.test(text)) return bad(`${file.name}: not a .mat match file (no "N point match" line)`);
  const replaceFlag = form?.get("replace");
  const replace = replaceFlag === "1" || replaceFlag === "true";
  const uv = findUv();
  if (!uv) return bad(UV_MISSING, 500);

  mkdirSync(MATCHES_DIR, { recursive: true });
  const target = path.join(MATCHES_DIR, safeFileName(file.name, ".mat"));
  writeFileSync(target, text, "utf8");

  const args = ["run", "import_match.py", target, "--json", "--player", "1", ...(replace ? ["--replace"] : [])];
  return streamProcess(uv, args, { cwd: PIPELINE_DIR, first: [{ event: "saved", file: path.basename(target) }] });
}
