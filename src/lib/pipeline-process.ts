/**
 * Running the Python importers from route handlers: find uv, start `uv run <script> …` in
 * pipeline/, and stream the script's NDJSON progress to the browser as it arrives. Server-only.
 *
 * The response carries the `first` events, then the script's stdout lines verbatim (one JSON
 * object each), one {"event":"log"} per stderr line, an {"event":"error"} when the process fails
 * to start or exits non-zero, and a final {"event":"exit","code":N}. No shell is involved, so
 * arguments (an uploaded file's name, say) are passed as they are.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const PIPELINE_DIR = path.join(process.cwd(), "pipeline");

export const UV_MISSING =
  "uv was not found on PATH. Install uv (winget install astral-sh.uv) or set BG_UV to uv.exe and restart `npm run dev`.";

/** uv from BG_UV, else uv.exe (uv elsewhere) on PATH. A uv.cmd shim is skipped: Node cannot
 * start a .cmd without a shell. */
export function findUv(env: Record<string, string | undefined> = process.env): string | null {
  if (env.BG_UV) return env.BG_UV;
  const name = process.platform === "win32" ? "uv.exe" : "uv";
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** A file name safe to save under data/: letters, digits, dot, dash, underscore; forced suffix. */
export function safeFileName(name: string, ext: string): string {
  let base = path.basename(name || `upload${ext}`).replace(/[^A-Za-z0-9._-]/g, "_");
  if (!base.toLowerCase().endsWith(ext)) base += ext;
  return base;
}

export interface StreamOptions {
  cwd: string;
  /** Events sent before the process output. */
  first?: Record<string, unknown>[];
  /** Called once, when the process has ended, failed to start, or the client went away. */
  onClose?: () => void;
  env?: NodeJS.ProcessEnv;
}

export function streamProcess(command: string, args: string[], opts: StreamOptions): Response {
  // UTF-8 on both pipes whatever the console code page (Python's stderr would otherwise use it).
  const env = { ...(opts.env ?? process.env), PYTHONIOENCODING: "utf-8" };
  const child = spawn(command, args, { cwd: opts.cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const encoder = new TextEncoder();
  let closed = false;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    opts.onClose?.();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (line: string) => {
        if (!closed) controller.enqueue(encoder.encode(line + "\n"));
      };
      const send = (event: Record<string, unknown>) => write(JSON.stringify(event));
      const finish = () => {
        cleanup();
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      for (const event of opts.first ?? []) send(event);

      let out = "";
      child.stdout.on("data", (chunk: string) => {
        out += chunk;
        let i: number;
        while ((i = out.indexOf("\n")) >= 0) {
          const line = out.slice(0, i).trim();
          out = out.slice(i + 1);
          if (line) write(line);
        }
      });
      let err = "";
      child.stderr.on("data", (chunk: string) => {
        err += chunk;
        let i: number;
        while ((i = err.indexOf("\n")) >= 0) {
          const line = err.slice(0, i).trim();
          err = err.slice(i + 1);
          if (line) send({ event: "log", message: line });
        }
      });
      child.on("error", (e) => {
        send({ event: "error", message: `could not start ${path.basename(command)} (${e.message})` });
        finish();
      });
      child.on("close", (code) => {
        if (out.trim()) write(out.trim());
        if (err.trim()) send({ event: "log", message: err.trim() });
        if (code !== 0) send({ event: "error", message: `the importer exited with code ${code}` });
        send({ event: "exit", code });
        finish();
      });
    },
    cancel() {
      closed = true;
      child.kill();
      cleanup();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
