"use client";

import { useId, useState, type ReactNode } from "react";
import {
  translationLanguage,
  type ExplanationLanguage,
  type ExplanationMeta,
  type ExplanationPatch,
  type ExplanationTranslation,
  type Problem,
} from "@/types/problem";
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
import HebrewText from "./HebrewText";

const EFFORT_LABEL: Record<ExplainEffort, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
const LANGUAGE_NAME: Record<ExplanationLanguage, string> = { he: "Hebrew", en: "English" };

interface Props {
  problem: Problem;
  /** Called with a new explanation (its old translation cleared), then with its translation. */
  onGenerated: (problemId: string, patch: ExplanationPatch) => void;
}

async function postJson<T>(url: string, body: object): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function Prose({ language, text }: { language: ExplanationLanguage; text: string }) {
  return language === "he" ? <HebrewText text={text} /> : <p className="whitespace-pre-line text-stone-800">{text}</p>;
}

/** The text in one language with its small print; the blocks are ruled off from each other. */
function Block({ language, children }: { language: ExplanationLanguage; children: ReactNode }) {
  return (
    <div className="py-3 first:pt-0 last:pb-0" data-explanation-lang={language}>
      {children}
    </div>
  );
}

/**
 * The explanation under the answer reveal: the Hebrew on top and the English under it. New
 * explanations are written in Hebrew and translated into English; those written before
 * 2026-09-27 are English with a Hebrew translation, and are shown the same way round, each text
 * saying whether it is the original or the translation. Nothing is generated on its own: a
 * button asks /api/explain for an explanation with the chosen model (Fable preselected for hard
 * problems) and effort (the model's own default preselected, again when the model changes), then
 * /api/explain/translate for its translation with the same model; the same button regenerates
 * both. An explanation stored without a translation gets a "Translate to …" button. Mount with
 * key={problem.id} so the selection resets per problem.
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
  const meta = problem.explanationMeta;
  const explanationId = meta?.id;
  // Hand-written text has no language recorded: it is English.
  const language = meta?.language ?? "en";
  const target = translationLanguage(language);
  // A translation goes with the text it was made from; after a regeneration the old one is not shown.
  const stored = problem.explanationTranslation;
  const translation = stored && stored.explanationId === explanationId && stored.language === target ? stored : undefined;
  const audit = hasText ? auditExplanation(problem, problem.explanation) : [];
  const mismatches = translation ? translationMismatches(problem.explanation, translation.text) : [];

  async function translate(id: number, into: ExplanationLanguage) {
    setPending("translate");
    setError(null);
    try {
      // The server picks the direction from the explanation's language; `into` only names it here.
      // problemId picks the database: a book problem's explanations live in robertie.sqlite.
      const data = await postJson<{ translation?: ExplanationTranslation }>("/api/explain/translate", { explanationId: id, model, problemId: problem.id });
      if (!data.translation) throw new Error("the response had no text");
      onGenerated(problem.id, { explanationTranslation: data.translation });
    } catch (e) {
      setError(`${LANGUAGE_NAME[into]} translation failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPending(null);
    }
  }

  async function generate() {
    setPending("explain");
    setError(null);
    let created: ExplanationMeta;
    try {
      const data = await postJson<{ explanation?: string; explanationMeta?: ExplanationMeta }>("/api/explain", { problemId: problem.id, model, effort });
      if (!data.explanation || !data.explanationMeta) throw new Error("The response had no explanation.");
      created = data.explanationMeta;
      onGenerated(problem.id, { explanation: data.explanation, explanationMeta: created, explanationTranslation: undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPending(null);
      return;
    }
    // Every new explanation is translated right away, with the same model.
    if (created.id !== undefined) await translate(created.id, translationLanguage(created.language));
    else setPending(null);
  }

  const original = hasText && (
    <Block key="original" language={language}>
      <Prose language={language} text={problem.explanation} />
      {meta && (
        <p className="mt-2 text-xs text-stone-400">
          Generated in {LANGUAGE_NAME[language]} by {meta.model}
          {meta.effort && ` at ${meta.effort} effort`} on {meta.generatedAt}.
        </p>
      )}
      {audit.length > 0 && (
        <p className="mt-1 text-xs text-amber-700" data-audit>
          Not found in the data: {audit.join(", ")}. Read those with care.
        </p>
      )}
    </Block>
  );
  let translated: ReactNode = null;
  if (translation) {
    translated = (
      <Block key="translation" language={target}>
        <Prose language={target} text={translation.text} />
        <p className="mt-2 text-xs text-stone-400">
          {LANGUAGE_NAME[target]} translation by {translation.model} on {translation.generatedAt}.
        </p>
        {mismatches.length > 0 && (
          <p className="mt-1 text-xs text-amber-700" data-translation-check>
            The {LANGUAGE_NAME[target]} differs from the {LANGUAGE_NAME[language]} in: {mismatches.join(", ")}. Go by the{" "}
            {LANGUAGE_NAME[language]} there.
          </p>
        )}
      </Block>
    );
  } else if (hasText && pending === "translate") {
    translated = (
      <Block key="translation" language={target}>
        {target === "he" ? (
          <p dir="rtl" lang="he" className="italic text-stone-400">
            מתרגם לעברית…
          </p>
        ) : (
          <p className="italic text-stone-400">Translating into English…</p>
        )}
      </Block>
    );
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4" data-explanation>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-500">Explanation</h2>
      {hasText ? (
        // Hebrew on top and English under it, whichever of the two is the original.
        <div className="divide-y divide-stone-200">{language === "he" ? [original, translated] : [translated, original]}</div>
      ) : (
        <p className="italic text-stone-400">No explanation yet.</p>
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
          title="Written in Hebrew, then translated into English"
        >
          {pending === "explain" ? `Asking ${model}…` : hasText ? "Regenerate" : "Generate explanation"}
        </button>
        {hasText && explanationId !== undefined && !translation && pending === null && (
          <button
            type="button"
            onClick={() => translate(explanationId, target)}
            className="rounded border border-stone-300 bg-white px-3 py-1.5 font-medium text-stone-800 hover:bg-stone-50"
            title={`Translate this explanation into ${LANGUAGE_NAME[target]} with the model picked on the left`}
            data-translate
          >
            Translate to {LANGUAGE_NAME[target]}
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
