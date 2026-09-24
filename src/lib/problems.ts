/**
 * Server-side loader for problem sets. Every *.json file in data/ is one ProblemSet; generated
 * explanations are overlaid from data/store.sqlite (see store.ts).
 * Do not import this from client components (it uses node:fs).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { ProblemSetSchema, type Problem, type ProblemSet } from "@/types/problem";
import { ERROR_THRESHOLD } from "./matches";
import { applyStore, readLatestExplanations, readMistakeProblems } from "./store";
import { validateProblem } from "./validate";

export const DATA_DIR = path.join(process.cwd(), "data");

export class ProblemDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProblemDataError";
  }
}

export async function loadProblemSets(dir: string = DATA_DIR): Promise<ProblemSet[]> {
  const names = (await fs.readdir(dir)).filter((f) => f.toLowerCase().endsWith(".json")).sort();
  const sets: ProblemSet[] = [];
  const seen = new Map<string, string>();
  for (const name of names) {
    const file = path.join(dir, name);
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (e) {
      throw new ProblemDataError(`${name}: not valid JSON (${(e as Error).message})`);
    }
    const parsed = ProblemSetSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ProblemDataError(`${name}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    }
    for (const p of parsed.data.problems) {
      const dup = seen.get(p.id);
      if (dup) throw new ProblemDataError(`${name}: duplicate problem id ${p.id} (also in ${dup})`);
      seen.set(p.id, name);
      const issues = validateProblem(p);
      if (issues.length > 0) throw new ProblemDataError(`${name}: problem ${p.id}: ${issues.join("; ")}`);
    }
    sets.push(parsed.data);
  }
  // Generated explanations live in dir/store.sqlite; the newest row per XGID wins over the
  // JSON field, which stays as a hand-written fallback.
  const latest = readLatestExplanations(dir);
  if (latest.size === 0) return sets;
  return sets.map((s) => ({ ...s, problems: applyStore(s.problems, latest) }));
}

export async function loadProblems(dir: string = DATA_DIR): Promise<Problem[]> {
  const sets = await loadProblemSets(dir);
  return sets.flatMap((s) => s.problems);
}

/**
 * What the quiz draws from: every problem set, plus the user's own mistakes from the store
 * (games against gnubg and imported matches; see mistakes.ts). A mistake that fails validation
 * or repeats an id is left out rather than breaking the quiz.
 */
export async function loadQuizProblems(dir: string = DATA_DIR): Promise<Problem[]> {
  const problems = await loadProblems(dir);
  const ids = new Set(problems.map((p) => p.id));
  for (const p of readMistakeProblems(dir, ERROR_THRESHOLD)) {
    if (ids.has(p.id) || validateProblem(p).length > 0) continue;
    ids.add(p.id);
    problems.push(p);
  }
  return problems;
}


export { difficulty } from "./problem-utils";
