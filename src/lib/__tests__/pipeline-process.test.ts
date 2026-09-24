import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findUv, safeFileName, streamProcess } from "@/lib/pipeline-process";

const lines = async (res: Response) =>
  (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe("pipeline process", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "gammon-drill-proc-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds uv through BG_UV or PATH", () => {
    expect(findUv({ BG_UV: "C:/tools/uv.exe" })).toBe("C:/tools/uv.exe");
    expect(findUv({ PATH: "" })).toBeNull();
    const exe = path.join(dir, process.platform === "win32" ? "uv.exe" : "uv");
    writeFileSync(exe, "");
    expect(findUv({ PATH: ["", path.join(dir, "missing"), dir].join(path.delimiter) })).toBe(exe);
  });

  it("makes safe file names", () => {
    expect(safeFileName("my match (1).mat", ".mat")).toBe("my_match__1_.mat");
    expect(safeFileName("../../etc/passwd", ".mat")).toBe("passwd.mat");
    expect(safeFileName("", ".json")).toBe("upload.json");
  });

  it("streams stdout lines, stderr as log events, the exit code, and cleans up once", async () => {
    const script = [
      "process.stdout.write('{\"event\":\"a\"}\\n{\"event\":\"b\",');",
      "setTimeout(() => {",
      "  process.stdout.write('\"x\":1}\\n{\"event\":\"env\",\"value\":\"' + process.env.PYTHONIOENCODING + '\"}\\n{\"event\":\"last\"}');",
      "  process.stderr.write('warn one\\nwarn ');",
      "  process.stderr.write('two\\n');",
      "  process.exitCode = 3;",
      "}, 30);",
    ].join("\n");
    let cleaned = 0;
    const res = streamProcess(process.execPath, ["-e", script], {
      cwd: dir,
      first: [{ event: "saved", file: "x.json" }],
      onClose: () => cleaned++,
    });
    expect(res.headers.get("content-type")).toMatch(/ndjson/);
    const events = await lines(res);
    expect(events[0]).toEqual({ event: "saved", file: "x.json" });
    const stdout = events.filter((e) => ["a", "b", "env", "last"].includes(String(e.event)));
    expect(stdout).toEqual([{ event: "a" }, { event: "b", x: 1 }, { event: "env", value: "utf-8" }, { event: "last" }]);
    expect(events.filter((e) => e.event === "log").map((e) => e.message)).toEqual(["warn one", "warn two"]);
    expect(events.slice(-2)).toEqual([
      { event: "error", message: "the importer exited with code 3" },
      { event: "exit", code: 3 },
    ]);
    expect(cleaned).toBe(1);
  });

  it("reports a command that cannot start", async () => {
    let cleaned = 0;
    const res = streamProcess(path.join(dir, "no-such-program.exe"), [], { cwd: dir, onClose: () => cleaned++ });
    const events = await lines(res);
    expect(events[0].event).toBe("error");
    expect(String(events[0].message)).toMatch(/could not start no-such-program\.exe/);
    expect(cleaned).toBe(1);
  });
});
