"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PlayEvent } from "@/lib/play-service";
import { stashStartEvents } from "@/lib/play-settings";

const LENGTHS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 21, 25];

/** Start a match against gnubg (POST /api/play) and open it. */
export default function NewMatchForm() {
  const router = useRouter();
  const [length, setLength] = useState(5);
  const [jacoby, setJacoby] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/play", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchLength: length, jacoby }),
      });
      const data = (await res.json().catch(() => ({}))) as { matchId?: number; error?: string; events?: PlayEvent[] };
      if (!res.ok || !data.matchId) throw new Error(data.error ?? `HTTP ${res.status}`);
      // The game page replays the opening (gnubg may already have moved).
      stashStartEvents(data.matchId, data.events ?? []);
      router.push(`/play/${data.matchId}`);
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <form onSubmit={start} className="flex flex-wrap items-end gap-3 rounded-lg border border-stone-200 bg-white p-4" aria-label="New match">
      <label className="flex flex-col text-sm">
        <span className="text-stone-600">Length</span>
        <select value={length} onChange={(e) => setLength(Number(e.target.value))} className="rounded border border-stone-300 bg-white px-2 py-1">
          {LENGTHS.map((n) => (
            <option key={n} value={n}>
              {n}-point match
            </option>
          ))}
          <option value={0}>Money session</option>
        </select>
      </label>
      {length === 0 && (
        <label className="flex items-center gap-2 pb-1 text-sm">
          <input type="checkbox" checked={jacoby} onChange={(e) => setJacoby(e.target.checked)} />
          Jacoby rule
        </label>
      )}
      <button type="submit" disabled={pending} className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white shadow hover:bg-blue-700 disabled:opacity-50">
        {pending ? "Starting…" : "Play gnubg"}
      </button>
      {error && (
        <p className="w-full text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
