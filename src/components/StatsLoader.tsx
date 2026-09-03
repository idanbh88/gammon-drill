"use client";

import dynamic from "next/dynamic";
import type { Problem } from "@/types/problem";

// Reads localStorage, so it is rendered on the client only.
const CategoryStats = dynamic(() => import("./CategoryStats"), {
  ssr: false,
  loading: () => <div className="p-8 text-stone-500">Loading stats…</div>,
});

export default function StatsLoader({ problems }: { problems: Problem[] }) {
  return <CategoryStats problems={problems} />;
}
