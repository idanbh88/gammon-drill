import { notFound } from "next/navigation";
import MatchReview from "@/components/MatchReview";
import { toMatchDecision } from "@/lib/matches";
import { inQuiz } from "@/lib/mistakes";
import { DATA_DIR } from "@/lib/problems";
import { readLatestExplanations, readMatch, readMatchRatings, storePath, withReadOnlyFile, MAIN_SCHEMA, readQuizPicks } from "@/lib/store";

/** One match (imported, or played against gnubg): the user's errors, or every decision, with explanations on demand. */
export const dynamic = "force-dynamic";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  const data = Number.isInteger(n) && n > 0 ? readMatch(DATA_DIR, n) : null;
  if (!data) notFound();
  const explanations = readLatestExplanations(DATA_DIR);
  const picks = withReadOnlyFile(storePath(DATA_DIR), MAIN_SCHEMA, new Map<string, boolean>(), readQuizPicks);
  const user = data.match.analysedPlayer;
  const decisions = data.decisions.map((row) => ({ ...toMatchDecision(row, explanations), inQuiz: row.player === user ? inQuiz(row, user, picks) : undefined }));
  const ratings = readMatchRatings(DATA_DIR).get(n) ?? null;
  return (
    <main className="mx-auto max-w-7xl p-4">
      <MatchReview match={data.match} games={data.games} decisions={decisions} ratings={ratings} />
    </main>
  );
}
