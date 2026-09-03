/**
 * Semantic checks on a Problem beyond the JSON schema: the XGID parses, the question type
 * matches the position, answers are ranked, and every checker answer is a legal play.
 * Shared by the loader and the data test.
 */
import type { CubeAnswerId, Problem } from "@/types/problem";
import { actingView, decisionKind } from "./board";
import { isLegalPlay } from "./moves";
import { parseXgid } from "./xgid";

const DOUBLER_IDS: CubeAnswerId[] = ["no-double", "double-take", "double-pass", "too-good"];
const RESPONDER_IDS: CubeAnswerId[] = ["take", "pass"];

export function validateProblem(p: Problem): string[] {
  const issues: string[] = [];
  let pos;
  try {
    pos = parseXgid(p.xgid);
  } catch (e) {
    return [`xgid: ${(e as Error).message}`];
  }

  const kind = decisionKind(pos);
  if (p.type === "checker" && kind !== "checker") issues.push("type is checker but the XGID has no dice");
  if (p.type === "cube" && kind === "checker") issues.push("type is cube but the XGID has dice");

  if (p.answers.length < 2) issues.push("needs at least two answers");
  if (p.answers.length > 0 && p.answers[0].equityLoss !== 0) issues.push("best answer must have equityLoss 0");
  for (let i = 1; i < p.answers.length; i++) {
    if (p.answers[i].equityLoss < p.answers[i - 1].equityLoss) {
      issues.push(`answers are not ranked: ${p.answers[i].id} has a smaller loss than ${p.answers[i - 1].id}`);
    }
  }
  const ids = new Set<string>();
  for (const a of p.answers) {
    if (ids.has(a.id)) issues.push(`duplicate answer id ${a.id}`);
    ids.add(a.id);
  }

  if (p.type === "checker" && kind === "checker") {
    const view = actingView(pos);
    for (const a of p.answers) {
      if (!isLegalPlay(view, pos.dice!, a.id)) issues.push(`illegal or malformed play: ${a.id}`);
    }
  } else if (p.type === "cube") {
    const allowed: string[] = kind === "cube-take" ? RESPONDER_IDS : DOUBLER_IDS;
    for (const a of p.answers) {
      if (!allowed.includes(a.id)) issues.push(`cube answer id ${a.id} not in [${allowed.join(", ")}]`);
    }
  }
  return issues;
}
