import { describe, expect, it } from "vitest";
import { chooseEmbargoResponse } from "../../src/client/ai/EmbargoResponsePolicy";

const base = {
  embargoActive: true,
  ticksSinceEmbargoStarted: 600,
  ticksSinceLastWarning: 300,
  ownEconomicDamageRatio: 0.2,
  ownReserveRatio: 0.75,
  ownActiveWars: 0,
  enemyPowerRatioToSelf: 0.9,
  enemyNuclearCapability: 0.1,
  enemyMirvProgress: 0.1,
  criticalLandSamCoverage: 0.8,
  projectedRetaliationLandLoss: 0.05,
  enemyTradeDependence: 0.5,
  enemyEconomicTargetValue: 0.8,
  canCounterEmbargo: true,
  canReachEconomicTargets: true,
};

describe("chooseEmbargoResponse", () => {
  it("warns before escalating a recent embargo", () => {
    const decision = chooseEmbargoResponse({
      ...base,
      ticksSinceEmbargoStarted: 120,
    });
    expect(decision.action).toBe("warn");
  });

  it("counter-embargoes when proportional trade pressure is enough", () => {
    const decision = chooseEmbargoResponse({
      ...base,
      ownEconomicDamageRatio: 0.1,
    });
    expect(decision.action).toBe("counter-embargo");
  });

  it("attacks valuable economic targets after a harmful persistent embargo", () => {
    const decision = chooseEmbargoResponse(base);
    expect(decision.action).toBe("economic-strike");
    expect(decision.commitmentRatio).toBeGreaterThanOrEqual(0.12);
    expect(decision.commitmentRatio).toBeLessThanOrEqual(0.32);
  });

  it("avoids unsafe escalation against a nuclear-ready stronger nation", () => {
    const decision = chooseEmbargoResponse({
      ...base,
      enemyPowerRatioToSelf: 1.5,
      enemyNuclearCapability: 0.8,
      criticalLandSamCoverage: 0.4,
      projectedRetaliationLandLoss: 0.25,
      enemyTradeDependence: 0.1,
      canCounterEmbargo: false,
    });
    expect(decision.action).toBe("ignore");
  });

  it("uses an economic answer instead of military escalation when possible", () => {
    const decision = chooseEmbargoResponse({
      ...base,
      enemyNuclearCapability: 0.8,
      criticalLandSamCoverage: 0.4,
      projectedRetaliationLandLoss: 0.25,
    });
    expect(decision.action).toBe("counter-embargo");
  });

  it("prepares limited war only for severe persistent economic damage", () => {
    const decision = chooseEmbargoResponse({
      ...base,
      ownEconomicDamageRatio: 0.35,
      canCounterEmbargo: false,
      canReachEconomicTargets: false,
      enemyPowerRatioToSelf: 0.8,
    });
    expect(decision.action).toBe("prepare-war");
  });
});
