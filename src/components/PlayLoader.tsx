"use client";

import dynamic from "next/dynamic";
import type { PlayView } from "@/lib/play-service";

// The game reads its animation speed and the opening's events from browser storage, so it is rendered on the client only.
const PlayGame = dynamic(() => import("./PlayGame"), {
  ssr: false,
  loading: () => <div className="p-8 text-stone-500">Setting up the board…</div>,
});

export default function PlayLoader({ initial }: { initial: PlayView }) {
  return <PlayGame initial={initial} />;
}
