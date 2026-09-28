import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  cleanExplanation,
  describePosition,
  EXPLANATION_LANGUAGE,
  maxTokensFor,
  promptSha256,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
} from "@/lib/explain";
import { DEFAULT_MODEL, explainModel, HARD_MODEL, isExplainEffort, isExplainModel, isSlow, suggestedModel } from "@/lib/explain-models";
import { buildTranslationPrompt, cleanTranslation, TRANSLATION_EFFORT, TRANSLATION_PROMPTS, translationSha256 } from "@/lib/translate";
import { parseXgid } from "@/lib/xgid";
import { explanationLanguage, translationLanguage, type Problem } from "@/types/problem";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const problems: Problem[] = JSON.parse(readFileSync(path.join(ROOT, "data", "problems.json"), "utf8")).problems;
const byId = Object.fromEntries(problems.map((p) => [p.id, p]));

describe("describePosition", () => {
  it("uses Blue's numbering and Blue's side of the score", () => {
    const text = describePosition(parseXgid("--ABCBB------------bcb-ba-:1:-1:-1:52:2:3:0:7:10"));
    expect(text).toContain("Blue (to act): 6-point x2, 5-point x3, 4-point x2, 2-point x2, 1-point x1");
    expect(text).toContain("borne off 5; pip count 40");
    expect(text).toContain("Blue's 23-point (White's 2-point) x1");
    expect(text).toContain("Blue's 19-point (White's 6-point) x2");
    expect(text).toContain("7-point match, Blue 3 - White 2");
    expect(text).toContain("owned by Blue");
  });

  it("describes a money game with a centred cube", () => {
    const text = describePosition(parseXgid("-b----E-C---eE---c-e----B-:0:0:1:31:0:0:0:0:10"));
    expect(text).toContain("Score: money game. Cube: cube centred at 1.");
    expect(text).toContain("pip count 167");
  });
});

describe("buildPrompt", () => {
  it("contains the facts of a checker problem", () => {
    const prompt = buildPrompt(byId["seed-001"]);
    expect(prompt).toContain("Question: Blue to play 31");
    expect(prompt).toContain("Categories: opening.");
    expect(prompt).toContain("1. 8/5 6/5: equity +0.220 (best)");
    expect(prompt).toContain("24/23 13/10");
    expect(prompt).toContain("loses 0.231");
    expect(prompt).toContain("pip count 167");
    expect(prompt).toContain("wins 55.1%");
    expect(prompt).toContain("GNU Backgammon 2-ply evaluation");
    expect(prompt).toContain("Blue checkers back (bar + White's home board): 2");
    expect(prompt).toContain("a hit is available: no");
    expect(prompt.endsWith("Write the explanation now, in Hebrew.")).toBe(true);
  });

  it("contains the facts of a cube problem", () => {
    const prompt = buildPrompt(byId["seed-003"]);
    expect(prompt).toContain("Cube action?");
    expect(prompt).toContain("Double, take: equity +0.792 (best)");
    expect(prompt).toContain("cube centred at 1");
    expect(prompt).toContain("engine position class: race");
  });

  it("names the played move when the reader reviews their own match", () => {
    const plain = buildPrompt(byId["seed-001"]);
    expect(plain).not.toContain("reviewing a match");
    const played = buildPrompt(byId["seed-001"], { played: { label: "24/23 13/10", equityLoss: 0.231 } });
    expect(played).toContain("they played 24/23 13/10, which loses 0.231 against the best play");
    expect(played.endsWith("Write the explanation now, in Hebrew.")).toBe(true);
    expect(played.indexOf("reviewing a match")).toBeGreaterThan(played.indexOf("Board features"));
    const best = buildPrompt(byId["seed-001"], { played: { label: "8/5 6/5", equityLoss: 0 } });
    expect(best).toContain("they played 8/5 6/5, which is the best play");
    expect(promptSha256(played)).not.toBe(promptSha256(plain));
  });

  it("hashes the version, the system prompt and the prompt", () => {
    const a = promptSha256(buildPrompt(byId["seed-001"]));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(promptSha256(buildPrompt(byId["seed-001"]))).toBe(a);
    expect(promptSha256(buildPrompt(byId["seed-002"]))).not.toBe(a);
    expect(PROMPT_VERSION).toBe("v4");
    expect(SYSTEM_PROMPT).toContain("3 to 5 sentences");
  });

  it("asks for the explanation in Hebrew, with the notation and numbers of the data", () => {
    expect(EXPLANATION_LANGUAGE).toBe("he");
    expect(SYSTEM_PROMPT).toContain("you write it in Hebrew");
    expect(SYSTEM_PROMPT).toContain("Blue is כחול and White is לבן");
    expect(SYSTEM_PROMPT).toContain("Write every move exactly as the data does");
    expect(SYSTEM_PROMPT).toContain("every number in digits");
    expect(SYSTEM_PROMPT).toContain("never after a word that is just the English term in Hebrew letters");
  });
});

describe("cleanExplanation", () => {
  it("strips markdown, fences and a leading label", () => {
    const raw = "**Explanation:**\n\n- 8/5 6/5 makes the **5-point**.\n\n1. The alternatives split.\n```\nx\n```\n";
    expect(cleanExplanation(raw)).toBe("8/5 6/5 makes the 5-point. The alternatives split.");
  });

  it("strips a Hebrew label and invisible marks from a Hebrew explanation", () => {
    const rlm = String.fromCharCode(0x200f);
    const raw = `**הסבר:**\n\nכחול משחק 8/5 6/5${rlm} ובונה את נקודה 5.\n\nהמהלך 24/23 13/10 מפסי${String.fromCharCode(0xad)}ד 0.231.`;
    expect(cleanExplanation(raw)).toBe("כחול משחק 8/5 6/5 ובונה את נקודה 5. המהלך 24/23 13/10 מפסיד 0.231.");
  });
});

