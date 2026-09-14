import { describe, expect, it } from "vitest";
import { craftmineRequestBudget } from "./craftmine-request-budget.js";

describe("Craftmine input headroom", () => {
  it("preserves the reported 500K window and 384K output allowance", () => {
    expect(craftmineRequestBudget(500000, 384000)).toEqual({
      contextWindow: 500000, maxOutputTokens: 384000, toolResultReserve: 2048,
      inputCapacity: 113952, compactionThreshold: 96859,
    });
  });
  it("uses the actual request allowance for summaries and smaller outputs", () => {
    expect(craftmineRequestBudget(500000, 4000, 0).compactionThreshold).toBe(421600);
    expect(craftmineRequestBudget(500000, 64000).inputCapacity).toBe(433952);
  });
  it("does not invent input capacity when the output cannot fit", () => {
    expect(craftmineRequestBudget(1000, 2000).inputCapacity).toBe(0);
    expect(craftmineRequestBudget(1000, 2000).compactionThreshold).toBe(0);
    for (const value of [0, -1, NaN, Infinity, 1.5]) {
      expect(() => craftmineRequestBudget(value, 100)).toThrow("BUDGET_INVALID");
      expect(() => craftmineRequestBudget(1000, value)).toThrow("BUDGET_INVALID");
    }
  });
});
