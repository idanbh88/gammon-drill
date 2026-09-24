"use client";

import { useState } from "react";
import { ERROR_THRESHOLD, type MatchDecision } from "@/lib/matches";
import { positionAfter, verdict, type Tone } from "@/lib/play-ui";
import type { Position } from "@/lib/xgid";
import type { ExplanationPatch } from "@/types/problem";
import AnswerReveal from "./AnswerReveal";
import ExplanationPanel from "./ExplanationPanel";

const TONE: Record<Tone, string> = {
  best: "bg-green-100 text-green-900",
  fine: "bg-lime-100 text-lime-900",
  error: "bg-amber-100 text-amber-900",
  blunder: "bg-red-100 text-red-900",
  unscored: "bg-stone-100 text-stone-700",
};

/** Add a decision to the quiz or take it out (POST /api/quiz-picks). */
export function QuizToggle({ decisionId, initial }: { decisionId: string; initial: boolean }) {
  const [inQuiz, setInQuiz] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/quiz-picks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decisionId, included: !inQuiz }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; included?: boolean };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setInQuiz(Boolean(data.included));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <span className="inline-flex items-center gap-2 text-sm" data-in-quiz={inQuiz}>
      <span className={inQuiz ? "text-blue-800" : "text-stone-500"}>{inQuiz ? "In your quiz" : "Not in your quiz"}</span>
      <button type="button" onClick={toggle} disabled={pending} className="rounded border border-stone-300 bg-white px-2 py-0.5 hover:bg-stone-50 disabled:opacity-50">
        {inQuiz ? "Remove" : "Add to quiz"}
      </button>
      {error && <span className="text-red-700">{error}</span>}
    </span>
  );
}

/**
 * One graded decision of the user: the verdict, gnubg's ranking with the user's pick, the two
 * resulting positions on the board (checker plays), the quiz toggle and an explanation on demand.
 */
export default function DecisionFeedback({
  decision,
  onPreview,
  previewing,
}: {
  decision: MatchDecision;
  /** Show a position on the board instead of the game (null = back to the game). */
  onPreview?: (pos: Position | null, label: string | null) => void;
  /** The label of the preview on show, if any. */
  previewing?: string | null;
}) {
  const [generated, setGenerated] = useState<ExplanationPatch | null>(null);
  const problem = { ...decision.problem, ...generated };
  const v = verdict(decision);
  const best = problem.answers[0];
  const played = decision.played;
  const canPreview = onPreview && decision.kind === "checker" && played && played.loss > 0;

  function preview(label: string, play: string) {
    if (!onPreview) return;
    if (previewing === label) onPreview(null, null);
    else onPreview(positionAfter(problem.xgid, play, 1), label);
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white p-3" data-feedback={problem.id} data-tone={v.tone}>
      <p className={`rounded px-3 py-2 font-medium ${TONE[v.tone]}`} role="status">
        {v.text}
      </p>
      {canPreview && (
        <div className="flex flex-wrap gap-2 text-sm" role="group" aria-label="Show a resulting position">
          {[
            { label: "your play", play: played.id },
            { label: "best play", play: best.id },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => preview(o.label, o.play)}
              aria-pressed={previewing === o.label}
              className={`rounded border px-2 py-1 ${previewing === o.label ? "border-stone-800 bg-stone-800 text-white" : "border-stone-300 bg-white hover:bg-stone-50"}`}
            >
              Show {o.label}
            </button>
          ))}
        </div>
      )}
      {problem.answers.length > 0 && <AnswerReveal answers={problem.answers} pickedId={played?.id ?? null} offeredIds={problem.answers.map((a) => a.id)} />}
      <div className="flex flex-wrap items-center gap-3">
        {played && <QuizToggle decisionId={problem.id} initial={decision.inQuiz ?? played.loss >= ERROR_THRESHOLD} />}
      </div>
      {problem.answers.length >= 2 && (
        <ExplanationPanel key={problem.id} problem={problem} onGenerated={(_id, patch) => setGenerated((prev) => ({ ...prev, ...patch }))} />
      )}
    </section>
  );
}
