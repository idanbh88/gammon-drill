import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEvent, postNdjson, readNdjson } from "@/lib/ndjson";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

const enc = new TextEncoder();

describe("ndjson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses event lines", () => {
    expect(parseEvent('{"event":"done","n":1}')).toEqual({ event: "done", n: 1 });
    expect(parseEvent("[1]")).toBeNull();
    expect(parseEvent('{"n":1}')).toBeNull();
    expect(parseEvent("Traceback (most recent call last):")).toBeNull();
  });

  it("reads lines split across chunks, including a split character and a last line without newline", async () => {
    const accent = enc.encode('{"event":"c","t":"é"}\n');
    const cut = accent.indexOf(0xc3) + 1; // between the two bytes of "é"
    const chunks = [enc.encode('{"event":"a"}\n{"ev'), enc.encode('ent":"b"}\n\n'), accent.slice(0, cut), accent.slice(cut), enc.encode('{"event":"d"}')];
    const got: string[] = [];
    await readNdjson(streamOf(chunks), (l) => got.push(l));
    expect(got).toEqual(['{"event":"a"}', '{"event":"b"}', '{"event":"c","t":"é"}', '{"event":"d"}']);
  });

  it("posts a form and reports a refused upload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(streamOf([enc.encode('{"event":"start"}\n{"event":"done"}\n')]), { status: 200 })),
    );
    const got: string[] = [];
    await postNdjson("/api/x", new FormData(), (l) => got.push(l));
    expect(got).toEqual(['{"event":"start"}', '{"event":"done"}']);

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "not a quiz" }, { status: 400 })));
    await expect(postNdjson("/api/x", new FormData(), () => {})).rejects.toThrow("not a quiz");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 500 })));
    await expect(postNdjson("/api/x", new FormData(), () => {})).rejects.toThrow("HTTP 500");
  });
});
