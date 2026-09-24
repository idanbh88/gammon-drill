/**
 * Reading the importers' NDJSON progress streams in the browser (UploadMatch, UploadLessons).
 * Client-safe.
 */
export interface ImportEvent {
  event: string;
  [key: string]: unknown;
}

/** The event on one line, or null when the line is not a JSON object with an "event". */
export function parseEvent(line: string): ImportEvent | null {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === "object" && typeof (value as ImportEvent).event === "string" ? (value as ImportEvent) : null;
  } catch {
    return null;
  }
}

/** Call `onLine` for every non-empty line of the stream; a line (or a character) may arrive
 * split across chunks. */
export async function readNdjson(body: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const drain = () => {
    let i: number;
    while ((i = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, i).trim();
      pending = pending.slice(i + 1);
      if (line) onLine(line);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    drain();
  }
  pending += decoder.decode();
  drain();
  if (pending.trim()) onLine(pending.trim());
}

/** POST a form to an import route and feed its progress lines to `onLine`. Throws the route's
 * { error } when it refuses the upload before starting. */
export async function postNdjson(url: string, form: FormData, onLine: (line: string) => void): Promise<void> {
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  await readNdjson(res.body, onLine);
}
