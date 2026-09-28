"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AGREEMENT_CLASS, AGREEMENT_LABEL, AGREEMENTS, chapterProgress, loadRuns, type ChapterSummary } from "@/lib/robertie";
import { loadAttempts } from "@/lib/storage";

/** The book's chapters with what is ready to play, how gnubg rates the book's answers and where
 * this browser stands in each chapter's current run. */
export default function RobertieChapters({ chapters }: { chapters: ChapterSummary[] }) {
  const [attempts] = useState(() => loadAttempts());
  const [runs] = useState(() => loadRuns());
  const progress = useMemo(
    () => new Map(chapters.map((c) => [c.number, chapterProgress(attempts, c.ids, runs.runs[String(c.number)] ?? null)])),
    [chapters, attempts, runs],
  );
  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
      <table className="w-full text-sm" data-chapters>
        <thead className="bg-stone-50 text-left text-stone-500">
          <tr>
            <th className="px-3 py-2 font-medium">Chapter</th>
            <th className="px-3 py-2 font-medium">Problems</th>
            <th className="px-3 py-2 font-medium">Checker / cube</th>
            <th className="px-3 py-2 font-medium" title="How gnubg rates the book's answer: agrees, small difference (under 0.02), disagrees (0.02 to 0.08), strongly (0.08 or more)">
              gnubg on the book
            </th>
            <th className="px-3 py-2 font-medium">This run</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {chapters.map((c) => {
            const p = progress.get(c.number)!;
            return (
              <tr key={c.number} data-chapter={c.number}>
                <td className="px-3 py-2">
                  <Link href={`/robertie/chapter/${c.number}`} className="font-medium text-blue-700 underline">
                    {c.number}. {c.title}
                  </Link>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-stone-600">
                  {c.firstProblem}–{c.lastProblem}
                  {c.waiting > 0 && <span className="ml-1 text-amber-700" title="boards still to check">({c.waiting} waiting)</span>}
                </td>
                <td className="px-3 py-2 text-stone-600">
                  {c.checker} / {c.cube}
                </td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {AGREEMENTS.filter((a) => c.marks[a] > 0).map((a) => (
                      <span key={a} className={`rounded px-1.5 py-0.5 text-xs ${AGREEMENT_CLASS[a]}`} title={AGREEMENT_LABEL[a]}>
                        {c.marks[a]} {a === "same" ? "agree" : a === "close" ? "small" : a === "differs" ? "differ" : "strong"}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-stone-600">
                  {p.answered === 0 ? "—" : `${p.correct} of ${p.answered} right${p.fixed ? `, ${p.fixed} fixed` : ""}`}
                  {c.playable > 0 && ` · ${p.answered}/${c.playable}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
