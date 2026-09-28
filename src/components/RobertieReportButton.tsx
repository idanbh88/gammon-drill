"use client";

import { useState } from "react";

/** "Reading looks wrong": records that a board of the book seems misread; the problem leaves the
 * quiz until it is fixed (data/robertie/fixes.json) and imported again. */
export default function RobertieReportButton({ number, reported }: { number: number; reported: boolean }) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">(reported ? "done" : "idle");
  if (state === "done") return <span className="text-xs text-amber-800">Reported: out of the quiz until fixed.</span>;
  async function send() {
    setState("sending");
    const res = await fetch("/api/robertie/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number }) }).catch(() => null);
    setState(res?.ok ? "done" : "error");
  }
  return (
    <button type="button" onClick={send} disabled={state === "sending"} className="rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100 disabled:opacity-60">
      {state === "error" ? "Could not save: try again" : "Reading looks wrong"}
    </button>
  );
}
