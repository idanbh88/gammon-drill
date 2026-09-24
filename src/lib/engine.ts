/**
 * The live engine: one long-running gnubg process per server (`gnubg-cli -t -q -p
 * gnubg_server.py`, see pipeline/bgpipeline/gnubg_server.py), shared by every request. It is
 * started on first use (about 2 s), answers a 2-ply analysis in well under a second and stops
 * after IDLE_MS without requests. Server-only.
 *
 * gnubg's C code opens the `-p` script with the ANSI code page, so the script is copied to an
 * ASCII folder first; the pipeline itself is imported from BG_PIPELINE_DIR, which Python reads as
 * Unicode. When the server dies, the pipe closes, the script's stdin loop ends and gnubg exits.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Answer } from "@/types/problem";
import { PIPELINE_DIR } from "./pipeline-process";

export type EngineKind = "checker" | "cube" | "take";

export interface EngineRequest {
  xgid: string;
  /** What was played (checker notation, double / no-double, take / pass); omitted = gnubg's own choice. */
  played?: string | null;
}

/** One analysed decision; the fields mirror the store's decision columns (match_score.Scored). */
export interface EngineResult {
  kind: EngineKind;
  /** gnubg's choice: a play in the acting player's notation, or double / no-double / take / pass. */
  best: string;
  played: string;
  answers: Answer[];
  playedAnswerId: string | null;
  bestAnswerId: string | null;
  bestEquity: number | null;
  playedEquity: number | null;
  loss: number | null;
  positionClass: string | null;
  categories: string[];
  features: Record<string, number | boolean | string> | null;
  warnings: string[];
  /** Cube decisions: gnubg's equities from the doubler's side. */
  cube: { nd: number; dt: number; dp: number; proper: string } | null;
  plies: number;
  ms: number;
}

export interface Engine {
  analyse(req: EngineRequest): Promise<EngineResult>;
}

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}

export const ENGINE_PLIES = 2;
const PREFIX = "@@BG ";
const START_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 120_000;
const IDLE_MS = 15 * 60_000;

const GNUBG_LOCATIONS = [
  "C:\\gnubg\\gnubg-cli.exe",
  "C:\\Program Files (x86)\\gnubg\\gnubg-cli.exe",
  "C:\\Program Files\\gnubg\\gnubg-cli.exe",
  "/usr/bin/gnubg",
  "/usr/local/bin/gnubg",
];

export const GNUBG_MISSING = "gnubg-cli was not found. Install GNU Backgammon at C:\\gnubg or set BG_GNUBG to gnubg-cli.exe and restart `npm run dev`.";

/** BG_GNUBG, gnubg-cli on PATH, then the usual install folders (like gnubg_runner.find_gnubg). */
export function findGnubg(env: Record<string, string | undefined> = process.env): string | null {
  if (env.BG_GNUBG && existsSync(env.BG_GNUBG)) return env.BG_GNUBG;
  const names = process.platform === "win32" ? ["gnubg-cli.exe"] : ["gnubg-cli", "gnubg"];
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      // Files outside the project, looked up at run time: not something to trace into a build.
      const candidate = path.join(/*turbopackIgnore: true*/ dir, name);
      if (existsSync(/*turbopackIgnore: true*/ candidate)) return candidate;
    }
  }
  return GNUBG_LOCATIONS.find((p) => existsSync(p)) ?? null;
}

const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/** A folder whose path gnubg can open: the temp folder when its path is ASCII (on this machine it
 * is the 8.3 form), else %PUBLIC%. */
export function asciiDir(env: Record<string, string | undefined> = process.env, tmp = os.tmpdir()): string {
  if (isAscii(tmp)) return path.join(tmp, "bg-engine");
  return path.join(env.PUBLIC ?? "C:\\Users\\Public", "bg-engine");
}

interface Pending {
  resolve: (r: EngineResult) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

class GnubgEngine implements Engine {
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private idleTimer: NodeJS.Timeout | null = null;
  private stderrTail: string[] = [];

