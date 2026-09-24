/**
 * One request to Claude for the explanation routes (/api/explain and /api/explain/translate):
 * a system prompt and one user message in, the reply's text and its provenance out. Server-only:
 * the SDK reads ANTHROPIC_API_KEY, which Next.js loads from the repo-root .env into the server
 * process; it never reaches the client.
 */
import Anthropic from "@anthropic-ai/sdk";
import { explainModel, type ExplainEffort, type ExplainModelId } from "./explain-models";

export const NO_KEY = "No API key. Put ANTHROPIC_API_KEY in .env at the repo root (see .env.example) and restart `npm run dev`.";

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/** A failed request, with a message fit for the panel. */
export class ClaudeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeError";
  }
}

export interface ClaudeRequest {
  model: ExplainModelId;
  effort: ExplainEffort;
  system: string;
  prompt: string;
  maxTokens: number;
}

export interface ClaudeReply {
  /** The reply's text blocks joined, before any cleaning. */
  rawText: string;
  /** The model that answered (differs from the one asked for after a server-side fallback). */
  model: string;
  requestId: string | null;
  servedByFallback: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number | null;
}

function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "The API key was rejected. Check ANTHROPIC_API_KEY in .env.";
  if (e instanceof Anthropic.PermissionDeniedError) return `The API key is not allowed to use this model (${e.message}).`;
  if (e instanceof Anthropic.RateLimitError) return "Rate limited by the API. Try again in a minute.";
  if (e instanceof Anthropic.APIConnectionError) return `Could not reach the API (${e.message}).`;
  if (e instanceof Anthropic.APIError) return `API error ${e.status ?? ""}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

/** Sends the request and returns the text; throws ClaudeError on an API error, a refusal or a cut-off reply. */
export async function askClaude(req: ClaudeRequest): Promise<ClaudeReply> {
  const spec = explainModel(req.model);
  const client = new Anthropic();
  let response: Anthropic.Beta.BetaMessage;
  let requestId: string | null = null;
  try {
    // Streamed so a long think at xhigh / max is not cut off by the SDK's non-streaming time limit.
    const stream = client.beta.messages.stream({
      model: req.model,
      max_tokens: req.maxTokens,
      system: [{ type: "text", text: req.system }],
      messages: [{ role: "user", content: req.prompt }],
      // Server-side retry on a substitute model if a safety classifier declines the request.
      // The served model is what gets recorded.
      ...(spec.usesFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      output_config: { effort: req.effort },
    });
    response = await stream.finalMessage();
    requestId = stream.request_id ?? null;
  } catch (e) {
    throw new ClaudeError(describeError(e));
  }

  if (response.stop_reason === "refusal") {
    throw new ClaudeError(`The model declined the request (${response.stop_details?.category ?? "refusal"}).`);
  }
  if (response.stop_reason === "max_tokens") throw new ClaudeError("The response was cut off at max_tokens.");
  const rawText = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return {
    rawText,
    model: response.model,
    requestId,
    servedByFallback: (response.usage.iterations ?? []).some((it) => it.type === "fallback_message"),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? null,
  };
}
