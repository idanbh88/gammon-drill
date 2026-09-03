import Link from "next/link";
import Board from "@/components/Board";
import { pipCounts, questionText, scoreCaption } from "@/lib/board";
import { loadProblems } from "@/lib/problems";
import { parseXgid, type Position } from "@/lib/xgid";

/**
 * Board viewer. `/board?xgid=...` renders one position (any XGID, with or without the
 * "XGID=" prefix); `/board` renders every problem in data/ as a gallery.
 */

function tryParse(raw: string): { pos: Position } | { error: string } {
  try {
    return { pos: parseXgid(raw) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function SinglePosition({ raw }: { raw: string }) {
  const parsed = tryParse(raw);
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-3 p-4">
      <Link href="/board" className="text-sm text-blue-700 underline">
        All problems
      </Link>
      <code className="break-all text-xs text-stone-500">{raw}</code>
      {"error" in parsed ? (
        <p className="rounded bg-red-100 p-3 text-red-800">{parsed.error}</p>
      ) : (
        <>
          <h1 className="text-xl font-semibold">{questionText(parsed.pos)}</h1>
          <p className="text-sm text-stone-500">
            {scoreCaption(parsed.pos)} · pips player 1 {pipCounts(parsed.pos)[0]}, player 2{" "}
            {pipCounts(parsed.pos)[1]}
          </p>
          <Board position={parsed.pos} />
        </>
      )}
    </main>
  );
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ xgid?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.xgid) ? params.xgid[0] : params.xgid;
  if (raw) return <SinglePosition raw={raw} />;

  const problems = await loadProblems();
  return (
    <main className="mx-auto max-w-7xl p-4">
      <h1 className="mb-1 text-xl font-semibold">All problems</h1>
      <p className="mb-4 text-sm text-stone-500">
        Add <code>?xgid=…</code> to the URL to render any position.{" "}
        <Link href="/" className="text-blue-700 underline">
          Back to the quiz
        </Link>
        .
      </p>
      <div className="grid gap-6 md:grid-cols-2">
        {problems.map((p) => {
          const pos = parseXgid(p.xgid);
          return (
            <section key={p.id} className="rounded-lg border border-stone-200 bg-white p-3">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="font-semibold">
                  <Link href={`/board?xgid=${encodeURIComponent(p.xgid)}`} className="hover:underline">
                    {p.id}
                  </Link>{" "}
                  <span className="font-normal text-stone-500">· {questionText(pos)}</span>
                </h2>
                <span className="text-xs text-stone-500">{p.categories.join(", ")}</span>
              </div>
              <Board position={pos} />
              <p className="mt-2 text-xs text-stone-500">
                best: <span className="font-mono">{p.answers[0].label}</span>
              </p>
            </section>
          );
        })}
      </div>
    </main>
  );
}
