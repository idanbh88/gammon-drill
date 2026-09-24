/**
 * Hebrew translations of stored explanations, generated only from the explanation panel: right
 * after it receives a new explanation, or from its "Translate to Hebrew" button for an older
 * one. Each result is inserted into table translations (never updated or deleted); the loaders
 * show the newest translation of the explanation on show.
 *
 *   GET  /api/explain/translate?explanationId=12   -> the prompt that would be sent (no API call)
 *   POST /api/explain/translate { explanationId, model } -> { hebrew, mismatches, ... }
 *
 * The model is the one picked in the panel; the effort is always TRANSLATION_EFFORT.
 */
import { NextResponse } from "next/server";
import { askClaude, ClaudeError, hasApiKey, NO_KEY, type ClaudeReply } from "@/lib/claude";
import { MAX_TOKENS } from "@/lib/explain";
import { translationMismatches } from "@/lib/explain-audit";
import { isExplainModel } from "@/lib/explain-models";
import { DATA_DIR } from "@/lib/problems";
import { HEBREW, insertTranslation, openStore, readExplanation, storePath } from "@/lib/store";
import {
  buildTranslationPrompt,
  cleanTranslation,
  TRANSLATION_EFFORT,
  TRANSLATION_PROMPT_VERSION,
  TRANSLATION_SYSTEM_PROMPT,
  translationSha256,
} from "@/lib/translate";
import type { ExplanationTranslation } from "@/types/problem";

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
  const english = id === null ? null : readExplanation(DATA_DIR, id);
  if (!english) return bad(`unknown explanation "${raw ?? ""}"`);
  return NextResponse.json({
    explanationId: english.id,
    problemId: english.problemId,
    promptVersion: TRANSLATION_PROMPT_VERSION,
    effort: TRANSLATION_EFFORT,
    system: TRANSLATION_SYSTEM_PROMPT,
    prompt: buildTranslationPrompt(english.explanation),
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
  const english = readExplanation(DATA_DIR, id);
  if (!english) return bad(`unknown explanation ${id}`);
  if (!hasApiKey()) return bad(NO_KEY, 500);

  const prompt = buildTranslationPrompt(english.explanation);
  let reply: ClaudeReply;
  try {
    reply = await askClaude({ model, effort: TRANSLATION_EFFORT, system: TRANSLATION_SYSTEM_PROMPT, prompt, maxTokens: MAX_TOKENS });
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
      language: HEBREW,
      requestedModel: model,
      model: reply.model,
      promptVersion: TRANSLATION_PROMPT_VERSION,
      promptSha256: translationSha256(prompt),
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

  const hebrew: ExplanationTranslation = { explanationId: id, text, model: reply.model, generatedAt: generatedAt.slice(0, 10) };
  return NextResponse.json({
    hebrew,
    mismatches: translationMismatches(english.explanation, text),
    servedByFallback: reply.servedByFallback,
    usage: { inputTokens: reply.inputTokens, outputTokens: reply.outputTokens },
  });
}
