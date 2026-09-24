"use client";

import { Fragment, useId, useState } from "react";
import type { ExplanationMeta, ExplanationPatch, ExplanationTranslation, Problem } from "@/types/problem";
import { auditExplanation, translationMismatches } from "@/lib/explain-audit";
import {
  EXPLAIN_EFFORTS,
  EXPLAIN_MODELS,
  explainModel,
  isSlow,
  suggestedModel,
  type ExplainEffort,
  type ExplainModelId,
} from "@/lib/explain-models";
import { ltrRuns } from "@/lib/rtl";

const EFFORT_LABEL: Record<ExplainEffort, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };

interface Props {
  problem: Problem;
  /** Called with a new explanation (its old translation cleared), then with its Hebrew translation. */
  onGenerated: (problemId: string, patch: ExplanationPatch) => void;
}

async function postJson<T>(url: string, body: object): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

/** Hebrew prose, right to left, with moves and signed numbers kept left to right (see rtl.ts). */
function HebrewText({ text }: { text: string }) {
  return (
    <p dir="rtl" lang="he" className="whitespace-pre-line text-stone-800">
      {ltrRuns(text).map((run, i) =>
        run.ltr ? (
          <bdi key={i} dir="ltr">
            {run.text}
          </bdi>
        ) : (
          <Fragment key={i}>{run.text}</Fragment>
        ),
      )}
    </p>
  );
}

/**
 * The explanation under the answer reveal, in English with its Hebrew translation below.
 * Nothing is generated on its own: a button asks /api/explain for an explanation with the chosen
 * model (Fable preselected for hard problems) and effort (the model's own default preselected,
 * again when the model changes), then /api/explain/translate for its Hebrew translation with
 * the same model; the same button regenerates both. An explanation stored without a translation
 * gets a "Translate to Hebrew" button. Mount with key={problem.id} so the selection resets per
 * problem.
 */
export default function ExplanationPanel({ problem, onGenerated }: Props) {
  const [model, setModel] = useState<ExplainModelId>(() => suggestedModel(problem));
  const [effort, setEffort] = useState<ExplainEffort>(() => explainModel(suggestedModel(problem)).defaultEffort);
  const [pending, setPending] = useState<"explain" | "translate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Several panels can be on one page (the match review), so the select needs its own id.
  const selectId = useId();
  const effortId = useId();
  const defaultEffort = explainModel(model).defaultEffort;

  const hasText = problem.explanation.length > 0;
  const audit = hasText ? auditExplanation(problem, problem.explanation) : [];
  const explanationId = problem.explanationMeta?.id;
  // A translation goes with the text it was made from; after a regeneration the old one is not shown.
  const hebrew = problem.explanationHebrew?.explanationId === explanationId ? problem.explanationHebrew : undefined;
  const mismatches = hebrew ? translationMismatches(problem.explanation, hebrew.text) : [];

  async function translate(id: number) {
    setPending("translate");
    setError(null);
    try {
      const data = await postJson<{ hebrew?: ExplanationTranslation }>("/api/explain/translate", { explanationId: id, model });
      if (!data.hebrew) throw new Error("the response had no text");
      onGenerated(problem.id, { explanationHebrew: data.hebrew });
    } catch (e) {
      setError(`Hebrew translation failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPending(null);
    }
  }

  async function generate() {
    setPending("explain");
    setError(null);
    let meta: ExplanationMeta;
    try {
      const data = await postJson<{ explanation?: string; explanationMeta?: ExplanationMeta }>("/api/explain", { problemId: problem.id, model, effort });
      if (!data.explanation || !data.explanationMeta) throw new Error("The response had no explanation.");
      meta = data.explanationMeta;
      onGenerated(problem.id, { explanation: data.explanation, explanationMeta: meta, explanationHebrew: undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPending(null);
      return;
    }
    // Every new explanation is translated right away, with the same model.
    if (meta.id !== undefined) await translate(meta.id);
    else setPending(null);
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4" data-explanation>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-500">Explanation</h2>
      <p className="whitespace-pre-line text-stone-800">
        {hasText ? problem.explanation : <span className="italic text-stone-400">No explanation yet.</span>}
      </p>
      {problem.explanationMeta && (
        <p className="mt-2 text-xs text-stone-400">
          Generated by {problem.explanationMeta.model}
          {problem.explanationMeta.effort && ` at ${problem.explanationMeta.effort} effort`} on {problem.explanationMeta.generatedAt}.
        </p>
      )}
      {audit.length > 0 && (
        <p className="mt-1 text-xs text-amber-700" data-audit>
          Not found in the data: {audit.join(", ")}. Read those with care.
        </p>
      )}
      {hebrew ? (
        <div className="mt-3 border-t border-stone-200 pt-3" data-explanation-he>
          <HebrewText text={hebrew.text} />
          <p className="mt-2 text-xs text-stone-400">
            Hebrew translation by {hebrew.model} on {hebrew.generatedAt}.
          </p>
          {mismatches.length > 0 && (
            <p className="mt-1 text-xs text-amber-700" data-translation-check>
              The Hebrew differs from the English in: {mismatches.join(", ")}. Go by the English there.
            </p>
          )}
        </div>
      ) : (
        pending === "translate" && (
          <p dir="rtl" lang="he" className="mt-3 border-t border-stone-200 pt-3 italic text-stone-400">
            מתרגם לעברית…
          </p>
        )
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor={selectId} className="text-stone-500">
          Model
        </label>
        <select
          id={selectId}
          data-explain-model
          value={model}
          onChange={(e) => {
            const m = e.target.value as ExplainModelId;
            setModel(m);
            setEffort(explainModel(m).defaultEffort);
          }}
          disabled={pending !== null}
          className="max-w-full rounded border border-stone-300 bg-white px-2 py-1"
        >
          {EXPLAIN_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} · {m.note}
            </option>
          ))}
        </select>
        <label htmlFor={effortId} className="text-stone-500">
          Effort
        </label>
        <select
          id={effortId}
          data-explain-effort
          value={effort}
          onChange={(e) => setEffort(e.target.value as ExplainEffort)}
          disabled={pending !== null}
          className="rounded border border-stone-300 bg-white px-2 py-1"
          title="How much the model thinks before writing: higher is slower and uses more tokens"
        >
          {EXPLAIN_EFFORTS.map((level) => (
            <option key={level} value={level}>
              {EFFORT_LABEL[level]}
              {level === defaultEffort ? " (default)" : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={generate}
          disabled={pending !== null}
          className="rounded bg-stone-800 px-3 py-1.5 font-medium text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {pending === "explain" ? `Asking ${model}…` : hasText ? "Regenerate" : "Generate explanation"}
        </button>
        {hasText && explanationId !== undefined && !hebrew && pending === null && (
          <button
            type="button"
            onClick={() => translate(explanationId)}
            className="rounded border border-stone-300 bg-white px-3 py-1.5 font-medium text-stone-800 hover:bg-stone-50"
            title="Translate this explanation into Hebrew with the model picked on the left"
            data-translate
          >
            Translate to Hebrew
          </button>
        )}
        {pending === "explain" && <span className="text-stone-400">{isSlow(model, effort) ? "This can take a minute or more." : "Usually a few seconds."}</span>}
      </div>
      {error && (
        <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
