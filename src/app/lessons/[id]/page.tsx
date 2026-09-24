import { notFound } from "next/navigation";
import LessonLoader from "@/components/LessonLoader";
import { readLessonSet } from "@/lib/lesson-store";
import { DATA_DIR } from "@/lib/problems";

/** One lesson set (the id is its Galaxy quiz id). Reads the lesson database on every request. */
export const dynamic = "force-dynamic";

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const set = readLessonSet(DATA_DIR, id);
  if (!set) notFound();
  return <LessonLoader set={set} />;
}
