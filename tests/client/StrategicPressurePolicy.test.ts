import { describe, expect, it } from "vitest";
import {
  assessBridgeheadLaunch,
  assessGrowthAwareLandGrab,
} from "../../src/client/ai/StrategicPressurePolicy";

describe("bridgehead launch assessment", () => {
  it("uses a small boat when weak land materially shortens future routes", () => {
    const decision = assessBridgeheadLaunch({
      projectedEnemyTroops: 10_000,
      requiredLandingAdvantage: 1.05,
      normalMinimumLaunchTroops: 80_000,
      bridgeheadMinimumLaunchTroops: 20_000,
      maximumLaunchTroops: 250_000,
      reachGain: 0.2,
      interceptionRisk: 0.1,
      passableExits: 3,
      targetIsTribe: true,
      targetIsRemnant: false,
    });

    expect(decision.bridgehead).toBe(true);
    expect(decision.launchTroops).toBe(20_000);
    expect(decision.reachValue).toBeGreaterThan(20);
  });

  it("uses a normal force when the route is risky or gains little reach", () => {
    const decision = assessBridgeheadLaunch({
      projectedEnemyTroops: 10_000,
      requiredLandingAdvantage: 1.05,
      normalMinimumLaunchTroops: 80_000,
      bridgeheadMinimumLaunchTroops: 20_000,
      maximumLaunchTroops: 250_000,
      reachGain: 0.03,
      interceptionRisk: 0.3,
      passableExits: 3,
      targetIsTribe: true,
      targetIsRemnant: false,
    });

    expect(decision.bridgehead).toBe(false);
    expect(decision.launchTroops).toBe(80_000);
  });

  it("rejects a landing that cannot beat the projected defender", () => {
    const decision = assessBridgeheadLaunch({
      projectedEnemyTroops: 300_000,
      requiredLandingAdvantage: 1.35,
      normalMinimumLaunchTroops: 80_000,
      bridgeheadMinimumLaunchTroops: 20_000,
      maximumLaunchTroops: 250_000,
      reachGain: 0.4,
      interceptionRisk: 0.05,
      passableExits: 4,
      targetIsTribe: false,
      targetIsRemnant: true,
    });

    expect(decision.launchTroops).toBe(0);
    expect(decision.bridgehead).toBe(false);
  });
});

describe("growth-aware land grab assessment", () => {
  it("accepts a grab whose land and denied growth repay expected losses", () => {
    const decision = assessGrowthAwareLandGrab({
      committedTroops: 100_000,
      currentEnemyTroops: 100_000,
      projectedEnemyTroops: 115_000,
      targetTiles: 1_000,
      expectedCapturedTiles: 400,
      estimatedTicks: 60,
      terrainLossMultiplier: 1,
    });

    expect(decision.worthwhile).toBe(true);
    expect(decision.expectedValue).toBeGreaterThan(decision.expectedCost);
    expect(decision.projectedEnemyGrowth).toBe(15_000);
  });

  it("rejects a token grab when enemy growth will overwhelm the squad", () => {
    const decision = assessGrowthAwareLandGrab({
      committedTroops: 60_000,
      currentEnemyTroops: 70_000,
      projectedEnemyTroops: 105_000,
      targetTiles: 2_000,
      expectedCapturedTiles: 20,
      estimatedTicks: 120,
      terrainLossMultiplier: 1.2,
    });

    expect(decision.worthwhile).toBe(false);
    expect(decision.projectedForceRatio).toBeGreaterThan(1.35);
  });

  it("rejects cheap-looking land that cannot repay retreat and terrain loss", () => {
    const decision = assessGrowthAwareLandGrab({
      committedTroops: 100_000,
      currentEnemyTroops: 20_000,
      projectedEnemyTroops: 22_000,
      targetTiles: 2_000,
      expectedCapturedTiles: 5,
      estimatedTicks: 40,
      terrainLossMultiplier: 1,
    });

    expect(decision.worthwhile).toBe(false);
    expect(decision.expectedValue).toBeLessThan(decision.expectedCost);
  });
});
