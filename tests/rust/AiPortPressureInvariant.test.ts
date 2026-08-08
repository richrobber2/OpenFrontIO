// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  planAdaptivePortActions,
  type AdaptivePortContext,
} from "../../src/client/ai/AdaptivePortPolicy";

function context(overrides: Partial<AdaptivePortContext> = {}): AdaptivePortContext {
  return {
    reserveRatio: 0.82,
    incomingPressureRatio: 0,
    activeFrontRatio: 0.1,
    gold: 4_000_000,
    spendableGold: 2_000_000,
    portCost: 250_000,
    ports: 2,
    connectedPorts: 2,
    tradePartners: 12,
    embargoedPartners: 1,
    ownWarships: 5,
    desiredWarships: 4,
    hostileWarships: 1,
    hostileTransports: 1,
    tradeTargets: 10,
    damagedWarships: 0,
    dockCapacity: 2,
    transportLossRate: 0.05,
    railProductivityRatio: 0.85,
    navalBias: 1.2,
    economicTradeCoverageTargetRatio: 0.15,
    ...overrides,
  };
}

describe("adaptive port pressure invariant", () => {
  it("demands faster, higher-return infrastructure while under threat", () => {
    const safe = planAdaptivePortActions(context());
    const threatened = planAdaptivePortActions(
      context({
        reserveRatio: 0.42,
        incomingPressureRatio: 0.9,
        activeFrontRatio: 0.8,
        ownWarships: 1,
        desiredWarships: 6,
        hostileWarships: 9,
        hostileTransports: 5,
        transportLossRate: 0.45,
      }),
    );

    expect(safe.action).toBe("trade");
    expect(threatened.action).toBe("defend");
    expect(threatened.requiredReturnRatio).toBeGreaterThan(
      safe.requiredReturnRatio,
    );
    expect(threatened.maximumPaybackTicks).toBeLessThan(
      safe.maximumPaybackTicks,
    );
    expect(threatened.minimumBudgetCoverage).toBeGreaterThanOrEqual(1);
  });
});
