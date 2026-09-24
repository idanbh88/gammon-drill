"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { parseEvent, postNdjson, type ImportEvent } from "@/lib/ndjson";

function describe(ev: ImportEvent): string {
  const s = (k: string) => String(ev[k] ?? "");
  switch (ev.event) {
    case "saved":
      return `Saved as data/matches/${s("file")}.`;
    case "start":
      return `Reading ${s("file")}…`;
    case "parsed": {
      const players = Array.isArray(ev.players) ? (ev.players as string[]) : [];
      const length = Number(ev.match_length) > 0 ? `${s("match_length")}-point match` : "money session";
      return `${players.join(" vs ")}, ${length}, ${s("games")} game(s): ${s("to_evaluate")} decisions to evaluate (${s("positions")} positions).`;
    }
    case "gnubg":
    case "log":
      return s("message");
    case "warning":
      return `Warning (${s("decision")}): ${s("message")}`;
    case "skipped":
      return `Skipped: ${s("reason")}`;
    case "done":
      return (
        `Done: ${s("decisions")} decisions evaluated, ${s("errors")} errors (${s("blunders")} blunders), total loss ${Number(ev.totalLoss).toFixed(3)}` +
        (Number(ev.unscored) > 0 ? `, ${s("unscored")} not scored` : "") +
        (ev.replaced ? " (replaced the previous analysis)" : "") +
        "."
      );
    case "error":
      return `Error: ${s("message")}`;
    case "exit":
      return "";
    default:
      return JSON.stringify(ev);
  }
}

/**
 * Upload a Backgammon Galaxy .mat export. The route runs the Python importer and streams its
 * progress; when it finishes the page is refreshed so the new match appears in the list.
 */
export default function UploadMatch() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function handleLine(line: string) {
    const ev = parseEvent(line);
    const text = ev ? describe(ev) : line; // not an event: show as is
    if (ev?.event === "error") setError(String(ev.message ?? "import failed"));
    if (text) setLines((l) => [...l, text]);
  }

  async function importOne(file: File) {
    const form = new FormData();
    form.append("file", file);
    if (replace) form.append("replace", "1");
    await postNdjson("/api/matches/import", form, handleLine);
  }

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    setLines([]);
    try {
      for (const file of Array.from(files)) await importOne(file);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4" aria-label="Import a match">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Import a match</h2>
      <p className="mt-1 text-sm text-stone-600">
        Upload a Backgammon Galaxy export (<code>.mat</code>). You must be Player 1 in the file (the left column); your checker plays
        and cube decisions are evaluated by GNU Backgammon at 2-ply, which takes about a second per decision.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        <input
          ref={input}
          type="file"
          accept=".mat,text/plain"
          multiple
          disabled={busy}
          onChange={(e) => void upload(e.target.files)}
          className="text-stone-700 file:mr-3 file:rounded file:border-0 file:bg-stone-800 file:px-3 file:py-1.5 file:font-medium file:text-white hover:file:bg-stone-700 disabled:opacity-50"
          aria-label="Match file"
        />
        <label className="flex items-center gap-2 text-stone-600">
          <input type="checkbox" checked={replace} disabled={busy} onChange={(e) => setReplace(e.target.checked)} />
          Analyse again if already imported
        </label>
        {busy && <span className="text-stone-400">Importing…</span>}
      </div>
      {lines.length > 0 && (
        <ol className="mt-3 space-y-0.5 font-mono text-xs text-stone-600" aria-label="Import progress" data-import-log>
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      )}
      {error && (
        <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
