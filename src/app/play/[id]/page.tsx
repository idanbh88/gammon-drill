import { notFound } from "next/navigation";
import PlayLoader from "@/components/PlayLoader";
import { playView, PlayError, type PlayView } from "@/lib/play-service";
import { warmUp } from "@/lib/play-server";
import { withPlayTables } from "@/lib/play-store";
import { DATA_DIR } from "@/lib/problems";

/** One match against gnubg. The page loads it as it stands; the component talks to /api/play/<id>. */
export const dynamic = "force-dynamic";

export default async function PlayMatchPage({ params }: { params: Promise<{ id: string }> }) {
  const n = Number((await params).id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const view = withPlayTables<PlayView | null>(DATA_DIR, null, (db) => {
    try {
      return playView(db, n);
    } catch (e) {
      if (e instanceof PlayError) return null;
      throw e;
    }
  });
  if (!view) notFound();
  if (view.status === "playing") warmUp();
  return (
    <main>
      <PlayLoader initial={view} />
    </main>
  );
}
