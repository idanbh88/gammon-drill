/**
 * Lessons: Backgammon Galaxy quiz sets imported by pipeline/import_lessons.py into
 * data/lessons/lessons.sqlite. The positions exist only as pictures, so a lesson problem is a
 * picture, the choices exactly as Galaxy wrote them (a play or a cube action, with Galaxy's
 * equity text) and the author's analysis. None of the XGID conventions apply: no Blue-at-the-
 * bottom board, no validateProblem, no cube answer ids.
 *
 * View types and pure helpers; client-safe (lesson-store.ts reads the database on the server).
 */
import { lossClass } from "./matches";

/** A Galaxy id (24 hex digits): a set's key in URLs, folders and progress. */
export const QUIZ_KEY_RE = /^[0-9a-f]{24}$/;
/** Picture names the importer writes: p01.png (a position), p01-c2.png (after choice 2). */
export const IMAGE_FILE_RE = /^p\d{2}(?:-c\d{1,2})?\.png$/;

export type LessonKind = "checker" | "cube";

export interface LessonImage {
  /** The image route's URL, with an MD5 prefix as cache buster. */
  src: string;
  /** Pixel size of the stored file; 0 when unknown. */
  width: number;
  height: number;
}

export interface LessonChoice {
  /** Galaxy's choice id. */
  id: string;
  /** 1-based: the order in the export, which is also the display order. */
  number: number;
  /** As Galaxy wrote it: "7/5 6/5", "Double / Take". */
  answer: string;
  /** Galaxy's equity text, shown as is: "+0.458", "(-0.062)", "Wrong". */
  description: string | null;
  /** Equity given up when the text says so: 0 for the correct choice, null when unknown. */
  loss: number | null;
  correct: boolean;
  /** The position after this play (checker choices, when the set has one). */
  image: LessonImage | null;
}

export interface LessonProblem {
  /** "lesson-<galaxy problem id>": the progress key. */
  id: string;
  number: number;
  kind: LessonKind;
  /** The position; null only when the database lost track of the file. */
  image: LessonImage | null;
  analysis: string | null;
  choices: LessonChoice[];
}

export interface LessonSetSummary {
  /** The Galaxy quiz id: URL /lessons/<key>, folder data/lessons/<key>, progress key. */
  key: string;
  name: string;
  author: string | null;
  /** "Medium", "Hard" … from the export's file name; null when it had none. */
  collection: string | null;
  /** Problem ids in set order, so progress can be computed on the client. */
  problemIds: string[];
  checker: number;
  cube: number;
  withAnalysis: number;
  importedAt: string;
}

export interface LessonSet extends LessonSetSummary {
  fileName: string;
  problems: LessonProblem[];
}

export function isQuizKey(s: string): boolean {
  return QUIZ_KEY_RE.test(s);
}

/** URL of a stored picture ("<quiz id>/images/p01.png"), or null for a path the image route refuses. */
export function imageSrc(storedPath: string, md5: string | null): string | null {
  const [key, folder, file, ...rest] = storedPath.split("/");
  if (rest.length || folder !== "images" || !isQuizKey(key ?? "") || !IMAGE_FILE_RE.test(file ?? "")) return null;
  return `/api/lessons/images/${key}/${file}` + (md5 ? `?v=${md5.slice(0, 8)}` : "");
}

const COLLECTION_ORDER = ["Easy", "Medium", "Hard"];
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function collectionRank(c: string | null): number {
  if (c === null) return COLLECTION_ORDER.length + 1;
  const i = COLLECTION_ORDER.indexOf(c);
  return i >= 0 ? i : COLLECTION_ORDER.length;
}

/** Sets grouped by collection (Easy, Medium, Hard, others A–Z, none last), each group in natural
 * name order, so "Lesson 2" comes before "Lesson 10". */
export function groupByCollection<T extends Pick<LessonSetSummary, "collection" | "name">>(
  sets: readonly T[],
): { collection: string | null; sets: T[] }[] {
  const groups = new Map<string | null, T[]>();
  for (const s of sets) {
    const list = groups.get(s.collection);
    if (list) list.push(s);
    else groups.set(s.collection, [s]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => collectionRank(a) - collectionRank(b) || collator.compare(a ?? "", b ?? ""))
    .map(([collection, list]) => ({ collection, sets: list.slice().sort((x, y) => collator.compare(x.name, y.name)) }));
}

export function correctChoice(p: LessonProblem): LessonChoice {
  const c = p.choices.find((x) => x.correct);
  if (!c) throw new Error(`${p.id}: no correct choice`);
  return c;
}

/** Text colour of a choice after answering: green for the correct one; a wrong one by its loss,
 * lime when it loses nothing (it still is not the answer); grey when the loss is unknown. */
export function choiceTone(c: Pick<LessonChoice, "correct" | "loss">): string {
  if (c.correct) return "text-green-700";
  if (c.loss === null) return "text-stone-500";
  if (c.loss === 0) return "text-lime-700";
  return lossClass(c.loss);
}

export function kindLabel(kind: LessonKind): string {
  return kind === "checker" ? "Checker play" : "Cube decision";
}

export function promptText(kind: LessonKind): string {
  return kind === "checker" ? "Find the best play." : "What is the right cube action?";
}
