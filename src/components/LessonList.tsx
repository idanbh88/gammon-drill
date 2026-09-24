"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { clearLessonLog, loadLessonLog, setProgress, type LessonLog, type SetProgress } from "@/lib/lesson-progress";
import { groupByCollection, type LessonSetSummary } from "@/lib/lessons";

function progressText(p: SetProgress): string {
  if (p.answered === 0) return "not started";
  if (!p.finished) return `${p.answered}/${p.total} answered · ${p.correct} right`;
  return `${p.correct}/${p.total} right` + (p.wrong ? ` · ${p.wrong} to retry` : "") + (p.fixed ? ` · ${p.fixed} fixed` : "");
}

function ProgressBar({ p }: { p: SetProgress }) {
  if (p.total === 0) return null;
  const pct = (n: number) => `${(100 * n) / p.total}%`;
  return (
    <div className="mt-1 flex h-1.5 w-32 overflow-hidden rounded bg-stone-200" aria-hidden>
      <div className="bg-green-600" style={{ width: pct(p.correct) }} />
      <div className="bg-amber-400" style={{ width: pct(p.fixed) }} />
      <div className="bg-red-500" style={{ width: pct(p.wrong) }} />
    </div>
  );
}

/** The imported sets by collection, with this browser's progress in each. Client-only (see
 * LessonListLoader): progress lives in localStorage. */
export default function LessonList({ sets }: { sets: LessonSetSummary[] }) {
  const [log, setLog] = useState<LessonLog>(() => loadLessonLog());
  const groups = useMemo(() => groupByCollection(sets), [sets]);

  if (sets.length === 0) {
    return (
      <p className="text-stone-600">
        No lessons imported yet. Choose Galaxy quiz exports above, or run{" "}
        <code className="rounded bg-stone-200 px-1">uv run import_lessons.py &quot;C:\path\to\*.json&quot;</code> in <code>pipeline/</code>.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <section key={g.collection ?? "none"} aria-label={g.collection ?? "Other lessons"}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
            {g.collection ?? "Other"} <span className="font-normal normal-case text-stone-400">({g.sets.length})</span>
          </h2>
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm" data-lessons={g.collection ?? "none"}>
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">Lesson</th>
                  <th className="px-3 py-2">Author</th>
                  <th className="px-3 py-2">Problems</th>
                  <th className="px-3 py-2">Analysis</th>
                  <th className="px-3 py-2">Your progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {g.sets.map((s) => {
                  const total = s.problemIds.length;
                  const p = setProgress(log, s.key, s.problemIds);
                  return (
                    <tr key={s.key} className="hover:bg-blue-50">
                      <td className="px-3 py-2">
                        <Link href={`/lessons/${s.key}`} className="text-blue-700 underline">
                          {s.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-stone-600">{s.author ?? "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {total}{" "}
                        <span className="text-stone-400">
                          ({[s.checker && `${s.checker} checker`, s.cube && `${s.cube} cube`].filter(Boolean).join(", ")})
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {s.withAnalysis === total ? "yes" : s.withAnalysis === 0 ? <span className="text-stone-400">none</span> : `${s.withAnalysis} of ${total}`}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" data-progress={s.key}>
                        {progressText(p)}
                        <ProgressBar p={p} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Forget your answers in every lesson?")) setLog(clearLessonLog());
          }}
          className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-100"
        >
          Reset all lesson progress
        </button>
      </div>
    </div>
  );
}
