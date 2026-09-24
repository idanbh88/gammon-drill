import { describe, expect, it } from "vitest";
import { choiceTone, correctChoice, groupByCollection, imageSrc, isQuizKey, promptText, type LessonProblem } from "@/lib/lessons";

const A = "5a5a5a5a5a5a5a5a5a5a5a5a";

describe("lessons", () => {
  it("recognises Galaxy quiz ids", () => {
    expect(isQuizKey(A)).toBe(true);
    expect(isQuizKey(A.toUpperCase())).toBe(false);
    expect(isQuizKey("../5a5a5a5a5a5a5a5a5a5a5a")).toBe(false);
  });

  it("builds image URLs only for paths the importer writes", () => {
    expect(imageSrc(`${A}/images/p01.png`, "0123456789abcdef0123456789abcdef")).toBe(`/api/lessons/images/${A}/p01.png?v=01234567`);
    expect(imageSrc(`${A}/images/p01-c2.png`, null)).toBe(`/api/lessons/images/${A}/p01-c2.png`);
    for (const bad of ["x/images/p01.png", `${A}/img/p01.png`, `${A}/images/../p01.png`, `${A}/images/p01.png/x`, `${A}/images/p1.png`]) {
      expect(imageSrc(bad, null)).toBeNull();
    }
  });

  it("groups sets by collection in a natural order", () => {
    const sets = [
      { collection: "Hard", name: "BGWC Quiz 2" },
      { collection: "Medium", name: "Lesson 10: Reference" },
      { collection: null, name: "Loose set" },
      { collection: "Medium", name: "Lesson 2: Early cubes" },
      { collection: "Advanced", name: "Extra" },
      { collection: "Hard", name: "BGWC Quiz 10" },
    ];
    expect(groupByCollection(sets).map((g) => [g.collection, g.sets.map((s) => s.name)])).toEqual([
      ["Medium", ["Lesson 2: Early cubes", "Lesson 10: Reference"]],
      ["Hard", ["BGWC Quiz 2", "BGWC Quiz 10"]],
      ["Advanced", ["Extra"]],
      [null, ["Loose set"]],
    ]);
  });

  it("colours choices by correctness first, then by loss", () => {
    expect(choiceTone({ correct: true, loss: 0 })).toBe("text-green-700");
    expect(choiceTone({ correct: false, loss: 0 })).toBe("text-lime-700"); // wrong, even if it loses nothing
    expect(choiceTone({ correct: false, loss: 0.01 })).toBe("text-lime-700");
    expect(choiceTone({ correct: false, loss: 0.05 })).toBe("text-amber-700");
    expect(choiceTone({ correct: false, loss: 0.2 })).toBe("text-red-700");
    expect(choiceTone({ correct: false, loss: null })).toBe("text-stone-500");
  });

  it("finds the correct choice and words the question", () => {
    const p: LessonProblem = {
      id: "lesson-x",
      number: 1,
      kind: "cube",
      image: null,
      analysis: null,
      choices: [
        { id: "a", number: 1, answer: "No double", description: "(-0.1)", loss: 0.1, correct: false, image: null },
        { id: "b", number: 2, answer: "Double/Take", description: "+0.5", loss: 0, correct: true, image: null },
      ],
    };
    expect(correctChoice(p).id).toBe("b");
    expect(() => correctChoice({ ...p, choices: [p.choices[0]] })).toThrow(/no correct choice/);
    expect(promptText("cube")).toMatch(/cube action/);
    expect(promptText("checker")).toMatch(/best play/);
  });
});
