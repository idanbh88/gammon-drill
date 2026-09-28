import Link from "next/link";
import RobertieProgressLoader from "@/components/RobertieProgressLoader";
import { formatLoss } from "@/lib/matches";
import { DATA_DIR } from "@/lib/problems";
import { AGREEMENT_CLASS, AGREEMENT_LABEL, AGREEMENTS } from "@/lib/robertie";
import { hasRobertieStore, readRobertieChapters, readRobertieChecks, readRobertieDisagreements } from "@/lib/robertie-store";

/** Robertie's "501 Essential Backgammon Problems": the chapters, the board readings and where
 * gnubg disagrees with the book. Reads data/robertie/robertie.sqlite on every request. */
export const dynamic = "force-dynamic";

export default function RobertiePage() {
  if (!hasRobertieStore(DATA_DIR)) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-3 p-4">
        <h1 className="text-xl font-semibold">Robertie 501</h1>
        <p className="text-stone-600">
          The book is not imported yet. From <code>pipeline/</code> in PowerShell, run{" "}
          <code>uv run import_robertie.py &quot;&lt;the scan&gt;.pdf&quot; --spend --batch</code>. Everything read from the book stays in{" "}
          <code>data/robertie/</code>, which is not in git.
        </p>
      </main>
    );
  }
  const chapters = readRobertieChapters(DATA_DIR);
  const checks = readRobertieChecks(DATA_DIR);
  const disagreements = readRobertieDisagreements(DATA_DIR);
  const playable = chapters.reduce((n, c) => n + c.playable, 0);
  const marks = Object.fromEntries(AGREEMENTS.map((a) => [a, chapters.reduce((n, c) => n + c.marks[a], 0)])) as Record<(typeof AGREEMENTS)[number], number>;
  const byStatus = { ok: 0, fixed: 0, check: 0 };
  for (const c of checks) byStatus[c.status]++;
  const reported = checks.filter((c) => c.reported).length;
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-5 p-4">
      <div>
        <h1 className="text-xl font-semibold">Robertie 501</h1>
        <p className="text-sm text-stone-600">
          Bill Robertie&rsquo;s <i>501 Essential Backgammon Problems</i>, read from your scan: {checks.length} problems in {chapters.length} chapters,{" "}
          {playable} ready to play. gnubg judges every answer; the book&rsquo;s answer is always one of the choices and is marked after you
          answer. The problems are also in the main quiz (source &ldquo;Robertie 501&rdquo;). Everything from the book stays on this machine (
          <code>data/robertie/</code>, not in git).
        </p>
      </div>

      <section aria-label="Agreement" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-stone-500">gnubg on the book&rsquo;s {playable} answers:</span>
        {AGREEMENTS.map((a) => (
          <span key={a} className={`rounded px-2 py-0.5 ${AGREEMENT_CLASS[a]}`} data-mark={a}>
            {AGREEMENT_LABEL[a]}: {marks[a]}
          </span>
        ))}
      </section>

      <RobertieProgressLoader chapters={chapters} />

      <section aria-label="Board readings" className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
        <h2 className="font-semibold">Board readings</h2>
        <p className="mt-1 text-stone-600">
          Every diagram was read twice (the local reader and Claude) and checked (15 checkers a side, the book&rsquo;s play legal):{" "}
          {byStatus.ok} agree, {byStatus.fixed} fixed by hand, {byStatus.check} still to check{reported > 0 && `, ${reported} reported as wrong`}.{" "}
          <Link href="/robertie/check" className="text-blue-700 underline">
            Check the readings
          </Link>
        </p>
      </section>

      <details aria-label="Where gnubg disagrees" className="rounded-lg border border-stone-200 bg-white">
        <summary className="cursor-pointer border-b border-stone-100 px-4 py-3 font-semibold">
          Where gnubg disagrees with the book{" "}
          <span className="font-normal text-stone-500">({disagreements.length}, loss 0.02 or more, largest first; shows the answers)</span>
        </summary>
        {disagreements.length === 0 ? (
          <p className="px-4 py-3 text-sm text-stone-500">None yet.</p>
        ) : (
          <ol className="divide-y divide-stone-100 text-sm" data-disagreements>
            {disagreements.map((d) => (
              <li key={d.number} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <Link href={`/robertie/chapter/${d.chapter}?n=${d.number}`} className="w-28 font-medium text-blue-700 underline">
                  Problem {d.number}
                </Link>
                <span className="w-52 text-stone-500">{d.chapterTitle}</span>
                <span>
                  Robertie <span className="font-mono">{d.book}</span>, gnubg <span className="font-mono">{d.best}</span>
                </span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${AGREEMENT_CLASS[d.agreement]}`}>
                  {formatLoss(d.loss)} ({d.plies}-ply)
                </span>
              </li>
            ))}
          </ol>
        )}
      </details>
    </main>
  );
}
