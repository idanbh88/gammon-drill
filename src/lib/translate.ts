/**
 * The prompts that translate a stored explanation into the other language, shown with the
 * original in the panel: a Hebrew explanation (prompt v4 on) into English, and an English one
 * (written before 2026-09-27) into Hebrew, the language the user reads most easily. Server-only
 * (used by the /api/explain/translate route).
 *
 * Each direction has its own version: bump it when that system prompt or the prompt layout
 * changes; every stored translation records the version and a hash of its full prompt.
 */
import { createHash } from "node:crypto";
import type { ExplanationLanguage } from "@/types/problem";
import { cleanExplanation } from "./explain";
import type { ExplainEffort } from "./explain-models";

/** Translating a short text needs little thinking; recorded with each translation. */
export const TRANSLATION_EFFORT: ExplainEffort = "low";

export interface TranslationPrompt {
  /** Recorded with each translation into this language. */
  version: string;
  system: string;
  /** The last paragraph of the user prompt, after the text. */
  request: string;
}

/** The prompt for a translation into each language. */
export const TRANSLATION_PROMPTS: Record<ExplanationLanguage, TranslationPrompt> = {
  en: {
    version: "en-v1",
    system: `You translate backgammon explanations from Hebrew into English. The reader is an Israeli backgammon player who reads Hebrew more easily than English; the app shows your translation right under the Hebrew original.

Write natural, fluent English that says exactly what the Hebrew says: the same ideas in the same order, nothing added, dropped or softened. Plain prose only: no headings, lists, markdown, preamble or notes about the translation.
- Copy every move in notation exactly as written (for example 13/7 8/7, bar/21*, 6/4(2)) and write every number in digits with the same value: equities, losses, percentages, pip counts, point numbers.
- כחול is Blue and לבן is White.
- Use the standard English backgammon terms. Where the Hebrew adds an English term in parentheses, translate the pair as that one English term.`,
    request: "Translate this explanation into English. Reply with the English text only.",
  },
  he: {
    version: "he-v1",
    system: `You translate backgammon explanations from English into Hebrew. The reader is an Israeli backgammon player who reads Hebrew more easily than English; the app shows your translation right under the English original.

Write natural, fluent Hebrew that says exactly what the English says: the same ideas in the same order, nothing added, dropped or softened. Plain prose only: no headings, lists, markdown, preamble or notes about the translation.
- Copy every move in notation exactly as written (for example 13/7 8/7, bar/21*, 6/4(2)) and write every number in digits with the same value: equities, losses, percentages, pip counts, point numbers.
- Blue is כחול and White is לבן.
- Use the backgammon terms Israeli players use. When a term is usually said in English, or its Hebrew may be unfamiliar, add the English term in parentheses the first time it appears.`,
    request: "Translate this explanation into Hebrew. Reply with the Hebrew text only.",
  },
};

export function buildTranslationPrompt(text: string, into: ExplanationLanguage): string {
  return `<explanation>\n${text}\n</explanation>\n\n${TRANSLATION_PROMPTS[into].request}`;
}

/** Plain prose only, as for explanations; also drops echoed tags and a leading "Translation:" label. */
export function cleanTranslation(text: string): string {
  return cleanExplanation(text.replace(/<\/?[a-z_]+>/gi, ""))
    .replace(/^(?:translation|תרגום|הסבר)\s*:\s*/i, "")
    .trim();
}

/** Identifies the exact prompt (version, system prompt and user prompt) a translation came from. */
export function translationSha256(prompt: string, into: ExplanationLanguage): string {
  const { version, system } = TRANSLATION_PROMPTS[into];
  return createHash("sha256").update(`${version}\n${system}\n${prompt}`).digest("hex");
}

/**
 * Robertie's analysis from the book (English, as printed) into Hebrew, on the reader's request
 * under a book problem. The book's own colours are kept: its Black is the player on roll. Stored
 * in robertie.sqlite (robertie_translations), tied to the exact text by its hash.
 */
export const ROBERTIE_TRANSLATION: TranslationPrompt = {
  version: "rb-he-v1",
  system: `You translate passages from a backgammon book, Bill Robertie's "501 Essential Backgammon Problems", from English into Hebrew. The reader owns the book and reads Hebrew more easily than English; the app shows your translation above the English original.

Write natural, fluent Hebrew that says exactly what the English says: the same ideas in the same order, nothing added, dropped or softened. Plain prose only: no headings, lists, markdown, preamble or notes about the translation. Keep the paragraphs.
- Copy every move in notation exactly as written (for example 13/11 6/5, 24/20*(2), Bar/21*, 5/off) and write every number in digits with the same value: point numbers, pip counts, rolls, percentages.
- Keep the book's colours: Black is שחור and White is לבן.
- Use the backgammon terms Israeli players use. When a term is usually said in English, or its Hebrew may be unfamiliar, add the English term in parentheses the first time it appears.`,
  request: "Translate this passage into Hebrew. Reply with the Hebrew text only.",
};

export function buildRobertieTranslationPrompt(text: string): string {
  return `<passage>\n${text}\n</passage>\n\n${ROBERTIE_TRANSLATION.request}`;
}

export function robertieTranslationSha256(prompt: string): string {
  const { version, system } = ROBERTIE_TRANSLATION;
  return createHash("sha256").update(`${version}\n${system}\n${prompt}`).digest("hex");
}
