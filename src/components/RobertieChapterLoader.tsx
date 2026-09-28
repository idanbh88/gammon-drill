"use client";

import dynamic from "next/dynamic";
import type { Problem } from "@/types/problem";
import type { ChapterSummary } from "@/lib/robertie";

// The player starts from the attempts in localStorage, so it is rendered on the client only.
const RobertieChapter = dynamic(() => import("./RobertieChapter"), {
  ssr: false,
  loading: () => <div className="p-8 text-stone-500">Loading the chapter…</div>,
});

export default function RobertieChapterLoader(props: { summary: ChapterSummary; problems: Problem[]; openNumber: number | null }) {
  return <RobertieChapter {...props} />;
}
