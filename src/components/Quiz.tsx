"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Answer, ExplanationPatch, Problem } from "@/types/problem";
import { questionText } from "@/lib/board";
import { applyFilters, difficultyBand, DEFAULT_FILTERS, loadFilters, saveFilters, type Filters } from "@/lib/filters";
import { difficulty, offeredAnswers } from "@/lib/problem-utils";
import { cardState, cardStates, dueCount, humanizeInterval, pickNext, type PickReason } from "@/lib/scheduler";
import { shuffle } from "@/lib/shuffle";
import { clearAttempts, computeStats, loadAttempts, saveAttempt, type Attempt } from "@/lib/storage";
import { formatLoss, formatPlayedAt } from "@/lib/matches";
import { parseXgid } from "@/lib/xgid";
import AnswerReveal from "./AnswerReveal";
import Board from "./Board";
import { QuizToggle } from "./DecisionFeedback";
import ExplanationPanel from "./ExplanationPanel";
import FilterPanel from "./FilterPanel";
import SessionStats from "./SessionStats";

interface Current {
  problem: Problem;
  reason: PickReason;
  /** The answers offered as buttons, in display order. */
  choices: Answer[];
  picked: string | null;
  /** After answering: when this problem comes back. */
  nextIn: string | null;
}

function pick(pool: Problem[], attempts: Attempt[], exclude: string | null): Current | null {
  const next = pickNext(pool, cardStates(pool, attempts), { exclude });
  if (!next) return null;
  return { problem: next.problem, reason: next.reason, choices: shuffle(offeredAnswers(next.problem)), picked: null, nextIn: null };
}

const REASON: Record<PickReason, { text: string; className: string; title: string }> = {
  again: { text: "Again", className: "bg-red-100 text-red-800", title: "You got this one wrong last time" },
  review: { text: "Review", className: "bg-amber-100 text-amber-800", title: "Scheduled review" },
  new: { text: "New", className: "bg-blue-100 text-blue-800", title: "Never attempted" },
  ahead: { text: "Ahead of schedule", className: "bg-stone-100 text-stone-600", title: "Nothing is due; showing the problem due soonest" },
};

