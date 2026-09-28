import { notFound } from "next/navigation";
import RobertieChapterLoader from "@/components/RobertieChapterLoader";
import { DATA_DIR } from "@/lib/problems";
import { readRobertieChapter } from "@/lib/robertie-store";

/** One chapter of Robertie's book, played in book order; ?n=<number> opens one problem. */
export const dynamic = "force-dynamic";

export default async function RobertieChapterPage({ params, searchParams }: { params: Promise<{ n: string }>; searchParams: Promise<{ n?: string | string[] }> }) {
  const { n } = await params;
  const chapter = /^\d{1,2}$/.test(n) ? Number(n) : NaN;
  const found = Number.isInteger(chapter) ? readRobertieChapter(DATA_DIR, chapter) : null;
  if (!found) notFound();
  const open = (await searchParams).n;
  const openNumber = typeof open === "string" && /^\d{1,3}$/.test(open) ? Number(open) : null;
  return <RobertieChapterLoader summary={found.summary} problems={found.problems} openNumber={openNumber} />;
}
