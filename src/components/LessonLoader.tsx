"use client";

import dynamic from "next/dynamic";
import type { LessonSet } from "@/lib/lessons";

// The player starts from the progress in localStorage, so it is rendered on the client only.
const Lesson = dynamic(() => import("./Lesson"), {
  ssr: false,
  loading: () => <div className="p-8 text-stone-500">Loading the lesson…</div>,
});

export default function LessonLoader({ set }: { set: LessonSet }) {
  return <Lesson set={set} />;
}
