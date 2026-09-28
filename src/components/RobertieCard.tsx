"use client";

import { useEffect, useState } from "react";
import type { Problem } from "@/types/problem";
import { robertieImageSrc, type BookText } from "@/lib/robertie";
import HebrewText from "./HebrewText";

type Loaded = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; text: BookText };

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

/**
 * Robertie's analysis under a book problem's answer reveal: his text as printed (English), the
 * scans of the page and the diagram, and a Hebrew translation made only when asked (stored in the
 * book's own database, like everything from the book). The text is fetched when the card appears
 * after answering, so the quiz does not carry 500 solutions around. In the book Black is the
 * player on roll: Blue here.
 */
export default function RobertieCard({ problem }: { problem: Problem }) {
  const book = problem.book!;
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getJson<BookText>(`/api/robertie/text/${book.number}`)
      .then((text) => live && setLoaded({ state: "ready", text }))
      .catch((e: Error) => live && setLoaded({ state: "error", message: e.message }));
    return () => {
      live = false;
    };
  }, [book.number]);

  async function translate() {
    setTranslating(true);
    setTranslateError(null);
    try {
      const data = await getJson<{ translation: BookText["translation"] }>("/api/robertie/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ number: book.number }),
      });
      setLoaded((l) => (l.state === "ready" ? { state: "ready", text: { ...l.text, translation: data.translation } } : l));
    } catch (e) {
      setTranslateError((e as Error).message);
    } finally {
      setTranslating(false);
    }
  }

  const text = loaded.state === "ready" ? loaded.text : null;
  return (
    <section className="rounded-lg border border-violet-200 bg-violet-50/40 px-4 py-3" aria-label="Robertie's analysis" data-robertie-card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-violet-900">
          Robertie&apos;s analysis · problem {book.number} · {book.chapterTitle}
        </h2>
        <span className="text-xs text-stone-500">In the book Black is on roll: Blue here.</span>
      </div>
      {loaded.state === "loading" && <p className="mt-2 text-sm text-stone-500">Loading…</p>}
      {loaded.state === "error" && <p className="mt-2 text-sm text-red-700">Could not load the text: {loaded.message}</p>}
      {text && (
        <>
          {text.translation && (
            <div className="mt-2 border-b border-violet-100 pb-3" data-robertie-lang="he">
              <HebrewText text={text.translation.text} />
              <p className="mt-1 text-xs text-stone-500">
                Translation · {text.translation.model} · {text.translation.generatedAt}
              </p>
            </div>
          )}
          {text.text ? (
            <p className="mt-2 whitespace-pre-line text-stone-800" data-robertie-lang="en">
              {text.text}
            </p>
          ) : (
            <p className="mt-2 text-sm text-stone-600">The scan of this solution could not be read into text: see the book page.</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {text.pages.map((pg) => (
              <a key={pg} href={robertieImageSrc("page", pg)} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                Book page {pg}
              </a>
            ))}
            {text.diagram && (
              <a href={robertieImageSrc("diagram", text.diagram)} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                Diagram scan
              </a>
            )}
            {text.text && !text.translation && (
              <button
                type="button"
                onClick={translate}
                disabled={translating}
                className="rounded border border-violet-300 bg-white px-2 py-1 text-violet-900 hover:bg-violet-50 disabled:opacity-60"
              >
                {translating ? "Translating…" : "Translate to Hebrew"}
              </button>
            )}
            {translateError && <span className="text-red-700">{translateError}</span>}
          </div>
        </>
      )}
    </section>
  );
}
