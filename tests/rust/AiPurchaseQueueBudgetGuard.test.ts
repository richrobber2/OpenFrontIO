// @vitest-environment node

import { describe, expect, it } from "vitest";
import { selectPurchaseQueue } from "../../src/client/ai/PurchaseQueuePolicy";

describe("purchase queue protected budget", () => {
  it("does not invent purchases when the protected spend cap cannot fund them", () => {
    const plan = selectPurchaseQueue({
      spendCap: 99_999,
      minimumPurchases: 10,
      maximumPurchases: 10,
      risk: 0,
      capitalPressure: 1,
      candidates: [
        {
          index: 0,
          cost: 100_000,
          value: 10,
          returnRatio: 1,
          synergy: 1,
        },
        {
          index: 1,
          cost: 250_000,
          value: 20,
          returnRatio: 1,
          synergy: 1,
        },
      ],
    });

    expect(plan.selectedIndices).toEqual([]);
    expect(plan.totalCost).toBe(0);
    expect(plan.remainingBudget).toBe(99_999);
  });
});
