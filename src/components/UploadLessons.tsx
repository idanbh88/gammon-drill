"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { parseEvent, postNdjson, type ImportEvent } from "@/lib/ndjson";

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function describe(ev: ImportEvent): string {
  const s = (k: string) => String(ev[k] ?? "");
  const n = (k: string) => Number(ev[k] ?? 0);
  switch (ev.event) {
    case "start":
      return `${s("file")}: reading…`;
    case "parsed":
      return (
        `${s("name")}${ev.author ? ` by ${s("author")}` : ""}: ${count(n("problems"), "problem")} ` +
        `(${n("checker")} checker, ${n("cube")} cube), ${count(n("images"), "picture")}.`
      );
    case "warning":
      return `Note: problem ${s("problem")}, choice ${s("choice")}: ${s("message")}.`;
    case "images":
      return `Pictures: ${n("done")} of ${n("total")} (${n("downloaded")} downloaded).`;
    case "skipped":
      return n("missing_images") > 0
        ? `Already imported; ${count(n("missing_images"), "picture")} missing. Tick "Import again" to download them.`
        : "Already imported.";
    case "done":
      return (
        `Done: ${count(n("problems"), "problem")}, ${count(n("images"), "picture")} (${n("downloaded")} downloaded)` +
        (ev.replaced ? ", replacing the earlier import" : "") +
        "."
      );
    case "log":
      return s("message");
    case "error":
      return `Error: ${s("message")}`;
    case "exit":
      return "";
    default:
      return JSON.stringify(ev);
  }
}

interface Line {
  key: string;
  text: string;
}

/**
 * Import Backgammon Galaxy quiz exports (.json). The route runs the Python importer, which
 * downloads every picture; the progress is streamed, and the page refreshes at the end so the
 * new sets appear.
 */
export default function UploadLessons() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);

  /** Add a line, or update the one with the same key (the running picture count). */
  function put(key: string, text: string) {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.key === key);
      if (i < 0) return [...prev, { key, text }];
      const next = prev.slice();
      next[i] = { key, text };
      return next;
    });
  }

  function handleLine(file: string, line: string) {
    const ev = parseEvent(line);
    if (ev?.event === "error") setError(String(ev.message ?? "import failed"));
    const text = ev ? describe(ev) : line;
    if (text) put(ev?.event === "images" ? `${file}/images` : `${file}/${seq.current++}`, text);
  }

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    setLines([]);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      if (replace) form.append("replace", "1");
      try {
        await postNdjson("/api/lessons/import", form, (line) => handleLine(file.name, line));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        put(`${file.name}/${seq.current++}`, message.startsWith(file.name) ? message : `${file.name}: ${message}`);
      }
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4" aria-label="Import lessons">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Import lessons</h2>
      <p className="mt-1 text-sm text-stone-600">
        Upload Backgammon Galaxy quiz exports (<code>.json</code>, several at once). Every picture is downloaded, so the lessons
        work offline. A name like <code>Medium - Lesson 1.json</code> files the set under &ldquo;Medium&rdquo;.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          multiple
          disabled={busy}
          onChange={(e) => void upload(e.target.files)}
          className="text-stone-700 file:mr-3 file:rounded file:border-0 file:bg-stone-800 file:px-3 file:py-1.5 file:font-medium file:text-white hover:file:bg-stone-700 disabled:opacity-50"
          aria-label="Quiz export files"
        />
        <label className="flex items-center gap-2 text-stone-600">
          <input type="checkbox" checked={replace} disabled={busy} onChange={(e) => setReplace(e.target.checked)} />
          Import again if already imported (only missing or changed pictures are downloaded)
        </label>
        {busy && <span className="text-stone-400">Importing…</span>}
      </div>
      {lines.length > 0 && (
        <ol className="mt-3 max-h-64 space-y-0.5 overflow-y-auto font-mono text-xs text-stone-600" aria-label="Import progress" data-import-log>
          {lines.map((l) => (
            <li key={l.key}>{l.text}</li>
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
