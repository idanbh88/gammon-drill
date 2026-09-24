"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { questionText } from "@/lib/board";
import { formatLoss, formatPlayedAt, groupByGame, matchResult, summarize, type MatchDecision } from "@/lib/matches";
import type { PlayerRating } from "@/lib/pr";
import type { GameRow, MatchRow } from "@/lib/store";
import { parseXgid } from "@/lib/xgid";
import type { ExplanationPatch } from "@/types/problem";
import AnswerReveal from "./AnswerReveal";
import Board from "./Board";
import { QuizToggle } from "./DecisionFeedback";
import ExplanationPanel from "./ExplanationPanel";

const LEVEL: Record<MatchDecision["level"], { text: string; className: string }> = {
  ok: { text: "", className: "" },
  error: { text: "error", className: "bg-amber-100 text-amber-800" },
  blunder: { text: "blunder", className: "bg-red-100 text-red-800" },
};

function prText(r: PlayerRating): string {
  if (r.pr === null) return "no counted decisions";
  const parts = [`PR ${r.pr.toFixed(1)} (${r.rating})`];
  if (r.checkerPr !== null) parts.push(`checker ${r.checkerPr.toFixed(1)}`);
  if (r.cubePr !== null) parts.push(`cube ${r.cubePr.toFixed(1)}`);
  return `${parts.join(" · ")} over ${r.decisions} decisions`;
}

function PlayedLine({ d, who }: { d: MatchDecision; who: string }) {
  if (d.forced) {
    return (
      <p className="text-stone-500">
        {d.kind === "checker" && d.playedText === "no legal move" ? "No legal move." : `Forced: ${d.playedText}.`}
      </p>
    );
  }
  if (!d.played) {
    return (
      <p className="text-stone-500">
        {who} played <span className="font-mono">{d.playedText}</span>; the engine did not score it.
      </p>
    );
  }
  return (
    <p className="text-lg">
      {who} played <span className="font-mono">{d.played.label}</span>
      {d.played.loss === 0 ? (
        <span className="ml-2 text-green-700">the best play</span>
      ) : (
        <span className="ml-2 font-mono text-red-700" title="equity loss">
          {formatLoss(d.played.loss)}
        </span>
      )}
      {d.played.loss > 0 && (
        <>
          <span className="text-stone-400"> · best </span>
          <span className="font-mono">{d.problem.answers[0]?.label}</span>
        </>
      )}
    </p>
  );
}

/**
 * One match, game by game: every error with the board, what was played, the engine's ranking and
 * an explanation on demand. Matches played against gnubg also carry gnubg's decisions, shown on
 * request.
 */
