/**
 * Performance rating, XG style: PR = 500 × the equity lost per counted decision, in normalised
 * equity (EMG in match play, which is what the pipeline stores). Which decisions count follows
 * gnubg's match statistics:
 *
 * - a checker play with a choice (forced plays and dances never count);
 * - every double, take and pass;
 * - a no-double when doubling was close (it would have lost less than CLOSE_CUBE), or when it
 *   was a missed double (the no-double lost equity).
 *
 * Rating words are gnubg's (its `errorrating` thresholds per decision: 0.002, 0.005, 0.008,
 * 0.012, 0.018, 0.026, 0.035, i.e. PR 1, 2.5, 4, 6, 9, 13, 17.5). Pure and client-safe.
 */
import type { Answer } from "@/types/problem";

export const CLOSE_CUBE = 0.16;
/** Must match ERROR_THRESHOLD / BLUNDER_THRESHOLD in matches.ts (checked by test). */
const ERROR = 0.02;
const BLUNDER = 0.08;

export interface RatedDecision {
  player: number;
  kind: "checker" | "cube" | "take";
  /** Checker notation, double / no-double, take / pass. */
  played: string;
  forced: boolean;
  /** Equity lost; null when not scored. */
  loss: number | null;
  /** Ranked answers; cube decisions carry no-double / double-take / double-pass with their equities. */
  answers: Answer[];
}

/** gnubg's no-double, double/take and double/pass equities, from a cube decision's answers. */
export function cubeEquities(answers: Answer[]): { nd: number; dt: number; dp: number } | null {
  const eq = (id: string) => answers.find((a) => a.id === id)?.equity;
  const nd = eq("no-double");
  const dt = eq("double-take");
  const dp = eq("double-pass");
  return nd === undefined || dt === undefined || dp === undefined ? null : { nd, dt, dp };
}

export function isCounted(d: RatedDecision): boolean {
  if (d.forced || d.loss === null) return false;
  if (d.kind !== "cube" || d.played === "double" || d.loss > 0) return true;
  const eq = cubeEquities(d.answers);
  if (!eq) return false;
  const doubled = Math.min(eq.dt, eq.dp);
  return Math.max(eq.nd, doubled) - doubled < CLOSE_CUBE;
}

export interface PlayerRating {
  /** Counted decisions (checker + cube). */
  decisions: number;
  checkerDecisions: number;
  /** Doubles, no-doubles that count, takes and passes. */
  cubeDecisions: number;
  totalLoss: number;
  checkerLoss: number;
  cubeLoss: number;
  /** null when nothing counted. */
  pr: number | null;
  checkerPr: number | null;
  cubePr: number | null;
  errors: number;
  blunders: number;
  /** gnubg's word for the overall PR. */
  rating: string | null;
}

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;
const toPr = (loss: number, n: number) => (n > 0 ? round((500 * loss) / n, 1) : null);

const RATINGS: [number, string][] = [
  [1, "Supernatural"],
  [2.5, "World class"],
  [4, "Expert"],
  [6, "Advanced"],
  [9, "Intermediate"],
  [13, "Casual player"],
  [17.5, "Beginner"],
];

/** gnubg's rating word for a PR. */
export function ratingWord(pr: number): string {
  for (const [limit, word] of RATINGS) if (pr < limit) return word;
  return "Awful";
}

/** PR and error counts for one player's decisions. */
export function ratePlayer(decisions: readonly RatedDecision[], player: number): PlayerRating {
  let checkerN = 0;
  let cubeN = 0;
  let checkerLoss = 0;
  let cubeLoss = 0;
  let errors = 0;
  let blunders = 0;
  for (const d of decisions) {
    if (d.player !== player || !isCounted(d)) continue;
    const loss = d.loss ?? 0;
    if (d.kind === "checker") {
      checkerN++;
      checkerLoss += loss;
    } else {
      cubeN++;
      cubeLoss += loss;
    }
    if (loss >= ERROR) errors++;
    if (loss >= BLUNDER) blunders++;
  }
  const n = checkerN + cubeN;
  const total = checkerLoss + cubeLoss;
  const pr = toPr(total, n);
  return {
    decisions: n,
    checkerDecisions: checkerN,
    cubeDecisions: cubeN,
    totalLoss: round(total, 4),
    checkerLoss: round(checkerLoss, 4),
    cubeLoss: round(cubeLoss, 4),
    pr,
    checkerPr: toPr(checkerLoss, checkerN),
    cubePr: toPr(cubeLoss, cubeN),
    errors,
    blunders,
    rating: pr === null ? null : ratingWord(pr),
  };
}

export const PR_THRESHOLDS = { error: ERROR, blunder: BLUNDER };
