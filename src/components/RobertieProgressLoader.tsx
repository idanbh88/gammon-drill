"use client";

import dynamic from "next/dynamic";
import type { ChapterSummary } from "@/lib/robertie";

// Progress comes from localStorage, so the list is rendered on the client only.
const RobertieChapters = dynamic(() => import("./RobertieChapters"), {
  ssr: false,
  loading: () => <div className="p-4 text-stone-500">Loading the chapters…</div>,
});

export default function RobertieProgressLoader({ chapters }: { chapters: ChapterSummary[] }) {
  return <RobertieChapters chapters={chapters} />;
}
