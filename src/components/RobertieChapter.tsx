"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { Answer, ExplanationPatch, Problem } from "@/types/problem";
import { currentIndex, initialPlayer, playerReducer, type PlayerState } from "@/lib/lesson-player";
import type { ProblemStatus } from "@/lib/lesson-progress";
import { offeredAnswers } from "@/lib/problem-utils";
import { chapterProgress, loadRuns, startRun, type ChapterSummary, type RobertieRuns } from "@/lib/robertie";
import { loadAttempts, saveAttempt, type Attempt } from "@/lib/storage";
import { parseXgid } from "@/lib/xgid";
import ProblemCard from "./ProblemCard";

const STATUS: Record<"correct" | "wrong" | "fixed" | "none", { className: string; title: string }> = {
  correct: { className: "bg-green-600 text-white", title: "right the first time" },
  wrong: { className: "bg-red-600 text-white", title: "wrong" },
  fixed: { className: "bg-amber-400 text-stone-900", title: "wrong, then right later" },
  none: { className: "border border-stone-300 bg-white text-stone-600", title: "not answered yet" },
};

const statusKey = (s: ProblemStatus) => s ?? "none";

/** A fixed order for a problem's answer buttons, so the best play is not always first and the
 * order does not change between visits. */
function stableOrder(problem: Problem): Answer[] {
  const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
  return [...offeredAnswers(problem)].sort((a, b) => hash(problem.id + a.id) - hash(problem.id + b.id));
}

function initial(problems: Problem[], statuses: ProblemStatus[], openNumber: number | null): PlayerState {
  const state = initialPlayer(statuses);
  const i = openNumber === null ? -1 : problems.findIndex((p) => p.book?.number === openNumber);
  return i < 0 ? state : playerReducer(state, { type: "open", index: i, answered: statuses[i] !== null });
}

/**
 * One chapter of Robertie's book, played in book order: the problems not answered in this run,
 * then a summary with "Retry my mistakes" and "Start over". Answers go into the quiz's attempt
 * log, so the main quiz's review schedule and the stats count them; only the run's start is kept
 * apart (bg-trainer/robertie/v1). Rendered client-only (RobertieChapterLoader).
 */
