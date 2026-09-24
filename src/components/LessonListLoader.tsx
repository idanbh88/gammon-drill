"use client";

import dynamic from "next/dynamic";
import type { LessonSetSummary } from "@/lib/lessons";

// Progress comes from localStorage, so the list is rendered on the client only.
const LessonList = dynamic(() => import("./LessonList"), {
  ssr: false,
  loading: () => <div className="p-4 text-stone-500">Loading lessons…</div>,
});

export default function LessonListLoader({ sets }: { sets: LessonSetSummary[] }) {
  return <LessonList sets={sets} />;
}
