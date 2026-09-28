"use client";

import type { ReactNode } from "react";
import type { Answer, ExplanationPatch, Problem } from "@/types/problem";
import { questionText } from "@/lib/board";
import { difficultyBand } from "@/lib/filters";
import { formatLoss, formatPlayedAt } from "@/lib/matches";
import { difficulty } from "@/lib/problem-utils";
import { AGREEMENT_CLASS, AGREEMENT_LABEL, bookVerdict } from "@/lib/robertie";
import type { Position } from "@/lib/xgid";
import AnswerReveal from "./AnswerReveal";
import Board from "./Board";
import { QuizToggle } from "./DecisionFeedback";
import ExplanationPanel from "./ExplanationPanel";
import RobertieCard from "./RobertieCard";

/**
 * One problem on screen: the board, the question, the answer buttons and, once answered, the
 * verdict, gnubg's ranking, where the problem came from (the user's game, Robertie's book) and
 * the explanation panel. Shared by the quiz (which picks problems) and the chapter player of
 * Robertie's book (which walks a chapter in book order); both own the state and the keys.
 */
export default function ProblemCard({
  problem,
  position,
  choices,
  picked,
  onChoose,
  onGenerated,
  badges,
  verdictNote,
  next,
  below,
  keysHint = "Keys: 1–4 pick an answer, Enter or N for the next problem.",
}: {
  problem: Problem;
  position: Position;
  /** The answers offered as buttons, in display order. */
  choices: Answer[];
  picked: string | null;
  onChoose: (a: Answer) => void;
  onGenerated: (id: string, patch: ExplanationPatch) => void;
  /** Chips at the start of the header line (the quiz's count and why the problem came up). */
  badges?: ReactNode;
  /** After the verdict (when the problem comes back). */
  verdictNote?: ReactNode;
  /** The button that moves on, shown after answering. */
  next: ReactNode;
  /** Under the question column (session stats). */
  below?: ReactNode;
  keysHint?: string;
}) {
  const best = problem.answers[0];
  const isCorrect = picked === best.id;
  const book = problem.book;
  const bookLine = picked ? bookVerdict(problem, picked) : null;
  return (
    <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section aria-label="Board">
        <Board position={position} />
      </section>

      <section className="flex flex-col gap-4" aria-label="Question">
        <header>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-stone-500">
            {badges}
            {problem.origin && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900" data-origin={problem.origin.site}>
                My mistake
              </span>
            )}
            {book && (
              <span className="rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-900" data-book={book.number} title={`Chapter ${book.chapter}: ${book.chapterTitle}`}>
                Robertie #{book.number} · {book.chapterTitle}
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

        {!picked ? (
          <ol className="grid gap-2" aria-label="Answers">
            {choices.map((a, i) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onChoose(a)}
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
            <div className={`rounded-lg px-4 py-3 text-lg font-medium ${isCorrect ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`} role="status">
              {isCorrect ? (
                "Correct."
              ) : (
                <>
                  Not the best play. Best: <span className="font-mono">{best.label}</span>
                </>
              )}
              {verdictNote}
              {bookLine && (
                <span className="mt-1 block text-base font-normal" data-book-verdict>
                  {bookLine}{" "}
                  <span className={`ml-1 rounded px-1.5 py-0.5 text-xs font-medium ${AGREEMENT_CLASS[book!.agreement]}`} data-agreement={book!.agreement}>
                    {AGREEMENT_LABEL[book!.agreement]}
                  </span>
                </span>
              )}
            </div>
            <AnswerReveal answers={problem.answers} pickedId={picked} offeredIds={choices.map((c) => c.id)} gameId={problem.origin?.played} bookId={book?.answerId} />
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
            {book && <RobertieCard key={`book-${problem.id}`} problem={problem} />}
            <ExplanationPanel key={problem.id} problem={problem} onGenerated={onGenerated} />
            {next}
          </>
        )}

        {below}

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
              {book && (
                <>
                  {" · "}
                  <a href={`/robertie/chapter/${book.chapter}?n=${book.number}`} className="text-blue-700 underline">
                    chapter {book.chapter}
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
          <p className="mt-2">{keysHint}</p>
        </details>
      </section>
    </div>
  );
}
