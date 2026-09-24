import { describe, expect, it } from "vitest";
import { ltrRuns } from "@/lib/rtl";

const ltr = (text: string) => ltrRuns(text).filter((r) => r.ltr).map((r) => r.text);

describe("ltrRuns", () => {
  it("keeps a whole sequence of moves in one left-to-right run", () => {
    expect(ltrRuns("כחול משחק 13/7 8/7 ולא 24/18.")).toEqual([
      { text: "כחול משחק ", ltr: false },
      { text: "13/7 8/7", ltr: true },
      { text: " ולא ", ltr: false },
      { text: "24/18", ltr: true },
      { text: ".", ltr: false },
    ]);
  });

  it("covers the bar, hits, bearing off, doubles and chained hops", () => {
    expect(ltr("המהלך bar/21* 24/21 מכה, ו-Bar/22 נכנס")).toEqual(["bar/21* 24/21", "Bar/22"]);
    expect(ltr("להוציא 6/off 5/off או לשחק 8/5(2) 6/5*/1")).toEqual(["6/off 5/off", "8/5(2) 6/5*/1"]);
  });

  it("isolates signed numbers but not hyphens inside words or between digits", () => {
    expect(ltr("ההון יורד ל-−0.045 ואז ל--0.12, או +0.3%")).toEqual(["−0.045", "-0.12", "+0.3%"]);
    expect(ltr("הנקודה ה-5, זריקה של 6-3, 55.1% ו-0.231")).toEqual([]);
  });

  it("drops invisible marks a model put in, so they cannot split a run or a word", () => {
    const rlm = String.fromCharCode(0x200f);
    const softHyphen = String.fromCharCode(0xad);
    expect(ltrRuns(`המהלך 13/7${rlm} 8/7 מפסי${softHyphen}ד (${String.fromCharCode(0x200e)}-0.068)`)).toEqual([
      { text: "המהלך ", ltr: false },
      { text: "13/7 8/7", ltr: true },
      { text: " מפסיד (", ltr: false },
      { text: "-0.068", ltr: true },
      { text: ")", ltr: false },
    ]);
  });

  it("returns plain text untouched", () => {
    expect(ltrRuns("")).toEqual([]);
    expect(ltrRuns("עוגן (anchor) חזק")).toEqual([{ text: "עוגן (anchor) חזק", ltr: false }]);
    expect(ltrRuns("13/7").map((r) => r.text).join("")).toBe("13/7");
  });
});
