/**
 * Translations of stored explanations into the other language: a Hebrew explanation into
 * English, an older English one into Hebrew. Generated only from the explanation panel: right
 * after it receives a new explanation, or from its "Translate to …" button for one stored
 * without a translation. Each result is inserted into table translations (never updated or
 * deleted); the loaders show the newest translation of the explanation on show.
 *
 *   GET  /api/explain/translate?explanationId=12   -> the prompt that would be sent (no API call)
 *   POST /api/explain/translate { explanationId, model } -> { translation, mismatches, ... }
 *
 * The direction comes from the explanation's language; the model is the one picked in the panel,
 * the effort always TRANSLATION_EFFORT.
 */
import { NextResponse } from "next/server";
import { askClaude, ClaudeError, hasApiKey, NO_KEY, type ClaudeReply } from "@/lib/claude";
import { MAX_TOKENS } from "@/lib/explain";
import { translationMismatches } from "@/lib/explain-audit";
import { isExplainModel } from "@/lib/explain-models";
import { DATA_DIR } from "@/lib/problems";
import { insertTranslation, openStore, readExplanation, storePath } from "@/lib/store";
import { buildTranslationPrompt, cleanTranslation, TRANSLATION_EFFORT, TRANSLATION_PROMPTS, translationSha256 } from "@/lib/translate";
import { translationLanguage, type ExplanationTranslation } from "@/types/problem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/** A positive integer row id, given as a number or a string of digits. */
function parseId(x: unknown): number | null {
  const n = typeof x === "string" && /^\d+$/.test(x) ? Number(x) : x;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("explanationId");
  const id = parseId(raw);
  const original = id === null ? null : readExplanation(DATA_DIR, id);
  if (!original) return bad(`unknown explanation "${raw ?? ""}"`);
  const into = translationLanguage(original.language);
  return NextResponse.json({
    explanationId: original.id,
    problemId: original.problemId,
    from: original.language,
    into,
    promptVersion: TRANSLATION_PROMPTS[into].version,
    effort: TRANSLATION_EFFORT,
    system: TRANSLATION_PROMPTS[into].system,
    prompt: buildTranslationPrompt(original.explanation, into),
  });
}

export async function POST(req: Request) {
  let body: { explanationId?: unknown; model?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("expected a JSON body { explanationId, model }");
  }
  const id = parseId(body.explanationId);
  if (id === null) return bad("explanationId is required");
  const { model } = body;
  if (typeof model !== "string" || !isExplainModel(model)) return bad(`unknown model "${String(model)}"`);
  const original = readExplanation(DATA_DIR, id);
  if (!original) return bad(`unknown explanation ${id}`);
  if (!hasApiKey()) return bad(NO_KEY, 500);

  const into = translationLanguage(original.language);
  const prompt = buildTranslationPrompt(original.explanation, into);
  let reply: ClaudeReply;
  try {
    reply = await askClaude({ model, effort: TRANSLATION_EFFORT, system: TRANSLATION_PROMPTS[into].system, prompt, maxTokens: MAX_TOKENS });
  } catch (e) {
    return bad(e instanceof ClaudeError ? e.message : String(e), 502);
  }
  const text = cleanTranslation(reply.rawText);
  if (!text) return bad("The model returned no text.", 502);

  const generatedAt = new Date().toISOString();
  const db = openStore(storePath(DATA_DIR));
  try {
    insertTranslation(db, {
      explanationId: id,
      language: into,
      requestedModel: model,
      model: reply.model,
      promptVersion: TRANSLATION_PROMPTS[into].version,
      promptSha256: translationSha256(prompt, into),
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
  } finally {
    db.close();
  }

  const translation: ExplanationTranslation = { explanationId: id, language: into, text, model: reply.model, generatedAt: generatedAt.slice(0, 10) };
  return NextResponse.json({
    translation,
    mismatches: translationMismatches(original.explanation, text),
    servedByFallback: reply.servedByFallback,
    usage: { inputTokens: reply.inputTokens, outputTokens: reply.outputTokens },
  });
}
