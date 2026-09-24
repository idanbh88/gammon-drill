/**
 * The prompt that translates a stored explanation into Hebrew, the language the user reads
 * most easily; the panel shows the translation under the English original. Server-only (used by
 * the /api/explain/translate route).
 *
 * Bump TRANSLATION_PROMPT_VERSION when the system prompt or the prompt layout changes; every
 * stored translation records the version and a hash of its full prompt.
 */
import { createHash } from "node:crypto";
import { cleanExplanation } from "./explain";
import type { ExplainEffort } from "./explain-models";
import { stripInvisibleMarks } from "./rtl";

export const TRANSLATION_PROMPT_VERSION = "he-v1";

/** Translating a short text needs little thinking; recorded with each translation. */
export const TRANSLATION_EFFORT: ExplainEffort = "low";

export const TRANSLATION_SYSTEM_PROMPT = `You translate backgammon explanations from English into Hebrew. The reader is an Israeli backgammon player who reads Hebrew more easily than English; the app shows your translation right under the English original.

Write natural, fluent Hebrew that says exactly what the English says: the same ideas in the same order, nothing added, dropped or softened. Plain prose only: no headings, lists, markdown, preamble or notes about the translation.
- Copy every move in notation exactly as written (for example 13/7 8/7, bar/21*, 6/4(2)) and write every number in digits with the same value: equities, losses, percentages, pip counts, point numbers.
- Blue is כחול and White is לבן.
- Use the backgammon terms Israeli players use. When a term is usually said in English, or its Hebrew may be unfamiliar, add the English term in parentheses the first time it appears.`;

export function buildTranslationPrompt(english: string): string {
  return `<explanation>\n${english}\n</explanation>\n\nTranslate this explanation into Hebrew. Reply with the Hebrew text only.`;
}

/** Plain prose only, as for explanations; also drops echoed tags, a leading "Translation:" label and invisible marks. */
export function cleanTranslation(text: string): string {
  return cleanExplanation(stripInvisibleMarks(text.replace(/<\/?[a-z_]+>/gi, "")))
    .replace(/^(?:translation|תרגום|הסבר)\s*:\s*/i, "")
    .trim();
}

/** Identifies the exact prompt (version, system prompt and user prompt) a translation came from. */
export function translationSha256(prompt: string): string {
  return createHash("sha256").update(`${TRANSLATION_PROMPT_VERSION}\n${TRANSLATION_SYSTEM_PROMPT}\n${prompt}`).digest("hex");
}
