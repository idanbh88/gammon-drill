"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { currentIndex, initialPlayer, playerReducer } from "@/lib/lesson-player";
import {
  loadLessonLog,
  mistakeIndexes,
  recordAttempt,
  recordRunStart,
  setProgress,
  type LessonLog,
  type ProblemStatus,
} from "@/lib/lesson-progress";
import { choiceTone, correctChoice, kindLabel, promptText, type LessonChoice, type LessonImage, type LessonSet } from "@/lib/lessons";

const STATUS: Record<"correct" | "wrong" | "fixed" | "none", { className: string; title: string }> = {
  correct: { className: "bg-green-600 text-white", title: "right the first time" },
  wrong: { className: "bg-red-600 text-white", title: "wrong" },
  fixed: { className: "bg-amber-400 text-stone-900", title: "wrong, then right in a retry" },
  none: { className: "border border-stone-300 bg-white text-stone-600", title: "not answered yet" },
};

const statusKey = (s: ProblemStatus) => s ?? "none";

/** A lesson picture at its own size; a placeholder when the file is missing on disk. */
function Picture({ image, alt }: { image: LessonImage | null; alt: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!image || failed === image.src) {
    return (
      <div className="flex aspect-[2280/1732] items-center justify-center rounded-lg border border-dashed border-stone-300 bg-white p-6 text-center text-stone-500">
        Picture missing. Import the set again (&ldquo;Import again&rdquo; on the lessons page) to download it.
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served from data/lessons by a route handler at its own size; nothing to optimise
    <img
      src={image.src}
      alt={alt}
      width={image.width || undefined}
      height={image.height || undefined}
      className="h-auto w-full rounded-lg border border-stone-200 bg-white"
      onError={() => setFailed(image.src)}
    />
  );
}

/** One lesson set, played in order. Rendered client-only (see LessonLoader): it starts from
 * the progress in localStorage. */
export default function Lesson({ set }: { set: LessonSet }) {
  const [log, setLog] = useState<LessonLog>(() => loadLessonLog());
  const [player, dispatch] = useReducer(playerReducer, undefined, () =>
    initialPlayer(setProgress(loadLessonLog(), set.key, set.problemIds).statuses),
  );
  const progress = useMemo(() => setProgress(log, set.key, set.problemIds), [log, set]);

  const index = currentIndex(player);
  const problem = index === null ? null : set.problems[index];
  const reviewing = player.review !== null;
  const picked = index === null ? null : reviewing ? progress.picks[index] : player.picked;
  const canAnswer = problem !== null && !reviewing && player.mode !== "summary" && player.picked === null;
  const mono = problem?.kind === "checker" ? "font-mono" : "";

  const answer = useCallback(
    (c: LessonChoice) => {
      if (!canAnswer || !problem) return;
      setLog(
        recordAttempt(log, {
          setKey: set.key,
          problemId: problem.id,
          choiceId: c.id,
          correct: c.correct,
          loss: c.loss,
          retry: player.mode === "retry",
          at: new Date().toISOString(),
        }),
      );
      dispatch({ type: "answer", choiceId: c.id, view: c.image ? c.id : null });
    },
    [canAnswer, problem, log, set.key, player.mode],
  );

  const startOver = useCallback(() => {
    setLog(recordRunStart(log, set.key, new Date().toISOString()));
    dispatch({ type: "restart", total: set.problems.length });
  }, [log, set.key, set.problems.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // A focused button handles Space and Enter itself; form controls keep every key.
      if (e.target instanceof HTMLElement && e.target.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
      if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || !problem) return;
      const n = Number(e.key);
      const choice = Number.isInteger(n) && n >= 1 ? problem.choices[n - 1] : undefined;
      if (canAnswer) {
        if (choice) {
          answer(choice);
          e.preventDefault();
        }
      } else if (choice) {
        if (choice.image) dispatch({ type: "show", choiceId: choice.id });
        e.preventDefault();
      } else if (e.key === "0" || e.key === "Escape") {
        dispatch({ type: "show", choiceId: null });
        e.preventDefault();
      } else if (e.key === "Enter" || e.key.toLowerCase() === "n") {
        dispatch({ type: "next" });
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [problem, canAnswer, answer]);

  const mistakes = mistakeIndexes(progress);

  const header = (
    <header>
      <Link href="/lessons" className="text-sm text-blue-700 underline">
        All lessons
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">{set.name}</h1>
      <p className="text-sm text-stone-500" data-summary>
        {[set.author, set.collection, `${set.problems.length} problems`].filter(Boolean).join(" · ")}
        {progress.answered > 0 && ` · this run: ${progress.correct} of ${progress.answered} right`}
        {progress.fixed > 0 && `, ${progress.fixed} fixed`}
      </p>
      <ol className="mt-3 flex flex-wrap gap-1" aria-label="Problems">
        {set.problems.map((p, i) => {
          const key = statusKey(progress.statuses[i]);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => dispatch({ type: "open", index: i, answered: progress.statuses[i] !== null })}
                aria-current={i === index ? "step" : undefined}
                title={`Problem ${p.number}: ${STATUS[key].title}`}
                data-status={key}
                className={`h-7 w-7 rounded text-xs font-medium ${STATUS[key].className} ${i === index ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
              >
                {p.number}
              </button>
            </li>
          );
        })}
      </ol>
    </header>
  );

  if (!problem) {
    const missed = set.problems.filter((_, i) => progress.statuses[i] === "wrong" || progress.statuses[i] === "fixed");
    return (
      <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
        {header}
        <section className="rounded-lg border border-stone-200 bg-white p-6" aria-label="Summary" data-lesson-summary>
          <h2 className="text-xl font-semibold">{progress.finished ? "Lesson finished" : "Summary"}</h2>
          <p className="mt-1 text-lg">
            {progress.correct} of {progress.total} right the first time
            {progress.fixed > 0 && `, ${progress.fixed} more fixed in a retry`}.
          </p>
          {missed.length > 0 && (
            <>
              <h3 className="mt-4 text-sm font-semibold uppercase tracking-wide text-stone-500">Mistakes</h3>
              <ul className="mt-1 flex flex-wrap gap-2">
                {missed.map((p) => {
                  const i = set.problems.indexOf(p);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => dispatch({ type: "open", index: i, answered: true })}
                        className="rounded border border-stone-300 px-2 py-1 text-sm hover:bg-stone-100"
                      >
                        Problem {p.number}
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
            <button
              type="button"
              onClick={startOver}
              className="rounded-lg border border-stone-300 bg-white px-4 py-2 font-medium hover:bg-stone-100"
            >
              Start over
            </button>
            <Link href="/lessons" className="rounded-lg border border-stone-300 bg-white px-4 py-2 font-medium hover:bg-stone-100">
              All lessons
            </Link>
          </div>
        </section>
      </div>
    );
  }

  const best = correctChoice(problem);
  const mine = problem.choices.find((c) => c.id === picked) ?? null;
  const shown = problem.choices.find((c) => c.id === player.view && c.image) ?? null;
  const withPictures = problem.choices.some((c) => c.image);
  const last = !reviewing && player.queue.length === 1;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
      {header}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="Position">
          <Picture
            image={shown ? shown.image : problem.image}
            alt={shown ? `Problem ${problem.number} after ${shown.answer}` : `Problem ${problem.number}`}
          />
          <p className="mt-2 flex flex-wrap items-center gap-3 text-sm text-stone-500">
            {shown ? (
              <>
                <span>
                  After <span className={mono}>{shown.answer}</span>
                </span>
                <button type="button" onClick={() => dispatch({ type: "show", choiceId: null })} className="text-blue-700 underline">
                  Show the position
                </button>
              </>
            ) : (
              <span>
                The position
                {picked !== null && withPictures ? ". Use Show next to a play to see it made." : ""}
              </span>
            )}
          </p>
        </section>

        <section className="flex flex-col gap-4" aria-label="Question">
          <header>
            <div className="text-sm text-stone-500">
              Problem {problem.number} of {set.problems.length} · {kindLabel(problem.kind)}
              {player.mode === "retry" && !reviewing && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">retry</span>}
              {reviewing && <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-800">review</span>}
            </div>
            <h2 className="mt-1 text-2xl font-semibold">{promptText(problem.kind)}</h2>
          </header>

          {picked === null ? (
            <ol className="grid gap-2" aria-label="Choices">
              {problem.choices.map((c, i) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={!canAnswer}
                    onClick={() => answer(c)}
                    className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-left text-lg shadow-sm transition hover:border-blue-500 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60"
                  >
                    <span className="mr-3 inline-block w-5 text-stone-400">{i + 1}</span>
                    <span className={mono}>{c.answer}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <>
              <div
                className={`rounded-lg px-4 py-3 text-lg font-medium ${mine?.correct ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
                role="status"
              >
                {mine?.correct ? (
                  "Correct."
                ) : (
                  <>
                    Not the best. Best: <span className={mono}>{best.answer}</span>
                  </>
                )}
                {reviewing && <span className="ml-2 text-sm font-normal opacity-80">Your answer in this run.</span>}
              </div>
              <ol className="divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 bg-white" aria-label="Choices with Galaxy's equities">
                {problem.choices.map((c, i) => (
                  <li
                    key={c.id}
                    className={`grid items-center gap-3 px-3 py-2 ${withPictures ? "grid-cols-[2rem_1fr_auto_4rem]" : "grid-cols-[2rem_1fr_auto]"} ${c.id === picked ? "bg-blue-50" : ""}`}
                    data-choice-id={c.id}
                  >
                    <span className="text-stone-400">{i + 1}.</span>
                    <span>
                      <span className={mono}>{c.answer}</span>
                      {c.correct && <span className="ml-2 whitespace-nowrap text-xs text-green-700">best</span>}
                      {c.id === picked && <span className="ml-2 whitespace-nowrap rounded bg-blue-600 px-1.5 py-0.5 text-xs text-white">your pick</span>}
                    </span>
                    <span className={`font-mono text-sm ${choiceTone(c)}`} title="Galaxy's equity: the best choice's own, the others' difference to it">
                      {c.description ?? "—"}
                    </span>
                    {withPictures &&
                      (c.image ? (
                        <button
                          type="button"
                          aria-pressed={player.view === c.id}
                          onClick={() => dispatch({ type: "show", choiceId: player.view === c.id ? null : c.id })}
                          className={`rounded border px-2 py-1 text-xs ${player.view === c.id ? "border-stone-800 bg-stone-800 text-white" : "border-stone-300 text-stone-600 hover:bg-stone-100"}`}
                        >
                          {player.view === c.id ? "Shown" : "Show"}
                        </button>
                      ) : (
                        <span />
                      ))}
                  </li>
                ))}
              </ol>
              <div className="rounded-lg border border-stone-200 bg-white p-4">
                <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-500">
                  Analysis{set.author ? ` · ${set.author}` : ""}
                </h3>
                <p className="whitespace-pre-line text-stone-800" data-analysis>
                  {problem.analysis ?? <span className="italic text-stone-400">No analysis for this problem.</span>}
                </p>
              </div>
              <button
                type="button"
                onClick={() => dispatch({ type: "next" })}
                className="rounded-lg bg-blue-600 px-4 py-3 text-lg font-medium text-white shadow hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                {reviewing ? "Back" : last ? "Finish" : "Next problem"}
              </button>
            </>
          )}

          <p className="text-sm text-stone-500">
            Keys: 1–{problem.choices.length} pick an answer; after answering they show that play, 0 or Esc the position; Enter or N moves on.
          </p>
        </section>
      </div>
    </div>
  );
}
