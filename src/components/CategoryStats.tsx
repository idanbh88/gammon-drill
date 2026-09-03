"use client";

import { useMemo, useState } from "react";
import type { Problem } from "@/types/problem";
import { cardStates, categoryStats, dueCount } from "@/lib/scheduler";
import { clearAttempts, computeStats, loadAttempts, type Attempt } from "@/lib/storage";

function pct(correct: number, total: number): string {
  return total ? `${Math.round((100 * correct) / total)}%` : "—";
}

export default function CategoryStats({ problems }: { problems: Problem[] }) {
  const [attempts, setAttempts] = useState<Attempt[]>(() => loadAttempts());
  const overall = useMemo(() => computeStats(attempts), [attempts]);
  const rows = useMemo(() => categoryStats(problems, attempts), [problems, attempts]);
  const due = useMemo(() => dueCount(problems, cardStates(problems, attempts)), [problems, attempts]);
  const byId = useMemo(() => new Map(problems.map((p) => [p.id, p])), [problems]);
  const mistakes = useMemo(
    () =>
      attempts
        .filter((a) => !a.correct && byId.has(a.problemId))
        .slice(-10)
        .reverse(),
    [attempts, byId],
  );

  return (
    <div className="mx-auto max-w-4xl p-4">
      <h1 className="text-2xl font-semibold">Progress</h1>
      <p className="mt-1 text-sm text-stone-500" data-overall>
        {problems.length} problems · {due} due now · {overall.answered} attempts · {pct(overall.correct, overall.answered)} correct · avg
        equity loss {overall.avgLoss.toFixed(3)}
      </p>

      <h2 className="mt-6 text-lg font-semibold">By category</h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm" aria-label="Per-category accuracy">
          <thead className="bg-stone-50 text-left text-stone-500">
            <tr>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 text-right font-medium">Problems</th>
              <th className="px-3 py-2 text-right font-medium">Due</th>
              <th className="px-3 py-2 text-right font-medium">Attempts</th>
              <th className="px-3 py-2 text-right font-medium">Accuracy</th>
              <th className="px-3 py-2 text-right font-medium">Avg loss</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.category} className="border-t border-stone-100" data-category={r.category}>
                <td className="px-3 py-2">{r.category}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.total}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.due}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.attempts}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(r.correct, r.attempts)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{r.attempts ? r.avgLoss.toFixed(3) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-6 text-lg font-semibold">Recent mistakes</h2>
      {mistakes.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">None yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white text-sm" aria-label="Recent mistakes">
          {mistakes.map((a, i) => {
            const p = byId.get(a.problemId)!;
            return (
              <li key={`${a.at}-${i}`} className="flex flex-wrap items-center gap-x-3 px-3 py-2">
                <span className="font-mono">{p.id}</span>
                <span className="text-stone-500">{p.categories.join(", ")}</span>
                <span>
                  played <span className="font-mono">{a.answerId}</span>, best <span className="font-mono">{p.answers[0].label}</span>
                </span>
                <span className="ml-auto font-mono text-red-700">−{a.equityLoss.toFixed(3)}</span>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        className="mt-6 rounded border border-stone-300 px-3 py-1 text-sm text-stone-600 hover:bg-stone-100"
        onClick={() => {
          clearAttempts();
          setAttempts([]);
        }}
      >
        Reset all progress
      </button>
    </div>
  );
}
