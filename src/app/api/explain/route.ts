/**
 * On-demand explanations. Nothing is generated unless the user clicks; each result is inserted
 * into data/store.sqlite (rows are never updated or deleted) and the loader shows the newest one.
 *
 *   GET  /api/explain?problemId=seed-001   -> the prompt that would be sent (no API call)
 *   POST /api/explain { problemId, model, effort? } -> { explanation, explanationMeta, audit, ... }
 *
 * `effort` (low / medium / high / xhigh / max) is sent as output_config.effort and recorded with
 * the explanation; without it the model's default level from explain-models.ts is used.
 *
 * `problemId` is a quiz problem id or a match decision id (match-<id>-g1-m7-checker, from the
 * store); for a decision the prompt also names the move that was played.
 *
 * `explanationMeta.id` is the new row; the panel then asks /api/explain/translate for its Hebrew
 * translation.
 *
 * The API key comes from ANTHROPIC_API_KEY, which Next.js loads from the repo-root .env into the
 * server process; it never reaches the client.
 */
import { NextResponse } from "next/server";
import { askClaude, ClaudeError, hasApiKey, NO_KEY, type ClaudeReply } from "@/lib/claude";
import { buildPrompt, cleanExplanation, maxTokensFor, promptSha256, PROMPT_VERSION, SYSTEM_PROMPT, type PromptOptions } from "@/lib/explain";
import { auditExplanation } from "@/lib/explain-audit";
import { explainModel, isExplainEffort, isExplainModel, suggestedModel } from "@/lib/explain-models";
import { toMatchDecision } from "@/lib/matches";
import { DATA_DIR, loadProblems } from "@/lib/problems";
import { insertExplanation, openStore, readDecision, readLatestExplanations, storePath } from "@/lib/store";
import type { Problem } from "@/types/problem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

async function findProblem(id: string): Promise<{ problem: Problem; opts: PromptOptions } | undefined> {
  const quiz = (await loadProblems()).find((p) => p.id === id);
  if (quiz) return { problem: quiz, opts: {} };
  const row = readDecision(DATA_DIR, id);
  if (!row || row.forced) return undefined;
  const decision = toMatchDecision(row, readLatestExplanations(DATA_DIR));
  return { problem: decision.problem, opts: decision.played ? { played: { label: decision.played.label, equityLoss: decision.played.loss } } : {} };
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("problemId") ?? "";
  const found = await findProblem(id);
  if (!found) return bad(`unknown problem "${id}"`);
  return NextResponse.json({
    problemId: found.problem.id,
    promptVersion: PROMPT_VERSION,
    suggestedModel: suggestedModel(found.problem),
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(found.problem, found.opts),
  });
}

export async function POST(req: Request) {
  let body: { problemId?: unknown; model?: unknown; effort?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("expected a JSON body { problemId, model, effort? }");
  }
  const { problemId, model } = body;
  if (body.effort !== undefined && (typeof body.effort !== "string" || !isExplainEffort(body.effort))) return bad(`unknown effort "${String(body.effort)}"`);
  if (typeof problemId !== "string") return bad("problemId is required");
  if (typeof model !== "string" || !isExplainModel(model)) return bad(`unknown model "${String(model)}"`);
  const found = await findProblem(problemId);
  if (!found) return bad(`unknown problem "${problemId}"`);
  if (!hasApiKey()) return bad(NO_KEY, 500);

  const { problem, opts } = found;
  const prompt = buildPrompt(problem, opts);
  const effort = typeof body.effort === "string" && isExplainEffort(body.effort) ? body.effort : explainModel(model).defaultEffort;
  let reply: ClaudeReply;
  try {
    reply = await askClaude({ model, effort, system: SYSTEM_PROMPT, prompt, maxTokens: maxTokensFor(effort) });
  } catch (e) {
    return bad(e instanceof ClaudeError ? e.message : String(e), 502);
  }
  const explanation = cleanExplanation(reply.rawText);
  if (!explanation) return bad("The model returned no text.", 502);

  const generatedAt = new Date().toISOString();
  const db = openStore(storePath(DATA_DIR));
  let id: number;
  try {
    id = insertExplanation(db, {
      xgid: problem.xgid,
      problemId: problem.id,
      requestedModel: model,
      model: reply.model,
      promptVersion: PROMPT_VERSION,
      promptSha256: promptSha256(prompt),
      explanation,
      rawText: reply.rawText,
      generatedAt,
      inputTokens: reply.inputTokens,
      outputTokens: reply.outputTokens,
      cacheReadTokens: reply.cacheReadTokens,
      requestId: reply.requestId,
      servedByFallback: reply.servedByFallback,
      effort,
    });
  } finally {
    db.close();
  }

  return NextResponse.json({
    explanation,
    explanationMeta: { id, model: reply.model, generatedAt: generatedAt.slice(0, 10), effort },
    audit: auditExplanation(problem, explanation),
    servedByFallback: reply.servedByFallback,
    usage: { inputTokens: reply.inputTokens, outputTokens: reply.outputTokens },
  });
}
