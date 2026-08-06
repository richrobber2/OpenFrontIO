import { describe, expect, it } from "vitest";
import {
  AiModuleRegistry,
  createDefaultAiModuleRegistry,
} from "../../src/client/ai/AiModule";

const context = {
  tick: 10,
  reserveRatio: 0.2,
  maxTroops: 10_000,
  troops: 2_000,
  gold: 100_000,
  incomingTroopRatio: 0,
  outgoingCommittedRatio: 0,
  activeFronts: 1,
  neutralLandAvailable: true,
  activeNationWars: 0,
  borderPressure: 0,
  economyReturnScore: 4,
  usefulPortSites: 0,
  existingPorts: 0,
  existingCities: 1,
  existingDefensePosts: 0,
  existingSams: 0,
  existingSilos: 0,
  infrastructureNeedScore: 2,
  strategicWeaponValue: 0,
  allyAidUrgency: 0,
};

describe("AiModuleRegistry", () => {
  it("runs default external modules in priority order", () => {
    const decisions = createDefaultAiModuleRegistry().evaluate(context);
    expect(decisions.map((decision) => decision.moduleID)).toEqual([
      "troop-economy",
      "gold-budget",
      "naval-economy",
    ]);
    expect(decisions[0]?.action).toBe("hold");
    expect(
      createDefaultAiModuleRegistry().evaluateCoordinated(context)
        .consensusAction,
    ).toBe("hold");
  });

  it("passes typed signals from troop to gold to naval modules", () => {
    const coordination = createDefaultAiModuleRegistry().evaluateCoordinated({
      ...context,
      reserveRatio: 0.7,
      gold: 5_000_000,
      usefulPortSites: 2,
      existingPorts: 1,
      existingFactories: 1,
      factoryConnectedPorts: 0,
      spendableGold: 2_000_000,
      portCost: 500_000,
      tradePartners: 8,
      ownWarships: 1,
      desiredWarships: 2,
      landCapacityGain: 8_000,
    });

    expect(coordination.signals.troopReserveFloor).toBeGreaterThan(0);
    expect(coordination.signals.goldCategory).toBeTypeOf("string");
    expect(
      coordination.signals.shipyardFactoryConnectionPriority,
    ).toBeGreaterThanOrEqual(0.5);
    expect(coordination.preferredInvestment).toBe("connect-existing-shipyard");
    expect(coordination.signals.portAction).toBe("connect");
    expect(coordination.signals.portConnectedRatio).toBe(0);
  });

  it("allows an external class to be registered and removed", () => {
    const registry = new AiModuleRegistry();
    registry.register({
      id: "test-module",
      priority: 200,
      evaluate: () => ({
        moduleID: "test-module",
        priority: 200,
        action: "observe",
        reason: "test",
      }),
    });
    expect(registry.evaluate(context)[0]?.moduleID).toBe("test-module");
    expect(registry.unregister("test-module")).toBe(true);
    expect(registry.evaluate(context)).toEqual([]);
  });
});