/** Rendered client-only (see QuizLoader), so lazy state initialisers may shuffle and read storage. */
export default function Quiz({ problems }: { problems: Problem[] }) {
  const [filters, setFilters] = useState<Filters>(() => loadFilters());
  const [attempts, setAttempts] = useState<Attempt[]>(() => loadAttempts());
  const [current, setCurrent] = useState<Current | null>(() => pick(applyFilters(problems, loadFilters()), loadAttempts(), null));
  const [count, setCount] = useState(1);
  /** Explanations and translations generated in this session, keyed by problem id (the store has them for next time). */
  const [generated, setGenerated] = useState<Record<string, ExplanationPatch>>({});

  const pool = useMemo(() => applyFilters(problems, filters), [problems, filters]);
  const due = useMemo(() => dueCount(pool, cardStates(pool, attempts)), [pool, attempts]);
  const stats = useMemo(() => computeStats(attempts), [attempts]);
  const problem = useMemo(() => (current ? { ...current.problem, ...generated[current.problem.id] } : undefined), [current, generated]);
  const position = useMemo(() => (problem ? parseXgid(problem.xgid) : null), [problem]);

  const changeFilters = useCallback(
    (f: Filters) => {
      saveFilters(f);
      setFilters(f);
      const nextPool = applyFilters(problems, f);
      if (!current || current.picked || !nextPool.some((p) => p.id === current.problem.id)) {
        setCurrent(pick(nextPool, attempts, null));
      }
    },
    [problems, current, attempts],
  );

  const choose = useCallback(
    (a: Answer) => {
      if (!current || current.picked) return;
      const all = saveAttempt({
        problemId: current.problem.id,
        answerId: a.id,
        equityLoss: a.equityLoss,
        correct: a.equityLoss === 0,
        at: new Date().toISOString(),
      });
      setAttempts(all);
      const nextDue = cardState(current.problem.id, all).due;
      setCurrent({ ...current, picked: a.id, nextIn: humanizeInterval(nextDue - Date.now()) });
    },
    [current],
  );

  const next = useCallback(() => {
    setCurrent(pick(pool, attempts, current?.problem.id ?? null));
    setCount((c) => c + 1);
  }, [pool, attempts, current]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // A focused button handles Space and Enter itself (otherwise Enter on "Next problem" or
      // "Generate explanation" would also advance the quiz); form controls keep every key.
      if (e.target instanceof HTMLElement && e.target.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
      if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if (!current) return;
      const n = Number(e.key);
      if (!current.picked && Number.isInteger(n) && n >= 1 && n <= current.choices.length) {
        choose(current.choices[n - 1]);
        e.preventDefault();
      } else if (current.picked && (e.key === "Enter" || e.key.toLowerCase() === "n")) {
        next();
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, choose, next]);

  const filterPanel = (
    <FilterPanel filters={filters} onChange={changeFilters} problems={problems} matching={pool.length} due={due} />
  );

  if (problems.length === 0) {
    return <div className="p-8 text-stone-600">No problems found in data/. Add a problem set and reload.</div>;
  }

  if (!current || !problem || !position) {
    return (
      <div className="mx-auto max-w-7xl p-4">
        {filterPanel}
        <div className="mt-6 rounded-lg border border-stone-200 bg-white p-6 text-stone-600">
          No problems match these filters.{" "}
          <button type="button" className="text-blue-700 underline" onClick={() => changeFilters(DEFAULT_FILTERS)}>
            Reset filters
          </button>
        </div>
      </div>
    );
  }

  const best = problem.answers[0];
  const isCorrect = current.picked === best.id;
  const reason = REASON[current.reason];

  return (
    <div className="mx-auto max-w-7xl p-4">
      {filterPanel}
      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="Board">
          <Board position={position} />
        </section>

        <section className="flex flex-col gap-4" aria-label="Question">
          <header>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-stone-500">
              <span>Problem {count}</span>
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${reason.className}`} title={reason.title} data-reason={current.reason}>
                {reason.text}
              </span>
              {problem.origin && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900" data-origin={problem.origin.site}>
                  My mistake
                </span>
              )}
              <span>·</span>
              <span className="font-mono">{problem.id}</span>
              <span>·</span>
              <span>{problem.categories.join(", ")}</span>
              <span>·</span>
              <span>
                gap {difficulty(problem).toFixed(3)} ({difficultyBand(problem)})
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold">{questionText(position)}</h1>
          </header>

          {!current.picked ? (
            <ol className="grid gap-2" aria-label="Answers">
              {current.choices.map((a, i) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => choose(a)}
                    className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-left text-lg shadow-sm transition hover:border-blue-500 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <span className="mr-3 inline-block w-5 text-stone-400">{i + 1}</span>
                    <span className="font-mono">{a.label}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <>
              <div
                className={`rounded-lg px-4 py-3 text-lg font-medium ${
                  isCorrect ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                }`}
                role="status"
              >
                {isCorrect ? (
                  "Correct."
                ) : (
                  <>
                    Not the best play. Best: <span className="font-mono">{best.label}</span>
                  </>
                )}
                {current.nextIn && (
                  <span className="ml-2 text-sm font-normal opacity-80" data-next-in>
                    Comes back in {current.nextIn}.
                  </span>
                )}
              </div>
              <AnswerReveal answers={problem.answers} pickedId={current.picked} offeredIds={current.choices.map((c) => c.id)} gameId={problem.origin?.played} />
              {problem.origin && (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-600" data-origin-line>
                  <span>
                    {problem.origin.site === "gnubg" ? "Your game against gnubg" : `Your ${problem.origin.site} match against ${problem.origin.opponent}`}
                    {problem.origin.playedAt && ` on ${formatPlayedAt(problem.origin.playedAt).slice(0, 10)}`}: you played{" "}
                    <span className="font-mono">{problem.answers.find((a) => a.id === problem.origin!.played)?.label ?? problem.origin.played}</span>{" "}
                    <span className="font-mono text-red-700">{formatLoss(problem.origin.loss)}</span>.
                  </span>
                  <QuizToggle key={problem.id} decisionId={problem.id} initial={true} />
                </p>
              )}
              <ExplanationPanel
                key={problem.id}
                problem={problem}
                onGenerated={(id, patch) => setGenerated((g) => ({ ...g, [id]: { ...g[id], ...patch } }))}
              />
              <button
                type="button"
                onClick={next}
                className="rounded-lg bg-blue-600 px-4 py-3 text-lg font-medium text-white shadow hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                Next problem
              </button>
            </>
          )}

          <SessionStats
            stats={stats}
            onReset={() => {
              clearAttempts();
              setAttempts([]);
            }}
          />

          <details className="text-sm text-stone-500">
            <summary className="cursor-pointer">Position details</summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt>XGID</dt>
              <dd className="font-mono break-all">{problem.xgid}</dd>
              <dt>Source</dt>
              <dd>
                {problem.source ?? "—"}
                {problem.origin && (
                  <>
                    {" · "}
                    <a href={`/matches/${problem.origin.matchId}`} className="text-blue-700 underline">
                      the match
                    </a>
                  </>
                )}
              </dd>
              <dt>Engine</dt>
              <dd>
                {problem.analysis?.engine ?? "—"}
                {problem.analysis?.plies !== undefined && ` (${problem.analysis.plies}-ply)`}
                {problem.analysis?.positionClass && `, ${problem.analysis.positionClass}`}
              </dd>
            </dl>
            <p className="mt-2">Keys: 1–4 pick an answer, Enter or N for the next problem.</p>
          </details>
        </section>
      </div>
    </div>
  );
}
