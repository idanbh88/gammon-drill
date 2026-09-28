import Link from "next/link";
import Board from "@/components/Board";
import RobertieReportButton from "@/components/RobertieReportButton";
import { pipCounts } from "@/lib/board";
import { DATA_DIR } from "@/lib/problems";
import { robertieImageSrc, type BoardCheck } from "@/lib/robertie";
import { readRobertieChecks } from "@/lib/robertie-store";
import { parseXgid } from "@/lib/xgid";

/**
 * The board readings of Robertie's book, each scan beside the board the app built from it. By
 * default only the ones that need a look (readings that differ or fail a check, and boards
 * reported as wrong); ?show=all lists every one, ?chapter=N one chapter, ?mirror=1 flips the
 * scans (the book puts Black's home board bottom left, the app bottom right).
 */
export const dynamic = "force-dynamic";

const STATUS: Record<BoardCheck["status"], { text: string; className: string }> = {
  ok: { text: "readings agree", className: "bg-green-100 text-green-800" },
  fixed: { text: "fixed by hand", className: "bg-blue-100 text-blue-800" },
  check: { text: "needs a look", className: "bg-amber-100 text-amber-900" },
};

function tryParse(xgid: string): { pos: ReturnType<typeof parseXgid> } | { error: string } {
  try {
    return { pos: parseXgid(xgid) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function Position({ xgid }: { xgid: string }) {
  const parsed = tryParse(xgid);
  if ("error" in parsed) return <p className="text-sm text-red-700">Bad XGID: {parsed.error}</p>;
  const [blue, white] = pipCounts(parsed.pos);
  return (
    <div>
      <Board position={parsed.pos} />
      <p className="mt-1 text-xs text-stone-500">
        Pips: Blue (the book&rsquo;s Black) {blue}, White {white} · <span className="font-mono break-all">{xgid}</span>
      </p>
    </div>
  );
}

export default async function RobertieCheckPage({ searchParams }: { searchParams: Promise<{ show?: string; chapter?: string; mirror?: string }> }) {
  const q = await searchParams;
  const all = readRobertieChecks(DATA_DIR);
  const chapter = q.chapter && /^\d{1,2}$/.test(q.chapter) ? Number(q.chapter) : null;
  const mirror = q.mirror === "1";
  let shown = chapter !== null ? all.filter((c) => c.chapter === chapter) : all;
  if (q.show !== "all") shown = shown.filter((c) => c.status === "check" || c.reported);
  const link = (over: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const merged = { show: q.show ?? null, chapter: chapter === null ? null : String(chapter), mirror: mirror ? "1" : null, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `/robertie/check?${s}` : "/robertie/check";
  };
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
      <div>
        <Link href="/robertie" className="text-sm text-blue-700 underline">
          Robertie 501
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Board readings</h1>
        <p className="text-sm text-stone-600">
          {shown.length} of {all.length} shown.{" "}
          {q.show === "all" ? (
            <Link href={link({ show: null })} className="text-blue-700 underline">
              Only the ones that need a look
            </Link>
          ) : (
            <Link href={link({ show: "all" })} className="text-blue-700 underline">
              Show every reading
            </Link>
          )}
          {" · "}
          <Link href={link({ mirror: mirror ? null : "1" })} className="text-blue-700 underline">
            {mirror ? "Scans as printed" : "Mirror the scans"}
          </Link>{" "}
          (the book draws Black&rsquo;s home board bottom left, the app bottom right). A board fixed by hand goes into{" "}
          <code>data/robertie/fixes.json</code> and is read again by the importer.
        </p>
      </div>
      {shown.length === 0 && <p className="rounded-lg border border-stone-200 bg-white p-6 text-stone-600">Nothing needs a look.</p>}
      <ol className="flex flex-col gap-4">
        {shown.map((c) => (
          <li key={c.number} className="rounded-lg border border-stone-200 bg-white p-4" data-check={c.number}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-semibold">Problem {c.number}</span>
              <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS[c.status].className}`}>{STATUS[c.status].text}</span>
              {c.reported && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">reported as wrong</span>}
              <span className="text-stone-600">{c.caption}</span>
              {c.chapter !== null && (
                <Link href={link({ chapter: String(c.chapter) })} className="text-stone-500 underline">
                  chapter {c.chapter}
                </Link>
              )}
              {c.page && (
                <a href={robertieImageSrc("page", c.page)} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                  page {c.page}
                </a>
              )}
              <span className="ml-auto">
                <RobertieReportButton number={c.number} reported={c.reported} />
              </span>
            </div>
            {c.fixNote && <p className="mt-1 text-xs text-blue-800">Fix: {c.fixNote}</p>}
            {c.issues.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm text-amber-900">
                {c.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            )}
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {c.diagram ? (
                // eslint-disable-next-line @next/next/no-img-element -- a scan served from data/robertie by a route handler; nothing to optimise
                <img src={robertieImageSrc("diagram", c.diagram)} alt={`The book's diagram of problem ${c.number}`} className={`h-auto w-full rounded border border-stone-200 ${mirror ? "-scale-x-100" : ""}`} loading="lazy" />
              ) : (
                <p className="text-sm text-stone-500">No diagram was found on the page.</p>
              )}
              {c.xgid ? <Position xgid={c.xgid} /> : <p className="text-sm text-stone-500">No position yet: the readings differ or failed a check.</p>}
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