export default function MatchReview({
  match,
  games,
  decisions,
  ratings,
}: {
  match: MatchRow;
  games: GameRow[];
  decisions: MatchDecision[];
  /** PR for [the user, the opponent]. */
  ratings?: [PlayerRating, PlayerRating] | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const [side, setSide] = useState<"you" | "them">("you");
  /** Explanations and translations generated in this session, keyed by decision id (the store has them for next time). */
  const [generated, setGenerated] = useState<Record<string, ExplanationPatch>>({});

  const user = match.analysedPlayer;
  const mine = useMemo(() => decisions.filter((d) => d.player === user), [decisions, user]);
  const theirs = useMemo(() => decisions.filter((d) => d.player !== user), [decisions, user]);
  const list = side === "you" ? mine : theirs;
  const summary = useMemo(() => summarize(mine), [mine]);
  const result = useMemo(() => matchResult(match, games), [match, games]);
  const shown = useMemo(() => (showAll ? list : list.filter((d) => d.level !== "ok")), [list, showAll]);
  const byGame = useMemo(() => groupByGame(shown), [shown]);
  const gameInfo = useMemo(() => new Map(games.map((g) => [g.number, g])), [games]);
  const vsGnubg = match.site === "gnubg";
  const you = vsGnubg ? "You" : match.analysedPlayer === 1 ? match.player1 : match.player2;
  const them = match.analysedPlayer === 1 ? match.player2 : match.player1;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <Link href={vsGnubg ? "/play" : "/matches"} className="text-sm text-blue-700 underline">
          {vsGnubg ? "Play" : "All matches"}
        </Link>
        {vsGnubg && (
          <>
            {" · "}
            <Link href={`/play/${match.id}`} className="text-sm text-blue-700 underline">
              Back to the game
            </Link>
          </>
        )}
        <h1 className="mt-1 text-2xl font-semibold">
          {you} <span className="font-normal text-stone-500">vs</span> {them}
        </h1>
        <p className="text-sm text-stone-500">
          {match.matchLength > 0 ? `${match.matchLength}-point match` : "Money session"} · {formatPlayedAt(match.playedAt) || "date unknown"} ·{" "}
          {vsGnubg ? "played here" : `${match.site} #${match.siteMatchId}`} · score {result.score1}–{result.score2}
          {result.winner && (result.winner === match.analysedPlayer ? ", you won" : ", you lost")} · gnubg {match.plies}-ply
        </p>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" data-summary>
          <span>
            <strong>{summary.decisions}</strong> decisions evaluated
          </span>
          <span>
            <strong>{summary.errors}</strong> errors
          </span>
          <span>
            <strong>{summary.blunders}</strong> blunders
          </span>
          <span>
            total loss <strong className="font-mono">{summary.totalLoss.toFixed(3)}</strong>
          </span>
          {summary.unscored > 0 && <span>{summary.unscored} not scored</span>}
          <span className="text-stone-400">{summary.forced} forced or no move</span>
        </p>
        {ratings && (
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm" data-pr>
            <span>
              <strong>{you}</strong>: {prText(ratings[0])}
            </span>
            {theirs.length > 0 && (
              <span className="text-stone-500">
                <strong>{them}</strong>: {prText(ratings[1])}
                {vsGnubg && " (gnubg is graded by its own analysis)"}
              </span>
            )}
          </p>
        )}
      </header>

      <div className="flex flex-wrap gap-2 text-sm" role="group" aria-label="Which decisions to show">
        {theirs.length > 0 &&
          (["you", "them"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              aria-pressed={side === s}
              className={`rounded border px-3 py-1 ${side === s ? "border-blue-700 bg-blue-700 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"}`}
            >
              {s === "you" ? you : them}
            </button>
          ))}
        {[
          { all: false, text: `Errors (${list.filter((d) => d.level !== "ok").length})` },
          { all: true, text: `All decisions (${list.length})` },
        ].map((o) => (
          <button
            key={String(o.all)}
            type="button"
            onClick={() => setShowAll(o.all)}
            aria-pressed={showAll === o.all}
            className={`rounded border px-3 py-1 ${showAll === o.all ? "border-stone-800 bg-stone-800 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"}`}
          >
            {o.text}
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="rounded-lg border border-stone-200 bg-white p-6 text-stone-600">
          {list.length === 0 ? "No decisions were recorded for this match." : "No errors in this match. Switch to all decisions to see every move."}
        </p>
      )}

      {[...byGame.entries()].map(([number, list]) => {
        const g = gameInfo.get(number);
        return (
          <section key={number} aria-label={`Game ${number}`} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">
              Game {number}
              {g && (
                <span className="ml-2 text-sm font-normal text-stone-500">
                  score {g.score1}–{g.score2}
                  {g.crawford && " · Crawford"}
                  {g.winner && ` · ${g.winner === match.analysedPlayer ? "you" : them} won ${g.points ?? "?"} point${g.points === 1 ? "" : "s"}`}
                </span>
              )}
            </h2>
            {list.map((d) => {
              const problem = { ...d.problem, ...generated[d.problem.id] };
              const pos = parseXgid(problem.xgid);
              const level = LEVEL[d.level];
              return (
                <article
                  key={problem.id}
                  className="grid gap-4 rounded-lg border border-stone-200 bg-white p-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
                  data-decision={problem.id}
                  data-level={d.level}
                >
                  <div>
                    <Board position={pos} />
                  </div>
                  <div className="flex flex-col gap-3">
                    <header>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-stone-500">
                        <span>Move {d.move}</span>
                        {level.text && <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${level.className}`}>{level.text}</span>}
                        {problem.categories.length > 0 && (
                          <>
                            <span>·</span>
                            <span>{problem.categories.join(", ")}</span>
                          </>
                        )}
                        <span>·</span>
                        <Link href={`/board?xgid=${encodeURIComponent(problem.xgid)}`} className="text-blue-700 underline">
                          board
                        </Link>
                      </div>
                      <h3 className="mt-1 text-xl font-semibold">{questionText(pos)}</h3>
                    </header>
                    <PlayedLine d={d} who={d.player === user ? you : them} />
                    {!d.forced && problem.answers.length > 0 && (
                      <AnswerReveal answers={problem.answers} pickedId={d.played?.id ?? null} offeredIds={problem.answers.map((a) => a.id)} />
                    )}
                    {d.player === user && d.played && problem.answers.length >= 2 && <QuizToggle decisionId={problem.id} initial={d.inQuiz ?? false} />}
                    {!d.forced && problem.answers.length >= 2 && (
                      <ExplanationPanel
                        key={problem.id}
                        problem={problem}
                        onGenerated={(id, patch) => setGenerated((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))}
                      />
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
