/**
 * Lesson upload. Saves a Backgammon Galaxy quiz export, bytes as received, to a temporary file
 * under data/lessons/.incoming/ and runs pipeline/import_lessons.py on it through uv, streaming
 * its NDJSON progress; the importer downloads the pictures and writes data/lessons/lessons.sqlite.
 * The upload's own file name is passed along: its "Medium - " / "Hard - " prefix becomes the set's
 * collection.
 *
 *   POST /api/lessons/import  multipart: file=<.json>, replace=1 (optional)
 *   -> application/x-ndjson, one {"event": ...} object per line (see import_lessons.py), plus
 *      "log" (the importer's stderr), "error" and "exit" events from this route.
 *
 * Errors before the import starts are plain JSON { error } responses.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { lessonsDir } from "@/lib/lesson-store";
import { findUv, PIPELINE_DIR, streamProcess, UV_MISSING } from "@/lib/pipeline-process";
import { DATA_DIR } from "@/lib/problems";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INCOMING_DIR = path.join(lessonsDir(DATA_DIR), ".incoming");
const MAX_BYTES = 2_000_000;
const DEL = String.fromCharCode(0x7f);
const BOM = String.fromCharCode(0xfeff);

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/** The upload's base name without control characters, at most 200 characters. */
function sourceName(name: string): string {
  const base = Array.from(name.split(/[\\/]/).pop() ?? "")
    .filter((ch) => ch >= " " && ch !== DEL)
    .join("")
    .trim()
    .slice(0, 200);
  return base || "quiz.json";
}

function looksLikeQuiz(bytes: Buffer): boolean {
  try {
    let text = bytes.toString("utf8");
    if (text.startsWith(BOM)) text = text.slice(1);
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== "object") return false;
    const quiz = data as Record<string, unknown>;
    return quiz.type === "mcq" && typeof quiz.id === "string" && Array.isArray(quiz.problems);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return bad("expected a multipart form with the quiz export in the 'file' field");
  if (file.size > MAX_BYTES) return bad("file too large (2 MB max)");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!looksLikeQuiz(bytes)) return bad(`${file.name}: not a Backgammon Galaxy quiz export (a JSON object with type "mcq", an id and problems)`);
  const replaceFlag = form?.get("replace");
  const replace = replaceFlag === "1" || replaceFlag === "true";
  const uv = findUv();
  if (!uv) return bad(UV_MISSING, 500);

  mkdirSync(INCOMING_DIR, { recursive: true });
  const target = path.join(INCOMING_DIR, `${Date.now()}-${randomUUID()}.json`);
  writeFileSync(target, bytes);

  // "--source-name=<name>" in one argument: a name starting with "-" is not taken for an option.
  const args = ["run", "import_lessons.py", target, "--json", `--source-name=${sourceName(file.name)}`, ...(replace ? ["--replace"] : [])];
  return streamProcess(uv, args, { cwd: PIPELINE_DIR, onClose: () => rmSync(target, { force: true }) });
}
