import { lossClass } from "@/lib/matches";
import type { Answer } from "@/types/problem";

function fmtEquity(n: number): string {
  return (n < 0 ? "\u2212" : "+") + Math.abs(n).toFixed(3);
}

export default function AnswerReveal({
  answers,
  pickedId,
  offeredIds,
  gameId,
}: {
  /** Ranked best-first. */
  answers: Answer[];
  pickedId: string | null;
  /** Answers that were shown as buttons; the rest are listed muted. */
  offeredIds: string[];
  /** For one of the user's own mistakes: what they played in the game. */
  gameId?: string;
}) {
  return (
    <ol className="divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 bg-white" aria-label="Ranked answers">
      {answers.map((a, i) => {
        const mine = a.id === pickedId;
        const offered = offeredIds.includes(a.id);
        return (
          <li
            key={a.id}
            className={`grid grid-cols-[2rem_1fr_auto_auto] items-center gap-3 px-3 py-2 ${
              mine ? "bg-blue-50" : ""
            } ${offered ? "" : "text-stone-400"}`}
            data-answer-id={a.id}
          >
            <span className="text-stone-400">{i + 1}.</span>
            <span className="font-mono">
              {a.label}
              {i === 0 && <span className="ml-2 text-xs font-sans text-green-700">best</span>}
              {mine && <span className="ml-2 rounded bg-blue-600 px-1.5 py-0.5 text-xs font-sans text-white">your pick</span>}
              {a.id === gameId && <span className="ml-2 rounded bg-amber-500 px-1.5 py-0.5 text-xs font-sans text-white">in your game</span>}
            </span>
            <span className="font-mono text-sm text-stone-500" title="equity">
              {fmtEquity(a.equity)}
            </span>
            <span className={`w-16 text-right font-mono text-sm ${lossClass(a.equityLoss)}`} title="equity loss">
              {a.equityLoss === 0 ? "\u2014" : "\u2212" + a.equityLoss.toFixed(3)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
