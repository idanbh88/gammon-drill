import Link from "next/link";
import UploadMatch from "@/components/UploadMatch";
import { formatPlayedAt, matchResult, THRESHOLDS } from "@/lib/matches";
import { DATA_DIR } from "@/lib/problems";
import { readMatches, readMatchRatings } from "@/lib/store";

/** Imported matches and matches played against gnubg, with the user's errors and PR, and the upload form. Reads the store on every request. */
export const dynamic = "force-dynamic";

export default async function MatchesPage() {
  const { matches, summaries, games } = readMatches(DATA_DIR, THRESHOLDS);
  const ratings = readMatchRatings(DATA_DIR);
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Matches</h1>
      <UploadMatch />
      {matches.length === 0 ? (
        <p className="text-stone-600">No matches imported yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm" data-matches>
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Played</th>
                <th className="px-3 py-2">Opponent</th>
                <th className="px-3 py-2">Length</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2 text-right">Decisions</th>
                <th className="px-3 py-2 text-right">Errors</th>
                <th className="px-3 py-2 text-right">Blunders</th>
                <th className="px-3 py-2 text-right">Total loss</th>
                <th className="px-3 py-2 text-right">PR</th>
                <th className="px-3 py-2 text-right">Ply</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {matches.map((m) => {
                const s = summaries.get(m.id);
                const pr = ratings.get(m.id)?.[0].pr ?? null;
                const r = matchResult(m, games.get(m.id) ?? []);
                const you = m.analysedPlayer === 1 ? m.player1 : m.player2;
                const them = m.analysedPlayer === 1 ? m.player2 : m.player1;
                const outcome = r.winner ? (r.winner === m.analysedPlayer ? "won" : "lost") : "";
                return (
                  <tr key={m.id} className="hover:bg-blue-50">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link href={`/matches/${m.id}`} className="text-blue-700 underline">
                        {formatPlayedAt(m.playedAt) || m.fileName}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {m.site === "gnubg" ? (
                        <>
                          gnubg <span className="text-stone-400">(played here)</span>
                        </>
                      ) : (
                        <>
                          {them} <span className="text-stone-400">(you: {you})</span>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2">{m.matchLength > 0 ? `${m.matchLength} pt` : "money"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.score1}–{r.score2} {outcome}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{s?.decisions ?? 0}</td>
                    <td className="px-3 py-2 text-right font-mono">{s?.errors ?? 0}</td>
                    <td className="px-3 py-2 text-right font-mono">{s?.blunders ?? 0}</td>
                    <td className="px-3 py-2 text-right font-mono">{(s?.totalLoss ?? 0).toFixed(3)}</td>
                    <td className="px-3 py-2 text-right font-mono">{pr === null ? "—" : pr.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right font-mono">{m.plies}</td>
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