export default function RobertieChapter({ summary, problems, openNumber }: { summary: ChapterSummary; problems: Problem[]; openNumber: number | null }) {
  const ids = useMemo(() => problems.map((p) => p.id), [problems]);
  const [attempts, setAttempts] = useState<Attempt[]>(() => loadAttempts());
  const [runs, setRuns] = useState<RobertieRuns>(() => loadRuns());
  const runStart = runs.runs[String(summary.number)] ?? null;
  const progress = useMemo(() => chapterProgress(attempts, ids, runStart), [attempts, ids, runStart]);
  const [player, dispatch] = useReducer(playerReducer, undefined, () =>
    initial(problems, chapterProgress(loadAttempts(), ids, loadRuns().runs[String(summary.number)] ?? null).statuses, openNumber),
  );
  const [generated, setGenerated] = useState<Record<string, ExplanationPatch>>({});

  const index = currentIndex(player);
  const base = index === null ? null : problems[index];
  const problem = useMemo(() => (base ? { ...base, ...generated[base.id] } : null), [base, generated]);
  const position = useMemo(() => (problem ? parseXgid(problem.xgid) : null), [problem]);
  const choices = useMemo(() => (base ? stableOrder(base) : []), [base]);
  const reviewing = player.review !== null;
  const picked = reviewing && index !== null ? progress.picks[index] : player.picked;

  const answer = useCallback(
    (a: Answer) => {
      if (!problem || reviewing || player.picked) return;
      setAttempts(saveAttempt({ problemId: problem.id, answerId: a.id, equityLoss: a.equityLoss, correct: a.equityLoss === 0, at: new Date().toISOString() }));
      dispatch({ type: "answer", choiceId: a.id, view: null });
    },
    [problem, reviewing, player.picked],
  );

  const startOver = useCallback(() => {
    setRuns(startRun(runs, summary.number, new Date().toISOString()));
    dispatch({ type: "restart", total: problems.length });
  }, [runs, summary.number, problems.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // A focused button handles Space and Enter itself; form controls keep every key.
      if (e.target instanceof HTMLElement && e.target.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
      if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || !problem) return;
      const n = Number(e.key);
      if (!picked && Number.isInteger(n) && n >= 1 && n <= choices.length) {
        answer(choices[n - 1]);
        e.preventDefault();
      } else if (picked && (e.key === "Enter" || e.key.toLowerCase() === "n")) {
        dispatch({ type: "next" });
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [problem, picked, choices, answer]);

  const mistakes = progress.statuses.flatMap((s, i) => (s === "wrong" ? [i] : []));

  const header = (
    <header>
      <Link href="/robertie" className="text-sm text-blue-700 underline">
        Robertie 501
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">
        {summary.number}. {summary.title}
      </h1>
      <p className="text-sm text-stone-500" data-summary>
        Problems {summary.firstProblem}–{summary.lastProblem} · {problems.length} to play
        {summary.waiting > 0 && ` (${summary.waiting} more wait for a look at their board: see the check page)`}
        {progress.answered > 0 && ` · this run: ${progress.correct} of ${progress.answered} right`}
        {progress.fixed > 0 && `, ${progress.fixed} fixed`}
      </p>
      <ol className="mt-3 flex flex-wrap gap-1" aria-label="Problems">
        {problems.map((p, i) => {
          const key = statusKey(progress.statuses[i]);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => dispatch({ type: "open", index: i, answered: progress.statuses[i] !== null })}
                aria-current={i === index ? "step" : undefined}
                title={`Problem ${p.book?.number}: ${STATUS[key].title}`}
                data-status={key}
                className={`h-7 min-w-7 rounded px-1 text-xs font-medium ${STATUS[key].className} ${i === index ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
              >
                {p.book?.number}
              </button>
            </li>
          );
        })}
      </ol>
    </header>
  );

  if (problems.length === 0) {
    return (
      <div className="mx-auto max-w-7xl p-4">
        {header}
        <p className="mt-6 rounded-lg border border-stone-200 bg-white p-6 text-stone-600">No problem of this chapter is ready to play yet.</p>
      </div>
    );
  }

  if (!problem || !position) {
    const missed = problems.filter((_, i) => progress.statuses[i] === "wrong" || progress.statuses[i] === "fixed");
    return (
      <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
        {header}
        <section className="rounded-lg border border-stone-200 bg-white p-6" aria-label="Summary" data-chapter-summary>
          <h2 className="text-xl font-semibold">{progress.answered === progress.total ? "Chapter finished" : "Summary"}</h2>
          <p className="mt-1 text-lg">
            {progress.correct} of {progress.total} right the first time
            {progress.fixed > 0 && `, ${progress.fixed} more fixed later`}.
          </p>
          {missed.length > 0 && (
            <>
              <h3 className="mt-4 text-sm font-semibold uppercase tracking-wide text-stone-500">Mistakes</h3>
              <ul className="mt-1 flex flex-wrap gap-2">
                {missed.map((p) => {
                  const i = problems.indexOf(p);
                  return (
                    <li key={p.id}>
                      <button type="button" onClick={() => dispatch({ type: "open", index: i, answered: true })} className="rounded border border-stone-300 px-2 py-1 text-sm hover:bg-stone-100">
                        Problem {p.book?.number}
                        {progress.statuses[i] === "fixed" && <span className="ml-1 text-amber-700">(fixed)</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            {mistakes.length > 0 && (
              <button
                type="button"
                onClick={() => dispatch({ type: "retry", indexes: mistakes })}
                className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white shadow hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                Retry my mistakes ({mistakes.length})
              </button>
            )}
            <button type="button" onClick={startOver} className="rounded-lg border border-stone-300 bg-white px-4 py-2 font-medium hover:bg-stone-100">
              Start over
            </button>
            <Link href="/robertie" className="rounded-lg border border-stone-300 bg-white px-4 py-2 font-medium hover:bg-stone-100">
              All chapters
            </Link>
          </div>
        </section>
      </div>
    );
  }

  const last = !reviewing && player.queue.length === 1;
  return (
    <div className="mx-auto max-w-7xl p-4">
      {header}
      <ProblemCard
        problem={problem}
        position={position}
        choices={choices}
        picked={picked}
        onChoose={answer}
        onGenerated={(id, patch) => setGenerated((g) => ({ ...g, [id]: { ...g[id], ...patch } }))}
        badges={
          <span>
            {index! + 1} of {problems.length}
            {reviewing && " · review (not counted again)"}
          </span>
        }
        next={
          <button
            type="button"
            onClick={() => dispatch({ type: "next" })}
            className="rounded-lg bg-blue-600 px-4 py-3 text-lg font-medium text-white shadow hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            {reviewing ? "Back" : last ? "Finish" : "Next problem"}
          </button>
        }
      />
    </div>
  );
}
