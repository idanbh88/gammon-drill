"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Answer, ExplanationPatch, Problem } from "@/types/problem";
import { applyFilters, attemptedIds, DEFAULT_FILTERS, loadFilters, saveFilters, type Filters } from "@/lib/filters";
import { offeredAnswers } from "@/lib/problem-utils";
import { loadOrder, saveOrder, type QuizOrder } from "@/lib/quiz-order";
import { cardState, cardStates, dueCount, humanizeInterval, markSeen, pickNext, type PickReason } from "@/lib/scheduler";
import { shuffle } from "@/lib/shuffle";
import { clearAttempts, computeStats, loadAttempts, saveAttempt, type Attempt } from "@/lib/storage";
import { parseXgid } from "@/lib/xgid";
import FilterPanel from "./FilterPanel";
import ProblemCard from "./ProblemCard";
import SessionStats from "./SessionStats";

interface Current {
  problem: Problem;
  reason: PickReason;
  /** The answers offered as buttons, in display order. */
  choices: Answer[];
  picked: string | null;
  /** After answering: when this problem comes back. */
  nextIn: string | null;
  /** Random order: the problems dealt in this round, this one included. */
  seen: Set<string>;
}

const NO_SEEN: ReadonlySet<string> = new Set();

/** The round so far, without the current problem when a re-pick replaces it unanswered. */
function dealtBefore(current: Current | null): ReadonlySet<string> {
  if (!current) return NO_SEEN;
  if (current.picked) return current.seen;
  const seen = new Set(current.seen);
  seen.delete(current.problem.id);
  return seen;
}

function pick(pool: Problem[], attempts: Attempt[], order: QuizOrder, exclude: string | null, seen: ReadonlySet<string>): Current | null {
  const next = pickNext(pool, cardStates(pool, attempts), { exclude, order, seen });
  if (!next) return null;
  return {
    problem: next.problem,
    reason: next.reason,
    choices: shuffle(offeredAnswers(next.problem)),
    picked: null,
    nextIn: null,
    seen: markSeen(seen, pool, next.problem.id),
  };
}

const REASON: Record<PickReason, { text: string; className: string; title: string }> = {
  again: { text: "Again", className: "bg-red-100 text-red-800", title: "You got this one wrong last time" },
  review: { text: "Review", className: "bg-amber-100 text-amber-800", title: "Scheduled review" },
  new: { text: "New", className: "bg-blue-100 text-blue-800", title: "Never attempted" },
  ahead: { text: "Ahead of schedule", className: "bg-stone-100 text-stone-600", title: "Not due yet; shown before its review date" },
};

/** Rendered client-only (see QuizLoader), so lazy state initialisers may shuffle and read storage. */
export default function Quiz({ problems }: { problems: Problem[] }) {
  const [filters, setFilters] = useState<Filters>(() => loadFilters());
  const [order, setOrder] = useState<QuizOrder>(() => loadOrder());
  const [attempts, setAttempts] = useState<Attempt[]>(() => loadAttempts());
  const [current, setCurrent] = useState<Current | null>(() => {
    const saved = loadAttempts();
    return pick(applyFilters(problems, loadFilters(), attemptedIds(saved)), saved, loadOrder(), null, NO_SEEN);
  });
  const [count, setCount] = useState(1);
  /** Explanations and translations generated in this session, keyed by problem id (the store has them for next time). */
  const [generated, setGenerated] = useState<Record<string, ExplanationPatch>>({});

  const attempted = useMemo(() => attemptedIds(attempts), [attempts]);
  const untried = useMemo(() => problems.filter((p) => !attempted.has(p.id)).length, [problems, attempted]);
  const pool = useMemo(() => applyFilters(problems, filters, attempted), [problems, filters, attempted]);
  const due = useMemo(() => dueCount(pool, cardStates(pool, attempts)), [pool, attempts]);
  const stats = useMemo(() => computeStats(attempts), [attempts]);
  const problem = useMemo(() => (current ? { ...current.problem, ...generated[current.problem.id] } : undefined), [current, generated]);
  const position = useMemo(() => (problem ? parseXgid(problem.xgid) : null), [problem]);

  const changeFilters = useCallback(
    (f: Filters) => {
      saveFilters(f);
      setFilters(f);
      const nextPool = applyFilters(problems, f, attempted);
      if (!current || current.picked || !nextPool.some((p) => p.id === current.problem.id)) {
        setCurrent(pick(nextPool, attempts, order, null, dealtBefore(current)));
      }
    },
    [problems, current, attempts, attempted, order],
  );

  /** A new order applies at once: an unanswered problem is replaced by the new order's pick. */
  const changeOrder = useCallback(
    (o: QuizOrder) => {
      saveOrder(o);
      setOrder(o);
      if (!current || !current.picked) setCurrent(pick(pool, attempts, o, null, dealtBefore(current)));
    },
    [pool, current, attempts],
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
    setCurrent(pick(pool, attempts, order, current?.problem.id ?? null, current?.seen ?? NO_SEEN));
    setCount((c) => c + 1);
  }, [pool, attempts, order, current]);

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
    <FilterPanel
      filters={filters}
      onChange={changeFilters}
      order={order}
      onOrderChange={changeOrder}
      problems={problems}
      untried={untried}
      matching={pool.length}
      due={due}
    />
  );

  if (problems.length === 0) {
    return <div className="p-8 text-stone-600">No problems found in data/. Add a problem set and reload.</div>;
  }

  if (!current || !problem || !position) {
    const withTried = { ...filters, progress: "all" as const };
    const allTried = filters.progress === "untried" && applyFilters(problems, withTried).length > 0;
    return (
      <div className="mx-auto max-w-7xl p-4">
        {filterPanel}
        <div className="mt-6 rounded-lg border border-stone-200 bg-white p-6 text-stone-600" data-empty>
          {allTried ? (
            <>
              You have tried every problem that matches these filters.{" "}
              <button type="button" className="text-blue-700 underline" onClick={() => changeFilters(withTried)}>
                Show the ones you tried
              </button>
            </>
          ) : (
            <>
              No problems match these filters.{" "}
              <button type="button" className="text-blue-700 underline" onClick={() => changeFilters(DEFAULT_FILTERS)}>
                Reset filters
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const reason = REASON[current.reason];

  return (
    <div className="mx-auto max-w-7xl p-4">
      {filterPanel}
      <ProblemCard
        problem={problem}
        position={position}
        choices={current.choices}
        picked={current.picked}
        onChoose={choose}
        onGenerated={(id, patch) => setGenerated((g) => ({ ...g, [id]: { ...g[id], ...patch } }))}
        badges={
          <>
            <span>Problem {count}</span>
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${reason.className}`} title={reason.title} data-reason={current.reason}>
              {reason.text}
            </span>
          </>
        }
        verdictNote={
          current.nextIn && (
            <span className="ml-2 text-sm font-normal opacity-80" data-next-in>
              Comes back in {current.nextIn}.
            </span>
          )
        }
        next={
          <button
            type="button"
            onClick={next}
            className="rounded-lg bg-blue-600 px-4 py-3 text-lg font-medium text-white shadow hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            Next problem
          </button>
        }
        below={
          <SessionStats
            stats={stats}
            onReset={() => {
              clearAttempts();
              setAttempts([]);
            }}
          />
        }
      />
    </div>
  );
}
