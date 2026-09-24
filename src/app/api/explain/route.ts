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
 * The API key comes from ANTHROPIC_API_KEY, which Next.js loads from the repo-root .env into the
 * server process; it never reaches the client.
 */
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { buildPrompt, cleanExplanation, maxTokensFor, promptSha256, PROMPT_VERSION, SYSTEM_PROMPT, type PromptOptions } from "@/lib/explain";
import { auditExplanation } from "@/lib/explain-audit";
import { explainModel, isExplainEffort, isExplainModel, suggestedModel } from "@/lib/explain-models";
import { toMatchDecision } from "@/lib/matches";
import { DATA_DIR, loadProblems } from "@/lib/problems";
import { insertExplanation, openStore, readDecision, readLatestExplanations, storePath } from "@/lib/store";
import type { Problem } from "@/types/problem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_KEY = "No API key. Put ANTHROPIC_API_KEY in .env at the repo root (see .env.example) and restart `npm run dev`.";

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

function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "The API key was rejected. Check ANTHROPIC_API_KEY in .env.";
  if (e instanceof Anthropic.PermissionDeniedError) return `The API key is not allowed to use this model (${e.message}).`;
  if (e instanceof Anthropic.RateLimitError) return "Rate limited by the API. Try again in a minute.";
  if (e instanceof Anthropic.APIConnectionError) return `Could not reach the API (${e.message}).`;
  if (e instanceof Anthropic.APIError) return `API error ${e.status ?? ""}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
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
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return bad(NO_KEY, 500);

  const { problem, opts } = found;
  const prompt = buildPrompt(problem, opts);
  const spec = explainModel(model);
  const effort = typeof body.effort === "string" && isExplainEffort(body.effort) ? body.effort : spec.defaultEffort;
  const client = new Anthropic();
  let response: Anthropic.Beta.BetaMessage;
  let requestId: string | null = null;
  try {
    // Streamed so a long think at xhigh / max is not cut off by the SDK's non-streaming time limit.
    const stream = client.beta.messages.stream({
      model,
      max_tokens: maxTokensFor(effort),
      system: [{ type: "text", text: SYSTEM_PROMPT }],
      messages: [{ role: "user", content: prompt }],
      // Server-side retry on a substitute model if a safety classifier declines the request.
      // The served model is what gets recorded.
      ...(spec.usesFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      output_config: { effort },
    });
    response = await stream.finalMessage();
    requestId = stream.request_id ?? null;
  } catch (e) {
    return bad(describeError(e), 502);
  }

  if (response.stop_reason === "refusal") {
    return bad(`The model declined the request (${response.stop_details?.category ?? "refusal"}).`, 502);
  }
  const rawText = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (response.stop_reason === "max_tokens") return bad("The response was cut off at max_tokens.", 502);
  const explanation = cleanExplanation(rawText);
  if (!explanation) return bad("The model returned no text.", 502);

  const servedByFallback = (response.usage.iterations ?? []).some((it) => it.type === "fallback_message");
  const generatedAt = new Date().toISOString();
  const db = openStore(storePath(DATA_DIR));
  try {
    insertExplanation(db, {
      xgid: problem.xgid,
      problemId: problem.id,
      requestedModel: model,
      model: response.model,
      promptVersion: PROMPT_VERSION,
      promptSha256: promptSha256(prompt),
      explanation,
      rawText,
      generatedAt,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? null,
      requestId,
      servedByFallback,
      effort,
    });
  } finally {
    db.close();
  }

  return NextResponse.json({
    explanation,
    explanationMeta: { model: response.model, generatedAt: generatedAt.slice(0, 10), effort },
    audit: auditExplanation(problem, explanation),
    servedByFallback,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  });
}