  async analyse(req: EngineRequest): Promise<EngineResult> {
    await this.start();
    const child = this.child;
    if (!child) throw new EngineError("gnubg is not running");
    const id = this.nextId++;
    this.touch();
    return new Promise<EngineResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new EngineError(`gnubg did not answer within ${REQUEST_TIMEOUT_MS / 1000} s`));
        this.stop();
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      const body: Record<string, unknown> = { id, op: "analyse", xgid: req.xgid };
      if (req.played != null) body.played = req.played;
      child.stdin.write(JSON.stringify(body) + "\n");
    });
  }

  /** Start gnubg if it is not running; failures surface on the next request. */
  warm(): void {
    this.start().then(
      () => this.touch(),
      () => undefined,
    );
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const exe = findGnubg();
      if (!exe) {
        this.ready = null;
        reject(new EngineError(GNUBG_MISSING));
        return;
      }
      const dir = asciiDir();
      mkdirSync(dir, { recursive: true });
      const script = path.join(dir, "bg-gnubg-server.py");
      copyFileSync(path.join(PIPELINE_DIR, "bgpipeline", "gnubg_server.py"), script);
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        BG_PIPELINE_DIR: PIPELINE_DIR,
        BG_PLIES: String(ENGINE_PLIES),
        BG_SERVE: "1",
        PYTHONIOENCODING: "utf-8",
        PYTHONDONTWRITEBYTECODE: "1",
      };
      delete env.BG_XGIDS;
      delete env.BG_OUT;
      const child = spawn(/*turbopackIgnore: true*/ exe, ["-t", "-q", "-p", script], { cwd: path.dirname(exe), env, windowsHide: true, stdio: "pipe" });
      this.child = child;
      this.stderrTail = [];
      const startTimer = setTimeout(() => {
        reject(new EngineError(`gnubg did not start within ${START_TIMEOUT_MS / 1000} s. ${this.tail()}`));
        this.stop();
      }, START_TIMEOUT_MS);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      let buf = "";
      child.stdout.on("data", (chunk: string) => {
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, "");
          buf = buf.slice(i + 1);
          if (!line.startsWith(PREFIX)) continue;
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(line.slice(PREFIX.length));
          } catch {
            continue;
          }
          if (msg.event === "ready") {
            clearTimeout(startTimer);
            resolve();
            continue;
          }
          const p = typeof msg.id === "number" ? this.pending.get(msg.id) : undefined;
          if (!p) continue;
          this.pending.delete(msg.id as number);
          clearTimeout(p.timer);
          if (msg.ok) p.resolve(msg as unknown as EngineResult);
          else p.reject(new EngineError(`gnubg: ${String(msg.error)}`));
        }
      });
      child.stderr.on("data", (chunk: string) => {
        this.stderrTail.push(...chunk.split(/\r?\n/).filter(Boolean));
        this.stderrTail = this.stderrTail.slice(-20);
      });
      const onEnd = (why: string) => {
        clearTimeout(startTimer);
        if (this.child === child) {
          this.child = null;
          this.ready = null;
        }
        const err = new EngineError(`gnubg ${why}. ${this.tail()}`);
        reject(err);
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(err);
          this.pending.delete(id);
        }
      };
      child.on("error", (e) => onEnd(`could not start (${e.message})`));
      child.on("exit", (code) => onEnd(`exited (code ${code})`));
    });
    return this.ready;
  }

  private tail(): string {
    return this.stderrTail.length ? `gnubg said: ${this.stderrTail.join(" | ")}` : "";
  }

  private touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(), IDLE_MS);
    this.idleTimer.unref();
  }

  stop() {
    const child = this.child;
    this.child = null;
    this.ready = null;
    if (child && child.exitCode === null) {
      child.stdin.end();
      child.kill();
    }
  }
}

// One engine per server process; kept on globalThis so a hot reload does not start a second gnubg.
const globalForEngine = globalThis as unknown as { __bgEngine?: GnubgEngine };

function engineInstance(): GnubgEngine {
  if (!globalForEngine.__bgEngine) {
    const engine = new GnubgEngine();
    globalForEngine.__bgEngine = engine;
    process.once("exit", () => engine.stop());
  }
  return globalForEngine.__bgEngine;
}

export function getEngine(): Engine {
  return engineInstance();
}

/** Start gnubg in the background (a page that will need it soon calls this). */
export function warmEngine(): void {
  if (findGnubg()) engineInstance().warm();
}
