import { describe, expect, it } from "vitest";
import { updateRecurringIncomeEstimate } from "../../src/client/ai/EconomicIncomePolicy";

describe("updateRecurringIncomeEstimate", () => {
  it("keeps a conquest windfall out of recurring income", () => {
    const update = updateRecurringIncomeEstimate({
      currentEstimate: 60_000,
      observedRate: 12_000_000,
      recentAcceptedRates: [
        58_000, 60_000, 61_000, 59_000, 62_000, 60_000, 61_000, 59_000,
      ],
    });

    expect(update.acceptedRate).toBeLessThan(100_000);
    expect(update.estimate).toBeLessThan(70_000);
    expect(update.windfallRatio).toBeGreaterThan(0.99);
  });

  it("adapts toward a sustainable percentage increase", () => {
    const update = updateRecurringIncomeEstimate({
      currentEstimate: 60_000,
      observedRate: 75_000,
      recentAcceptedRates: [58_000, 60_000, 62_000],
    });

    expect(update.acceptedRate).toBe(75_000);
    expect(update.estimate).toBeGreaterThan(60_000);
    expect(update.windfallRatio).toBe(0);
  });
});
