import Link from "next/link";
import NewMatchForm from "@/components/NewMatchForm";
import { scoreAfter } from "@/lib/game";
import { formatPlayedAt } from "@/lib/matches";
import { readPlays } from "@/lib/play-store";
import { warmUp } from "@/lib/play-server";
import { DATA_DIR } from "@/lib/problems";
import { readMatchRatings } from "@/lib/store";

/** Start a match against gnubg, or go back to one. Reads the store on every request. */
export const dynamic = "force-dynamic";

export default async function PlayPage() {
  warmUp();
  const plays = readPlays(DATA_DIR);
  const ratings = readMatchRatings(DATA_DIR);
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Play gnubg</h1>
      <p className="max-w-3xl text-sm text-stone-600">
        gnubg plays at 2-ply and always makes its best move, with the cube. After each of your decisions it shows how much equity you lost
        and its ranking; every error of 0.02 or more goes into your quiz. PR is 500 × the equity lost per counted decision.
      </p>
      <NewMatchForm />
      {plays.length === 0 ? (
        <p className="text-stone-600">No matches against gnubg yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm" data-plays>
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Last played</th>
                <th className="px-3 py-2">Length</th>
                <th className="px-3 py-2">Score</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2 text-right">Your PR</th>
                <th className="px-3 py-2 text-right">Errors</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {plays.map((p) => {
                const score = scoreAfter(p.state);
                const r = ratings.get(p.matchId)?.[0];
                const ph = p.state.phase;
                const state =
                  p.status === "finished"
                    ? ph.kind === "game-over" && ph.matchOver
                      ? ph.winner === 1
                        ? "you won"
                        : "gnubg won"
                      : "finished"
                    : `game ${p.state.game}`;
                return (
                  <tr key={p.matchId} className="hover:bg-blue-50">
                    <td className="px-3 py-2 whitespace-nowrap">{formatPlayedAt(p.updatedAt)}</td>
                    <td className="px-3 py-2">{p.settings.matchLength > 0 ? `${p.settings.matchLength} pt` : "money"}</td>
                    <td className="px-3 py-2 font-mono">
                      {score[0]}–{score[1]}
                    </td>
                    <td className="px-3 py-2">{state}</td>
                    <td className="px-3 py-2 text-right font-mono">{r?.pr == null ? "—" : r.pr.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right font-mono">{r?.errors ?? 0}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {p.status === "playing" ? (
                        <Link href={`/play/${p.matchId}`} className="text-blue-700 underline">
                          Resume
                        </Link>
                      ) : (
                        <Link href={`/play/${p.matchId}`} className="text-blue-700 underline">
                          Open
                        </Link>
                      )}{" "}
                      ·{" "}
                      <Link href={`/matches/${p.matchId}`} className="text-blue-700 underline">
                        Review
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
