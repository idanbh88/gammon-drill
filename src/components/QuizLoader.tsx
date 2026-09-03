"use client";

import dynamic from "next/dynamic";
import type { Problem } from "@/types/problem";

// The quiz shuffles and reads localStorage, so it is rendered on the client only.
const Quiz = dynamic(() => import("./Quiz"), {
  ssr: false,
  loading: () => <div className="p-8 text-stone-500">Loading problems…</div>,
});

export default function QuizLoader({ problems }: { problems: Problem[] }) {
  return <Quiz problems={problems} />;
}