describe("explanation languages", () => {
  it("translates Hebrew into English and English (also unrecorded) into Hebrew", () => {
    expect(translationLanguage("he")).toBe("en");
    expect(translationLanguage("en")).toBe("he");
    expect(translationLanguage(null)).toBe("he");
    expect(explanationLanguage(undefined)).toBe("en");
    expect(explanationLanguage("he")).toBe("he");
  });
});

describe("translation prompts", () => {
  const english = "8/5 6/5 makes the 5-point; 24/23 13/10 loses 0.231.";
  const hebrew = "8/5 6/5 בונה את נקודה 5; 24/23 13/10 מפסיד 0.231.";

  it("hands over the English text alone and asks for Hebrew only", () => {
    const prompt = buildTranslationPrompt(english, "he");
    expect(prompt).toContain(`<explanation>\n${english}\n</explanation>`);
    expect(prompt.endsWith("Reply with the Hebrew text only.")).toBe(true);
    const he = TRANSLATION_PROMPTS.he;
    expect(he.system).toContain("from English into Hebrew");
    expect(he.system).toContain("Copy every move in notation exactly");
    expect(he.system).toContain("Blue is כחול and White is לבן");
    expect(he.version).toBe("he-v1");
    expect(TRANSLATION_EFFORT).toBe("low");
  });

  it("hands over the Hebrew text alone and asks for English only", () => {
    const prompt = buildTranslationPrompt(hebrew, "en");
    expect(prompt).toContain(`<explanation>\n${hebrew}\n</explanation>`);
    expect(prompt.endsWith("Reply with the English text only.")).toBe(true);
    const en = TRANSLATION_PROMPTS.en;
    expect(en.system).toContain("from Hebrew into English");
    expect(en.system).toContain("Copy every move in notation exactly");
    expect(en.system).toContain("כחול is Blue and לבן is White");
    expect(en.version).toBe("en-v1");
  });

  it("hashes the version, the system prompt and the prompt", () => {
    const a = translationSha256(buildTranslationPrompt(english, "he"), "he");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(translationSha256(buildTranslationPrompt(english, "he"), "he")).toBe(a);
    expect(translationSha256(buildTranslationPrompt("Other text.", "he"), "he")).not.toBe(a);
    // The same prompt text under the other direction's version and system prompt is another prompt.
    expect(translationSha256(buildTranslationPrompt(english, "he"), "en")).not.toBe(a);
  });

  it("keeps plain prose: no echoed tags, labels or markdown", () => {
    expect(cleanTranslation("<translation>\nכחול משחק 8/5 6/5.\n</translation>")).toBe("כחול משחק 8/5 6/5.");
    expect(cleanTranslation("תרגום: **כחול** משחק 8/5 6/5.\n\nהמהלך 24/23 13/10 מפסיד 0.231.")).toBe("כחול משחק 8/5 6/5. המהלך 24/23 13/10 מפסיד 0.231.");
    expect(cleanTranslation("Translation: כחול משחק.")).toBe("כחול משחק.");
    const lrm = String.fromCharCode(0x200e);
    const isolate = (s: string) => String.fromCharCode(0x2066) + s + String.fromCharCode(0x2069);
    expect(cleanTranslation(`המהלך 23/18 9/8 (${lrm}-0.068) ו-${isolate("13/7 8/7")}`)).toBe("המהלך 23/18 9/8 (-0.068) ו-13/7 8/7");
    expect(cleanTranslation(`מפסי${String.fromCharCode(0xad)}ד 0.102`)).toBe("מפסיד 0.102");
    expect(cleanTranslation("<translation>\nTranslation: Blue plays **8/5 6/5**.\n</translation>")).toBe("Blue plays 8/5 6/5.");
  });
});

describe("explain models", () => {
  it("preselects Fable for the hard band only", () => {
    expect(suggestedModel(byId["seed-002"])).toBe(HARD_MODEL); // gap 0.016
    expect(suggestedModel(byId["seed-001"])).toBe(DEFAULT_MODEL); // gap 0.231
    expect(isExplainModel("claude-opus-5")).toBe(true);
    expect(isExplainModel("claude-opus-5-5")).toBe(true);
    // Opus 5.5's own default is medium (Opus 5: high); every model has one, sent explicitly.
    expect(explainModel("claude-opus-5-5")).toMatchObject({ defaultEffort: "medium", usesFallbacks: true });
    expect(explainModel("claude-opus-5").defaultEffort).toBe("high");
    expect(isExplainEffort("max")).toBe(true);
    expect(isExplainEffort("extreme")).toBe(false);
    expect([maxTokensFor("high"), maxTokensFor("xhigh"), maxTokensFor("max")]).toEqual([16000, 64000, 64000]);
    expect([isSlow("claude-opus-5", "high"), isSlow("claude-opus-5", "max"), isSlow("claude-fable-5-1", "low")]).toEqual([false, true, true]);
    expect(isExplainModel("gpt-5")).toBe(false);
  });
});
