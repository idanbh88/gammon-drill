/**
 * Robertie's analysis into Hebrew, only when the reader asks (the card's "Translate to Hebrew").
 * Each result is appended to robertie_translations in data/robertie/robertie.sqlite with the hash
 * of the text it translates; the card shows the newest one for the current text.
 *
 *   GET  /api/robertie/translate?number=12   -> the prompt that would be sent (no API call)
 *   POST /api/robertie/translate { number, model? } -> { translation, mismatches }
 */
import { NextResponse } from "next/server";
import { askClaude, ClaudeError, hasApiKey, NO_KEY, type ClaudeReply } from "@/lib/claude";
import { MAX_TOKENS } from "@/lib/explain";
import { translationMismatches } from "@/lib/explain-audit";
import { DEFAULT_MODEL, isExplainModel, type ExplainModelId } from "@/lib/explain-models";
import { DATA_DIR } from "@/lib/problems";
import { insertRobertieTranslation, readSolutionForTranslation } from "@/lib/robertie-store";
import { buildRobertieTranslationPrompt, cleanTranslation, ROBERTIE_TRANSLATION, robertieTranslationSha256, TRANSLATION_EFFORT } from "@/lib/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function problemNumber(x: unknown): number | null {
  const n = typeof x === "string" && /^\d{1,3}$/.test(x) ? Number(x) : x;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 501 ? n : null;
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("number");
  const n = problemNumber(raw);
  const solution = n === null ? null : readSolutionForTranslation(DATA_DIR, n);
  if (!solution) return bad(`no text for problem "${raw ?? ""}"`);
  return NextResponse.json({
    number: n,
    promptVersion: ROBERTIE_TRANSLATION.version,
    effort: TRANSLATION_EFFORT,
    system: ROBERTIE_TRANSLATION.system,
    prompt: buildRobertieTranslationPrompt(solution.text),
  });
}

export async function POST(req: Request) {
  let body: { number?: unknown; model?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("expected a JSON body { number, model? }");
  }
  const n = problemNumber(body.number);
  if (n === null) return bad("number is required (1-501)");
  const model: ExplainModelId = typeof body.model === "string" && isExplainModel(body.model) ? body.model : DEFAULT_MODEL;
  const solution = readSolutionForTranslation(DATA_DIR, n);
  if (!solution) return bad(`no text for problem ${n}`);
  if (!hasApiKey()) return bad(NO_KEY, 500);

  const prompt = buildRobertieTranslationPrompt(solution.text);
  let reply: ClaudeReply;
  try {
    reply = await askClaude({ model, effort: TRANSLATION_EFFORT, system: ROBERTIE_TRANSLATION.system, prompt, maxTokens: MAX_TOKENS });
  } catch (e) {
    return bad(e instanceof ClaudeError ? e.message : String(e), 502);
  }
  const text = cleanTranslation(reply.rawText);
  if (!text) return bad("The model returned no text.", 502);
  const generatedAt = new Date().toISOString();
  insertRobertieTranslation(DATA_DIR, {
    number: n,
    solutionSha256: solution.sha256,
    language: "he",
    requestedModel: model,
    model: reply.model,
    promptVersion: ROBERTIE_TRANSLATION.version,
    promptSha256: robertieTranslationSha256(prompt),
    text,
    rawText: reply.rawText,
    generatedAt,
    inputTokens: reply.inputTokens,
    outputTokens: reply.outputTokens,
    cacheReadTokens: reply.cacheReadTokens,
    requestId: reply.requestId,
    servedByFallback: reply.servedByFallback,
    effort: TRANSLATION_EFFORT,
  });
  return NextResponse.json({
    translation: { text, model: reply.model, generatedAt: generatedAt.slice(0, 10) },
    mismatches: translationMismatches(solution.text, text),
    servedByFallback: reply.servedByFallback,
  });
}
