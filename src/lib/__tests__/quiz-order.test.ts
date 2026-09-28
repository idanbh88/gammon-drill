import { describe, expect, it } from "vitest";
import { DEFAULT_ORDER, isDefaultOrder, loadOrder, ORDER_KEY, orderSummary, orderText, saveOrder } from "@/lib/quiz-order";

describe("quiz order", () => {
  it("describes each combination", () => {
    expect(isDefaultOrder(DEFAULT_ORDER)).toBe(true);
    expect(orderSummary(DEFAULT_ORDER)).toBe("");
    expect(orderText(DEFAULT_ORDER)).toMatch(/^spaced repetition/);
    expect(orderSummary({ newFirst: true, random: false })).toBe("new first");
    expect(orderSummary({ newFirst: false, random: true })).toBe("random order");
    expect(orderSummary({ newFirst: true, random: true })).toBe("new first, then random");
    expect(orderText({ newFirst: true, random: true })).toMatch(/^new problems first, the last match added first .*then the rest at random$/);
  });

  it("is remembered in localStorage, apart from the filters", () => {
    expect(loadOrder()).toEqual(DEFAULT_ORDER); // no browser
    const saved = new Map<string, string>();
    const g = globalThis as { window?: unknown };
    g.window = { localStorage: { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) } };
    try {
      expect(loadOrder()).toEqual(DEFAULT_ORDER);
      saveOrder({ newFirst: true, random: false });
      expect(JSON.parse(saved.get(ORDER_KEY)!)).toEqual({ newFirst: true, random: false });
      expect(loadOrder()).toEqual({ newFirst: true, random: false });
      saved.set(ORDER_KEY, JSON.stringify({ newFirst: "yes", random: true }));
      expect(loadOrder()).toEqual({ newFirst: false, random: true });
      saved.set(ORDER_KEY, "not json");
      expect(loadOrder()).toEqual(DEFAULT_ORDER);
    } finally {
      delete g.window;
    }
  });
});
